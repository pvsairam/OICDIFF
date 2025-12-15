import AdmZip from 'adm-zip';
import crypto from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import type { InsertArchiveFile, InsertIntegration, InsertFlowArtifact } from '../../shared/schema';

export interface ProcessedArchive {
  files: InsertArchiveFile[];
  integrations: InsertIntegration[];
  flowArtifacts: InsertFlowArtifact[];
}

export function computeSHA256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function computeFileSHA256(content: string | Buffer): string {
  const buffer = typeof content === 'string' ? Buffer.from(content) : content;
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function processIARArchive(
  fileBuffer: Buffer,
  archiveId: number
): Promise<ProcessedArchive> {
  const zip = new AdmZip(fileBuffer);
  const zipEntries = zip.getEntries();
  
  const files: InsertArchiveFile[] = [];
  const integrations: InsertIntegration[] = [];
  const flowArtifacts: InsertFlowArtifact[] = [];
  
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  
  // Process each file in the archive
  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;
    
    const content = entry.getData().toString('utf8');
    const hash = computeFileSHA256(content);
    
    // Store content for critical files regardless of size, others only if < 100KB
    const isCriticalFile = entry.entryName.toLowerCase().includes('project.xml') || 
                           entry.entryName.toLowerCase().endsWith('.bpel');
    files.push({
      archiveId,
      path: entry.entryName,
      hash,
      size: entry.header.size,
      content: (content.length < 100000 || isCriticalFile) ? content : null,
    });
    
    // Parse integration files
    if (entry.entryName.includes('icspackage') || entry.entryName.includes('project')) {
      try {
        if (entry.entryName.endsWith('.xml')) {
          const xmlData = parser.parse(content);
          
          // Extract integration metadata
          // This is a simplified parser - real OIC files have complex structure
          if (xmlData) {
            const integrationName = extractIntegrationName(entry.entryName, xmlData);
            if (integrationName) {
              const integration: InsertIntegration = {
                archiveId,
                name: integrationName,
                identifier: entry.entryName,
                version: '1.0',
                type: determineIntegrationType(entry.entryName),
                metadata: xmlData,
              };
              integrations.push(integration);
            }
          }
        }
      } catch (e) {
        console.error(`Failed to parse ${entry.entryName}:`, e);
      }
    }
  }
  
  return { files, integrations, flowArtifacts };
}

function extractIntegrationName(filename: string, xmlData: any): string | null {
  // Try to extract name from filename
  const parts = filename.split('/');
  const baseName = parts[parts.length - 1].replace('.xml', '');
  
  // Try to extract from XML structure
  if (xmlData?.integration?.['@_name']) {
    return xmlData.integration['@_name'];
  }
  if (xmlData?.orchestration?.['@_name']) {
    return xmlData.orchestration['@_name'];
  }
  
  return baseName || null;
}

function determineIntegrationType(filename: string): string {
  if (filename.includes('orchestration')) return 'orchestration';
  if (filename.includes('mapping')) return 'mapping';
  if (filename.includes('connection')) return 'connection';
  if (filename.includes('lookup')) return 'lookup';
  return 'unknown';
}

export function normalizeXML(xmlContent: string): string {
  // Remove timestamps, generated IDs, and other noise that OIC regenerates on export
  let normalized = xmlContent;
  
  // Remove common timestamp patterns
  normalized = normalized.replace(/timestamp="[^"]*"/g, 'timestamp=""');
  normalized = normalized.replace(/createdTime="[^"]*"/g, 'createdTime=""');
  normalized = normalized.replace(/modifiedTime="[^"]*"/g, 'modifiedTime=""');
  normalized = normalized.replace(/lastUpdatedTime="[^"]*"/g, 'lastUpdatedTime=""');
  
  // Remove OIC-generated xml:id attributes (these change on every export)
  normalized = normalized.replace(/xml:id="[^"]*"/g, '');
  normalized = normalized.replace(/xml:id='[^']*'/g, '');
  
  // Remove generatedId attributes
  normalized = normalized.replace(/generatedId="[^"]*"/g, '');
  
  // Normalize processor and resourcegroup references in paths (they change between versions)
  // These appear in location attributes like: location="../../processor_1234/resourcegroup_5678/file.wsdl"
  normalized = normalized.replace(/processor_\d+/g, 'processor_NORMALIZED');
  normalized = normalized.replace(/resourcegroup_\d+/g, 'resourcegroup_NORMALIZED');
  
  // Normalize application and inbound IDs in paths
  normalized = normalized.replace(/application_\d+/g, 'application_NORMALIZED');
  normalized = normalized.replace(/inbound_\d+/g, 'inbound_NORMALIZED');
  normalized = normalized.replace(/outbound_\d+/g, 'outbound_NORMALIZED');
  
  // Remove OIC namespace prefixes that may vary (orajs0, orajs1, etc.)
  normalized = normalized.replace(/xmlns:orajs\d+="[^"]*"/g, '');
  normalized = normalized.replace(/orajs\d+:/g, 'orajs:');
  
  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

export function extractFlowNodes(xmlData: any, integrationId: number): InsertFlowArtifact[] {
  const artifacts: InsertFlowArtifact[] = [];
  
  // This is simplified - real OIC orchestrations have complex nested structures
  if (xmlData?.orchestration?.sequence?.activities) {
    const activities = Array.isArray(xmlData.orchestration.sequence.activities)
      ? xmlData.orchestration.sequence.activities
      : [xmlData.orchestration.sequence.activities];
    
    activities.forEach((activity: any, index: number) => {
      if (activity) {
        artifacts.push({
          integrationId,
          nodeId: activity['@_id'] || `node_${index}`,
          nodeType: activity['@_type'] || 'activity',
          nodeName: activity['@_name'] || `Activity ${index + 1}`,
          position: { x: 100, y: 100 + (index * 100) },
          config: activity,
        });
      }
    });
  }
  
  return artifacts;
}
