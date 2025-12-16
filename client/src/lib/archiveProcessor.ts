import JSZip from 'jszip';

export interface ProcessedFile {
  path: string;
  hash: string;
  size: number;
  content: string | null;
}

export interface ProcessedIntegration {
  name: string;
  identifier: string;
  version: string;
  type: string;
  metadata: any;
}

export interface ClientProcessedArchive {
  fileName: string;
  fileSize: number;
  sha256: string;
  files: ProcessedFile[];
  integrations: ProcessedIntegration[];
}

async function computeSHA256(data: string | ArrayBuffer): Promise<string> {
  const buffer = typeof data === 'string' 
    ? new TextEncoder().encode(data)
    : new Uint8Array(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseXML(xmlString: string): any {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  return domToObject(doc.documentElement);
}

function domToObject(node: Element): any {
  const obj: any = {};
  
  if (node.attributes.length > 0) {
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i];
      obj[`@_${attr.name}`] = attr.value;
    }
  }
  
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childElement = child as Element;
      const childObj = domToObject(childElement);
      const tagName = childElement.tagName;
      
      if (obj[tagName]) {
        if (!Array.isArray(obj[tagName])) {
          obj[tagName] = [obj[tagName]];
        }
        obj[tagName].push(childObj);
      } else {
        obj[tagName] = childObj;
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) {
        obj['#text'] = text;
      }
    }
  }
  
  return obj;
}

function extractIntegrationName(path: string, xmlData: any): string | null {
  const parts = path.split('/');
  for (const part of parts) {
    if (part.includes('_')) {
      return part.split('_')[0];
    }
  }
  
  if (xmlData?.project?.['@_name']) {
    return xmlData.project['@_name'];
  }
  if (xmlData?.integration?.['@_name']) {
    return xmlData.integration['@_name'];
  }
  
  const fileName = parts[parts.length - 1];
  return fileName.replace('.xml', '');
}

function determineIntegrationType(path: string): string {
  const pathLower = path.toLowerCase();
  if (pathLower.includes('orchestration') || pathLower.includes('orch_')) {
    return 'orchestration';
  }
  if (pathLower.includes('bpel') || pathLower.endsWith('.bpel')) {
    return 'bpel';
  }
  if (pathLower.includes('scheduled')) {
    return 'scheduled';
  }
  if (pathLower.includes('rest') || pathLower.includes('soap')) {
    return 'app-driven';
  }
  return 'generic';
}

export async function processArchiveClientSide(
  file: File,
  onProgress?: (stage: string, percent: number) => void
): Promise<ClientProcessedArchive> {
  onProgress?.('Reading file...', 10);
  
  const arrayBuffer = await file.arrayBuffer();
  const sha256 = await computeSHA256(arrayBuffer);
  
  onProgress?.('Extracting archive...', 30);
  
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files: ProcessedFile[] = [];
  const integrations: ProcessedIntegration[] = [];
  
  const entries = Object.keys(zip.files);
  const totalEntries = entries.length;
  let processed = 0;
  
  // Filter to only process critical files to minimize payload and DB writes
  // This is optimized for Vercel Hobby's 10-second timeout
  const criticalPaths = entries.filter(path => {
    const lower = path.toLowerCase();
    return !zip.files[path].dir && (
      lower.includes('project.xml') ||
      lower.endsWith('.bpel') ||
      lower.includes('orchestration') ||
      lower.includes('icspackage') ||
      lower.includes('.xsl') ||
      lower.includes('manifest')
    );
  });
  
  // Also track all files with just metadata (path/size) for complete manifest
  for (const path of entries) {
    const entry = zip.files[path];
    if (entry.dir) continue;
    
    processed++;
    
    // Only fully process critical files
    const isCritical = criticalPaths.includes(path);
    
    if (isCritical) {
      const progress = 30 + (processed / totalEntries) * 50;
      onProgress?.(`Processing ${path.split('/').pop()}...`, progress);
      
      try {
        const content = await entry.async('string');
        const fileHash = await computeSHA256(content);
        
        // Store content for critical files - always store orchestration/BPEL for flow visualization
        const lowerPath = path.toLowerCase();
        const isFlowFile = lowerPath.includes('project.xml') || 
                          lowerPath.endsWith('.bpel') || 
                          lowerPath.includes('orchestration');
        const shouldStoreContent = isFlowFile || content.length < 50000;
        
        files.push({
          path,
          hash: fileHash,
          size: content.length,
          content: shouldStoreContent ? content : null,
        });
        
        // Parse integration metadata from XML files
        if (path.endsWith('.xml')) {
          try {
            const xmlData = parseXML(content);
            if (xmlData) {
              const integrationName = extractIntegrationName(path, xmlData);
              if (integrationName) {
                integrations.push({
                  name: integrationName,
                  identifier: path,
                  version: '1.0',
                  type: determineIntegrationType(path),
                  metadata: xmlData,
                });
              }
            }
          } catch (e) {
            console.warn(`Failed to parse XML: ${path}`, e);
          }
        }
      } catch (e) {
        console.warn(`Failed to process entry: ${path}`, e);
      }
    } else {
      // For non-critical files, just store path and estimated size (no content/hash)
      files.push({
        path,
        hash: 'skipped',
        size: 0,
        content: null,
      });
    }
  }
  
  onProgress?.('Finalizing...', 95);
  
  return {
    fileName: file.name,
    fileSize: file.size,
    sha256,
    files,
    integrations,
  };
}
