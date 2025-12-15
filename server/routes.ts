import type { Express } from "express";
import { type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { computeSHA256, processIARArchive, extractFlowNodes } from "./utils/fileProcessor";
import { computeFileDiff } from "./utils/diffEngine";
import { parseBpelFromArchiveFiles } from "./utils/bpelParser";
import { insertArchiveSchema, insertDiffRunSchema } from "../shared/schema";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.iar') || file.mimetype === 'application/zip') {
      cb(null, true);
    } else {
      cb(new Error('Only .iar files are allowed'));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Upload archive
  app.post("/api/archives/upload", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileBuffer = req.file.buffer;
      const sha256 = computeSHA256(fileBuffer);

      // Create archive record
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

      // Process the archive
      const processed = await processIARArchive(fileBuffer, archive.id);

      // Store files
      if (processed.files.length > 0) {
        await storage.createArchiveFiles(processed.files);
      }

      // Store integrations
      if (processed.integrations.length > 0) {
        const integrations = await storage.createIntegrations(processed.integrations);
        
        // Extract and store flow artifacts for each integration
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
          fileName: archive.fileName,
          fileSize: archive.fileSize,
          uploadedAt: archive.uploadedAt,
          filesCount: processed.files.length,
          integrationsCount: processed.integrations.length,
        },
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      res.status(500).json({ error: error.message || "Failed to upload archive" });
    }
  });

  // Create diff run
  app.post("/api/diff-runs/create", async (req, res) => {
    try {
      const { leftArchiveId, rightArchiveId } = req.body;

      if (!leftArchiveId || !rightArchiveId) {
        return res.status(400).json({ error: "Both archive IDs are required" });
      }

      // Verify archives exist
      const leftArchive = await storage.getArchive(leftArchiveId);
      const rightArchive = await storage.getArchive(rightArchiveId);

      if (!leftArchive || !rightArchive) {
        return res.status(404).json({ error: "One or both archives not found" });
      }

      // Create diff run
      const diffRunData = insertDiffRunSchema.parse({
        leftArchiveId,
        rightArchiveId,
        status: 'processing',
      });

      const diffRun = await storage.createDiffRun(diffRunData);

      // Process diff in background (simplified - in production, use a queue)
      processDiffAsync(diffRun.id, leftArchiveId, rightArchiveId).catch(err => {
        console.error('Diff processing error:', err);
      });

      res.json({
        success: true,
        diffRun: {
          id: diffRun.id,
          leftArchiveId: diffRun.leftArchiveId,
          rightArchiveId: diffRun.rightArchiveId,
          status: diffRun.status,
          createdAt: diffRun.createdAt,
        },
      });
    } catch (error: any) {
      console.error('Create diff error:', error);
      res.status(500).json({ error: error.message || "Failed to create diff run" });
    }
  });

  // Get all diff runs
  app.get("/api/diff-runs", async (req, res) => {
    try {
      const diffRuns = await storage.getAllDiffRuns();
      res.json({ diffRuns });
    } catch (error: any) {
      console.error('Get diff runs error:', error);
      res.status(500).json({ error: error.message || "Failed to get diff runs" });
    }
  });

  // Get diff run details
  app.get("/api/diff-runs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const diffRun = await storage.getDiffRun(id);

      if (!diffRun) {
        return res.status(404).json({ error: "Diff run not found" });
      }

      // Get related archives
      const leftArchive = await storage.getArchive(diffRun.leftArchiveId);
      const rightArchive = await storage.getArchive(diffRun.rightArchiveId);

      res.json({
        diffRun,
        leftArchive,
        rightArchive,
      });
    } catch (error: any) {
      console.error('Get diff run error:', error);
      res.status(500).json({ error: error.message || "Failed to get diff run" });
    }
  });

  // Get diff items
  app.get("/api/diff-runs/:id/items", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const items = await storage.getDiffItems(id);
      res.json({ items });
    } catch (error: any) {
      console.error('Get diff items error:', error);
      res.status(500).json({ error: error.message || "Failed to get diff items" });
    }
  });

  // Get all archives
  app.get("/api/archives", async (req, res) => {
    try {
      const archives = await storage.getAllArchives();
      res.json({ archives });
    } catch (error: any) {
      console.error('Get archives error:', error);
      res.status(500).json({ error: error.message || "Failed to get archives" });
    }
  });

  // Export diff report as HTML
  app.get("/api/diff-runs/:id/export", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const diffRun = await storage.getDiffRun(id);

      if (!diffRun) {
        return res.status(404).json({ error: "Diff run not found" });
      }

      const leftArchive = await storage.getArchive(diffRun.leftArchiveId);
      const rightArchive = await storage.getArchive(diffRun.rightArchiveId);
      const items = await storage.getDiffItems(id);

      const summary = diffRun.summary as any || { high: 0, medium: 0, low: 0, info: 0 };

      // Generate HTML report
      const html = generateHTMLReport({
        diffRun,
        leftArchive,
        rightArchive,
        items,
        summary,
      });

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="diff-report-${id}.html"`);
      res.send(html);
    } catch (error: any) {
      console.error('Export report error:', error);
      res.status(500).json({ error: error.message || "Failed to export report" });
    }
  });

  // Get diff item content for side-by-side comparison
  app.get("/api/diff-items/:id/content", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const diffItem = await storage.getDiffItem(id);

      if (!diffItem) {
        return res.status(404).json({ error: "Diff item not found" });
      }

      // Get the diff run to find archive IDs
      const diffRun = await storage.getDiffRun(diffItem.diffRunId);
      if (!diffRun) {
        return res.status(404).json({ error: "Diff run not found" });
      }

      let leftContent = '';
      let rightContent = '';

      // Get content from left archive if file exists there
      if (diffItem.leftRef) {
        const leftFile = await storage.getArchiveFileByPath(diffRun.leftArchiveId, diffItem.leftRef);
        leftContent = leftFile?.content || '';
      }

      // Get content from right archive if file exists there
      if (diffItem.rightRef) {
        const rightFile = await storage.getArchiveFileByPath(diffRun.rightArchiveId, diffItem.rightRef);
        rightContent = rightFile?.content || '';
      }

      res.json({
        leftContent,
        rightContent,
        diffPatch: diffItem.diffPatch,
      });
    } catch (error: any) {
      console.error('Get diff item content error:', error);
      res.status(500).json({ error: error.message || "Failed to get diff item content" });
    }
  });

  // Get archive details
  app.get("/api/archives/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const archive = await storage.getArchive(id);

      if (!archive) {
        return res.status(404).json({ error: "Archive not found" });
      }

      const files = await storage.getArchiveFiles(id);
      const integrations = await storage.getIntegrations(id);

      res.json({
        archive,
        filesCount: files.length,
        integrationsCount: integrations.length,
      });
    } catch (error: any) {
      console.error('Get archive error:', error);
      res.status(500).json({ error: error.message || "Failed to get archive" });
    }
  });

  // Get flow diagram data from archive
  app.get("/api/archives/:id/flow", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const archive = await storage.getArchive(id);

      if (!archive) {
        return res.status(404).json({ error: "Archive not found" });
      }

      const files = await storage.getArchiveFiles(id);
      const flow = parseBpelFromArchiveFiles(files);

      if (!flow) {
        return res.json({
          nodes: [],
          connections: [],
          metadata: { processName: 'No BPEL flow found' },
        });
      }

      res.json(flow);
    } catch (error: any) {
      console.error('Get archive flow error:', error);
      res.status(500).json({ error: error.message || "Failed to get archive flow" });
    }
  });

  // Get flow comparison for diff run
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
      console.error('Get diff run flow error:', error);
      res.status(500).json({ error: error.message || "Failed to get diff run flow" });
    }
  });

  // Admin: Clear database (password protected)
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

      // Rate limiting: only allow once per minute
      const now = Date.now();
      if (now - lastClearTime < 60000) {
        return res.status(429).json({ error: "Please wait before clearing again" });
      }
      lastClearTime = now;

      // Clear all tables
      await storage.clearAllData();

      res.json({ success: true, message: "Database cleared successfully" });
    } catch (error: any) {
      console.error('Clear database error:', error);
      res.status(500).json({ error: error.message || "Failed to clear database" });
    }
  });

  return httpServer;
}

// Background diff processing
async function processDiffAsync(
  diffRunId: number,
  leftArchiveId: number,
  rightArchiveId: number
) {
  try {
    // Get files from both archives
    const leftFiles = await storage.getArchiveFiles(leftArchiveId);
    const rightFiles = await storage.getArchiveFiles(rightArchiveId);

    // Compute diff
    const { items, summary } = computeFileDiff(leftFiles, rightFiles, diffRunId);

    // Store diff items
    if (items.length > 0) {
      await storage.createDiffItems(items);
    }

    // Update diff run status
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

// Generate HTML report - simplified comparison view
function generateHTMLReport(data: {
  diffRun: any;
  leftArchive: any;
  rightArchive: any;
  items: any[];
  summary: any;
}): string {
  const { diffRun, leftArchive, rightArchive, items, summary } = data;
  
  const addedItems = items.filter(i => i.changeType === 'Added');
  const removedItems = items.filter(i => i.changeType === 'Removed');
  const modifiedItems = items.filter(i => i.changeType === 'Modified');

  const renderTableRow = (item: any) => {
    const severityColors: Record<string, string> = {
      'High': '#ef4444',
      'Medium': '#f59e0b', 
      'Low': '#3b82f6',
      'Info': '#64748b'
    };
    const color = severityColors[item.severity] || '#64748b';
    const diffSection = item.diffPatch ? `
      <tr>
        <td colspan="4" style="padding: 0;">
          <details style="background: #0d1117; border-top: 1px solid #334155;">
            <summary style="padding: 10px 16px; cursor: pointer; color: #64748b; font-size: 12px;">View diff details</summary>
            <pre style="padding: 16px; font-family: 'Monaco', 'Consolas', monospace; font-size: 11px; overflow-x: auto; white-space: pre-wrap; color: #c9d1d9; max-height: 300px; overflow-y: auto;">${escapeHtml(item.diffPatch.substring(0, 3000))}${item.diffPatch.length > 3000 ? '\n\n... (truncated)' : ''}</pre>
          </details>
        </td>
      </tr>` : '';
    return `
    <tr style="border-bottom: 1px solid #334155;">
      <td style="border-left: 3px solid ${color}; padding: 12px; font-weight: 500;">${escapeHtml(item.entityName)}</td>
      <td style="padding: 12px; color: #94a3b8;">${escapeHtml(item.entityType)}</td>
      <td style="padding: 12px;"><span style="background: ${color}22; color: ${color}; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${escapeHtml(item.severity)}</span></td>
      <td style="padding: 12px; color: #94a3b8; font-size: 13px;">${escapeHtml(item.riskReason || '-')}</td>
    </tr>${diffSection}`;
  };

  const renderSection = (title: string, items: any[], color: string, icon: string) => {
    if (items.length === 0) return '';
    return `
    <div style="margin-bottom: 32px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid ${color}40;">
        <span style="font-size: 20px;">${icon}</span>
        <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: ${color};">${title}</h3>
        <span style="background: ${color}20; color: ${color}; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">${items.length}</span>
      </div>
      <table style="width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background: #0f172a;">
            <th style="text-align: left; padding: 12px; color: #64748b; font-weight: 500; font-size: 12px; text-transform: uppercase;">Name</th>
            <th style="text-align: left; padding: 12px; color: #64748b; font-weight: 500; font-size: 12px; text-transform: uppercase;">Type</th>
            <th style="text-align: left; padding: 12px; color: #64748b; font-weight: 500; font-size: 12px; text-transform: uppercase;">Impact</th>
            <th style="text-align: left; padding: 12px; color: #64748b; font-weight: 500; font-size: 12px; text-transform: uppercase;">Description</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => renderTableRow(item)).join('')}
        </tbody>
      </table>
    </div>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OIC Comparison Report | ${leftArchive?.name || 'Version 1'} vs ${rightArchive?.name || 'Version 2'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; line-height: 1.6; padding: 40px 24px; }
    .container { max-width: 1100px; margin: 0 auto; }
    tr { border-bottom: 1px solid #334155; }
    tr:last-child { border-bottom: none; }
    @media print { body { background: white; color: black; } table { background: #f5f5f5 !important; } }
  </style>
</head>
<body>
  <div class="container">
    <div style="background: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15)); border: 1px solid rgba(99,102,241,0.3); border-radius: 16px; padding: 28px; margin-bottom: 32px;">
      <h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 16px; color: #a5b4fc;">OIC Integration Comparison Report</h1>
      <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 12px;">
        <span style="background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; padding: 10px 18px; border-radius: 8px; font-weight: 600;">${escapeHtml(leftArchive?.name || 'Version 1')}</span>
        <span style="color: #64748b; font-size: 1.5rem;">→</span>
        <span style="background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.3); color: #86efac; padding: 10px 18px; border-radius: 8px; font-weight: 600;">${escapeHtml(rightArchive?.name || 'Version 2')}</span>
      </div>
      <p style="color: #64748b; font-size: 0.875rem;">Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    </div>
    
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px;">
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #ef4444;">
        <div style="font-size: 2rem; font-weight: 700; color: #ef4444;">${summary.high || 0}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">High Impact</div>
      </div>
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #f59e0b;">
        <div style="font-size: 2rem; font-weight: 700; color: #f59e0b;">${summary.medium || 0}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">Medium Impact</div>
      </div>
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #3b82f6;">
        <div style="font-size: 2rem; font-weight: 700; color: #3b82f6;">${summary.low || 0}</div>
        <div style="color: #94a3b8; font-size: 0.875rem;">Low Impact</div>
      </div>
      <div style="background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border-top: 3px solid #64748b;">
        <div style="font-size: 2rem; font-weight: 700; color: #64748b;">${summary.info || 0}</div>
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
