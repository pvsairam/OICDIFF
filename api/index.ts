import express, { type Request, Response, NextFunction } from "express";
import multer from "multer";

console.log("[API] Starting serverless function...");
console.log("[API] DATABASE_URL exists:", !!process.env.DATABASE_URL);
console.log("[API] NEON_DATABASE_URL exists:", !!process.env.NEON_DATABASE_URL);
console.log("[API] VERCEL env:", process.env.VERCEL);

import { storage } from "../server/storage";
import { computeSHA256, processIARArchive, extractFlowNodes } from "../server/utils/fileProcessor";
import { computeFileDiff } from "../server/utils/diffEngine";
import { parseBpelFromArchiveFiles } from "../server/utils/bpelParser";
import { insertArchiveSchema, insertDiffRunSchema } from "../shared/schema";

console.log("[API] All imports loaded successfully");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.iar') || file.mimetype === 'application/zip') {
      cb(null, true);
    } else {
      cb(new Error('Only .iar files are allowed'));
    }
  },
});

app.post("/api/archives/upload", upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileBuffer = req.file.buffer;
    const sha256 = computeSHA256(fileBuffer);

    const archiveData = insertArchiveSchema.parse({
      name: req.file.originalname.replace('.iar', ''),
      fileName: req.file.originalname,
      fileSize: req.file.size,
      sha256,
      metadata: {
        uploadedBy: 'anonymous',
        originalName: req.file.originalname,
      },
    });

    const archive = await storage.createArchive(archiveData);
    const processed = await processIARArchive(fileBuffer, archive.id);

    if (processed.files.length > 0) {
      await storage.createArchiveFiles(processed.files);
    }

    if (processed.integrations.length > 0) {
      const integrations = await storage.createIntegrations(processed.integrations);
      
      for (const integration of integrations) {
        const flowArtifacts = extractFlowNodes(integration.metadata, integration.id);
        if (flowArtifacts.length > 0) {
          await storage.createFlowArtifacts(flowArtifacts);
        }
      }
    }

    res.json({
      success: true,
      archive: {
        id: archive.id,
        name: archive.name,
        fileSize: archive.fileSize,
        sha256: archive.sha256,
      },
      stats: {
        totalFiles: processed.files.length,
        integrations: processed.integrations.length,
      },
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || "Failed to process archive" });
  }
});

app.get("/api/archives", async (req, res) => {
  try {
    const archives = await storage.getAllArchives();
    res.json({ archives });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch archives" });
  }
});

app.get("/api/archives/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const archive = await storage.getArchive(id);
    if (!archive) {
      return res.status(404).json({ error: "Archive not found" });
    }
    const files = await storage.getArchiveFiles(id);
    const integrations = await storage.getIntegrations(id);
    res.json({ archive, files, integrations });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch archive" });
  }
});

app.get("/api/archives/:id/files", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const files = await storage.getArchiveFiles(id);
    res.json({ files });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch files" });
  }
});

app.post("/api/diff-runs", async (req, res) => {
  try {
    const validatedData = insertDiffRunSchema.parse(req.body);
    const diffRun = await storage.createDiffRun(validatedData);
    
    processDiffAsync(diffRun.id, diffRun.leftArchiveId, diffRun.rightArchiveId);
    
    res.json({ success: true, diffRun });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create diff run" });
  }
});

app.get("/api/diff-runs", async (req, res) => {
  try {
    const diffRuns = await storage.getAllDiffRuns();
    res.json({ diffRuns });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch diff runs" });
  }
});

app.get("/api/diff-runs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const diffRun = await storage.getDiffRun(id);
    if (!diffRun) {
      return res.status(404).json({ error: "Diff run not found" });
    }
    const items = await storage.getDiffItems(id);
    res.json({ diffRun, items });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch diff run" });
  }
});

app.get("/api/diff-runs/:id/items", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const items = await storage.getDiffItems(id);
    res.json({ items });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch diff items" });
  }
});

app.get("/api/diff-items/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = await storage.getDiffItem(id);
    if (!item) {
      return res.status(404).json({ error: "Diff item not found" });
    }
    res.json({ item });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch diff item" });
  }
});

app.get("/api/archives/:id/flow", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const files = await storage.getArchiveFiles(id);
    const flow = parseBpelFromArchiveFiles(files);
    
    if (!flow) {
      return res.json({ nodes: [], connections: [], metadata: { processName: 'No flow found' } });
    }
    res.json(flow);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get archive flow" });
  }
});

app.get("/api/diff-runs/:id/flow", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const diffRun = await storage.getDiffRun(id);

    if (!diffRun) {
      return res.status(404).json({ error: "Diff run not found" });
    }

    const leftFiles = await storage.getArchiveFiles(diffRun.leftArchiveId);
    const rightFiles = await storage.getArchiveFiles(diffRun.rightArchiveId);

    const leftFlow = parseBpelFromArchiveFiles(leftFiles);
    const rightFlow = parseBpelFromArchiveFiles(rightFiles);

    res.json({
      left: leftFlow || { nodes: [], connections: [], metadata: { processName: 'No flow' } },
      right: rightFlow || { nodes: [], connections: [], metadata: { processName: 'No flow' } },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get diff run flow" });
  }
});

app.get("/api/diff-runs/:id/export", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const diffRun = await storage.getDiffRun(id);
    
    if (!diffRun) {
      return res.status(404).json({ error: "Diff run not found" });
    }

    const items = await storage.getDiffItems(id);
    const leftArchive = await storage.getArchive(diffRun.leftArchiveId);
    const rightArchive = await storage.getArchive(diffRun.rightArchiveId);

    const html = generateReportHtml(diffRun, items, leftArchive, rightArchive);
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="diff-report-${id}.html"`);
    res.send(html);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to export report" });
  }
});

let lastClearTime = 0;
app.post("/api/admin/clear-database", async (req, res) => {
  try {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    if (!adminPassword) {
      return res.status(503).json({ error: "Admin password not configured" });
    }
    
    if (!password || password !== adminPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const now = Date.now();
    if (now - lastClearTime < 60000) {
      return res.status(429).json({ error: "Please wait before clearing again" });
    }
    lastClearTime = now;

    await storage.clearAllData();
    res.json({ success: true, message: "Database cleared successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to clear database" });
  }
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  console.error(`[API Error] ${status}: ${message}`, err.stack || err);
  res.status(status).json({ error: message, stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined });
});

async function processDiffAsync(
  diffRunId: number,
  leftArchiveId: number,
  rightArchiveId: number
) {
  try {
    const leftFiles = await storage.getArchiveFiles(leftArchiveId);
    const rightFiles = await storage.getArchiveFiles(rightArchiveId);
    const { items, summary } = computeFileDiff(leftFiles, rightFiles, diffRunId);

    if (items.length > 0) {
      await storage.createDiffItems(items);
    }

    await storage.updateDiffRun(diffRunId, {
      status: 'completed',
      completedAt: new Date(),
      summary,
    });
  } catch (error) {
    console.error('Background diff processing error:', error);
    await storage.updateDiffRun(diffRunId, {
      status: 'failed',
      completedAt: new Date(),
    });
  }
}

function generateReportHtml(diffRun: any, items: any[], leftArchive: any, rightArchive: any): string {
  const summary = diffRun.summary || { high: 0, medium: 0, low: 0, info: 0 };
  const addedItems = items.filter(i => i.changeType === 'added');
  const removedItems = items.filter(i => i.changeType === 'removed');
  const modifiedItems = items.filter(i => i.changeType === 'modified');

  const renderSection = (title: string, sectionItems: any[], color: string, icon: string) => {
    if (sectionItems.length === 0) return '';
    return `
    <div style="margin-bottom: 32px;">
      <h2 style="font-size: 1.25rem; font-weight: 600; color: ${color}; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
        <span>${icon}</span> ${title} (${sectionItems.length})
      </h2>
      <div style="background: #1e293b; border-radius: 8px; overflow: hidden;">
        ${sectionItems.map((item, idx) => `
          <div style="padding: 12px 16px; border-bottom: 1px solid #334155; ${idx === sectionItems.length - 1 ? 'border-bottom: none;' : ''}">
            <div style="font-family: monospace; font-size: 0.875rem; color: #e2e8f0;">${escapeHtml(item.path)}</div>
            ${item.severity ? `<span style="display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; background: ${item.severity === 'high' ? '#dc2626' : item.severity === 'medium' ? '#f59e0b' : '#3b82f6'}; color: white;">${item.severity}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OIC Diff Report</title>
</head>
<body style="margin: 0; padding: 0; background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 1200px; margin: 0 auto; padding: 40px 20px;">
    <header style="margin-bottom: 40px; text-align: center;">
      <h1 style="font-size: 2rem; font-weight: 700; color: #f8fafc; margin-bottom: 8px;">OIC Archive Diff Report</h1>
      <p style="color: #94a3b8;">Generated on ${new Date().toLocaleString()}</p>
    </header>
    
    <div style="background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 32px;">
      <h2 style="font-size: 1rem; color: #94a3b8; margin-bottom: 16px;">Comparison Details</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <div style="color: #64748b; font-size: 0.75rem; text-transform: uppercase;">Source Archive</div>
          <div style="color: #f8fafc; font-weight: 500;">${escapeHtml(leftArchive?.name || 'Unknown')}</div>
        </div>
        <div>
          <div style="color: #64748b; font-size: 0.75rem; text-transform: uppercase;">Target Archive</div>
          <div style="color: #f8fafc; font-weight: 500;">${escapeHtml(rightArchive?.name || 'Unknown')}</div>
        </div>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 40px;">
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #ef4444;">
        <div style="font-size: 2rem; font-weight: 700; color: #ef4444;">${summary.high}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">High Severity</div>
      </div>
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #f59e0b;">
        <div style="font-size: 2rem; font-weight: 700; color: #f59e0b;">${summary.medium}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">Medium Severity</div>
      </div>
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #3b82f6;">
        <div style="font-size: 2rem; font-weight: 700; color: #3b82f6;">${summary.low}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">Low Severity</div>
      </div>
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #64748b;">
        <div style="font-size: 2rem; font-weight: 700; color: #64748b;">${summary.info}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">Informational</div>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 40px;">
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #22c55e;">
        <div style="font-size: 2rem; font-weight: 700; color: #22c55e;">${addedItems.length}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">Added</div>
      </div>
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #ef4444;">
        <div style="font-size: 2rem; font-weight: 700; color: #ef4444;">${removedItems.length}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">Removed</div>
      </div>
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #f59e0b;">
        <div style="font-size: 2rem; font-weight: 700; color: #f59e0b;">${modifiedItems.length}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">Modified</div>
      </div>
    </div>
    
    ${renderSection('Added Files', addedItems, '#22c55e', '➕')}
    ${renderSection('Removed Files', removedItems, '#ef4444', '➖')}
    ${renderSection('Modified Files', modifiedItems, '#f59e0b', '✏️')}
    
    <footer style="text-align: center; padding: 32px 0; border-top: 1px solid #334155; margin-top: 40px; color: #64748b; font-size: 0.875rem;">
      <p>Generated by <strong style="color: #94a3b8;">OIC Archive Diff Tool</strong></p>
      <p>Total changes analyzed: ${items.length}</p>
    </footer>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default app;
