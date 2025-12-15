import type { ArchiveFile, InsertDiffItem } from '../../shared/schema';
import { normalizeXML } from './fileProcessor';

export interface DiffSummary {
  high: number;
  medium: number;
  low: number;
  info: number;
  totalMeaningful: number;
  categories: {
    connections: number;
    mappings: number;
    flowLogic: number;
    lookups: number;
    configuration: number;
    other: number;
  };
}

export interface GroupedDiffItem extends InsertDiffItem {
  category: string;
  simpleDescription: string;
}

function normalizePath(path: string): string {
  let normalized = path;
  
  // Normalize OIC-generated numeric IDs in paths
  normalized = normalized.replace(/processor_\d+/g, 'processor_X');
  normalized = normalized.replace(/resourcegroup_\d+/g, 'resourcegroup_X');
  normalized = normalized.replace(/application_\d+/g, 'application_X');
  normalized = normalized.replace(/inbound_\d+/g, 'inbound_X');
  normalized = normalized.replace(/outbound_\d+/g, 'outbound_X');
  
  // Normalize OIC export UUIDs (itg_UUID patterns)
  normalized = normalized.replace(/itg_[a-f0-9-]+/g, 'itg_X');
  
  // Normalize version patterns in path (e.g., _01.00.0000)
  normalized = normalized.replace(/_\d{2}\.\d{2}\.\d{4}/g, '');
  
  // Remove numbered suffixes like (1), (2)
  normalized = normalized.replace(/\s*\(\d+\)/g, '');
  
  // Normalize request/response hex IDs (e.g., req_f7492c01fa004a12afb81056396dabdf)
  normalized = normalized.replace(/req_[a-f0-9]+/g, 'req_X');
  normalized = normalized.replace(/res_[a-f0-9]+/g, 'res_X');
  
  return normalized.replace(/\/+/g, '/').toLowerCase().trim();
}

function normalizeContent(content: string, path: string): string {
  const lowerPath = path.toLowerCase();
  
  // Apply XML normalization to XML-like files (safe to normalize whitespace)
  if (lowerPath.endsWith('.xml') || lowerPath.endsWith('.xsl') || lowerPath.endsWith('.xslt') || 
      lowerPath.endsWith('.wsdl') || lowerPath.endsWith('.xsd') || lowerPath.endsWith('.jca')) {
    return normalizeXML(content);
  }
  
  // For JSON files, normalize only OIC-specific noise patterns (preserve structure)
  if (lowerPath.endsWith('.json')) {
    let normalized = content;
    // Remove itg_ UUIDs in paths
    normalized = normalized.replace(/"itg_[a-f0-9-]+/g, '"itg_X');
    // Remove file paths with changing IDs (only in quoted strings)
    normalized = normalized.replace(/"\/tmp\/WC\/itg_[a-f0-9-]+/g, '"/tmp/WC/itg_X');
    // Normalize processor/resourcegroup IDs
    normalized = normalized.replace(/processor_\d+/g, 'processor_X');
    normalized = normalized.replace(/resourcegroup_\d+/g, 'resourcegroup_X');
    return normalized;
  }
  
  // For properties files, normalize only ID patterns (preserve content)
  if (lowerPath.endsWith('.properties')) {
    let normalized = content;
    normalized = normalized.replace(/processor_\d+/g, 'processor_X');
    normalized = normalized.replace(/resourcegroup_\d+/g, 'resourcegroup_X');
    normalized = normalized.replace(/itg_[a-f0-9-]+/g, 'itg_X');
    normalized = normalized.replace(/application_\d+/g, 'application_X');
    normalized = normalized.replace(/inbound_\d+/g, 'inbound_X');
    normalized = normalized.replace(/outbound_\d+/g, 'outbound_X');
    return normalized;
  }
  
  // For other files, apply only ID normalization (no whitespace changes to preserve semantics)
  let normalized = content;
  normalized = normalized.replace(/processor_\d+/g, 'processor_X');
  normalized = normalized.replace(/resourcegroup_\d+/g, 'resourcegroup_X');
  normalized = normalized.replace(/itg_[a-f0-9-]+/g, 'itg_X');
  normalized = normalized.replace(/application_\d+/g, 'application_X');
  normalized = normalized.replace(/inbound_\d+/g, 'inbound_X');
  normalized = normalized.replace(/outbound_\d+/g, 'outbound_X');
  
  return normalized;
}

function categorizeFile(path: string): string {
  const lowerPath = path.toLowerCase();
  if (lowerPath.includes('connection') || lowerPath.endsWith('.jca')) return 'connections';
  if (lowerPath.includes('mapping') || lowerPath.endsWith('.xsl') || lowerPath.endsWith('.xslt')) return 'mappings';
  if (lowerPath.includes('orchestration') || lowerPath.includes('bpel')) return 'flowLogic';
  if (lowerPath.includes('lookup') || lowerPath.includes('dvm')) return 'lookups';
  if (lowerPath.includes('schedule') || lowerPath.includes('tracking') || lowerPath.endsWith('.properties')) return 'configuration';
  return 'other';
}

function getSimpleDescription(path: string, changeType: string): string {
  const lowerPath = path.toLowerCase();
  const action = changeType === 'Added' ? 'added' : changeType === 'Removed' ? 'removed' : 'updated';
  
  if (lowerPath.includes('orchestration')) {
    return `Integration flow logic was ${action}`;
  }
  if (lowerPath.endsWith('.xsl') || lowerPath.endsWith('.xslt')) {
    const name = extractFriendlyName(path);
    return `Data mapping "${name}" was ${action}`;
  }
  if (lowerPath.includes('connection') || lowerPath.endsWith('.jca')) {
    const name = extractFriendlyName(path);
    return `Connection "${name}" settings were ${action}`;
  }
  if (lowerPath.includes('lookup') || lowerPath.includes('dvm')) {
    return `Lookup table data was ${action}`;
  }
  if (lowerPath.includes('schedule')) {
    return `Schedule timing was ${action}`;
  }
  if (lowerPath.includes('tracking')) {
    return `Business tracking fields were ${action}`;
  }
  if (lowerPath.endsWith('.wsdl')) {
    return `Web service definition was ${action}`;
  }
  if (lowerPath.endsWith('.xsd')) {
    return `Data schema was ${action}`;
  }
  if (lowerPath.includes('fault') || lowerPath.includes('error')) {
    return `Error handling was ${action}`;
  }
  return `Configuration was ${action}`;
}

function extractFriendlyName(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  return filename
    .replace(/\.(xml|xsl|xslt|jca|wsdl|xsd|properties)$/i, '')
    .replace(/^(req_|res_)[a-f0-9]+/i, 'Request/Response')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

function extractOICActionType(content: string | null, path: string): string | null {
  if (!content) return null;
  
  try {
    const lowerPath = path.toLowerCase();
    
    // Detect adapter type from JCA files
    const adapterTypeMatch = content.match(/adapter\s*=\s*"([^"]+)"/i);
    if (adapterTypeMatch) {
      const adapterType = adapterTypeMatch[1].toLowerCase();
      const adapterMap: Record<string, string> = {
        'atpdatabase': 'Database Adapter',
        'database': 'Database Adapter',
        'oracle/db': 'Database Adapter',
        'file': 'File Adapter',
        'ftp': 'FTP Adapter',
        'sftp': 'SFTP Adapter',
        'rest': 'REST Adapter',
        'soap': 'SOAP Adapter',
        'jms': 'JMS Adapter',
        'kafka': 'Kafka Adapter',
        'mq': 'MQ Adapter',
        'oic': 'OIC Invoke',
        'oracleerp': 'Oracle ERP Adapter',
        'oraclecrm': 'Oracle CRM Adapter',
        'salesforce': 'Salesforce Adapter',
        'sap': 'SAP Adapter',
        'workday': 'Workday Adapter',
        'servicenow': 'ServiceNow Adapter',
        'netsuite': 'NetSuite Adapter',
      };
      
      for (const [key, value] of Object.entries(adapterMap)) {
        if (adapterType.includes(key)) return value;
      }
    }
    
    // Detect BPEL activities from orchestration (handles namespaced tags like <bpel:invoke>)
    if (lowerPath.includes('orchestration') || /<\w*:?invoke/i.test(content)) {
      if (/<\w*:?invoke[\s>]/i.test(content)) return 'Invoke';
      if (/<\w*:?receive[\s>]/i.test(content)) return 'Receive';
      if (/<\w*:?reply[\s>]/i.test(content)) return 'Reply';
      if (/<\w*:?assign[\s>]/i.test(content)) return 'Assign';
      if (/<\w*:?switch[\s>]/i.test(content) || /<\w*:?if[\s>]/i.test(content)) return 'Switch';
      if (/<\w*:?while[\s>]/i.test(content)) return 'While Loop';
      if (/<\w*:?forEach[\s>]/i.test(content) || /<\w*:?repeatUntil[\s>]/i.test(content)) return 'For Each';
      if (/<\w*:?throw[\s>]/i.test(content)) return 'Throw';
      if (/<\w*:?catch[\s>]/i.test(content) || /<\w*:?faultHandlers[\s>]/i.test(content)) return 'Catch';
      if (/<\w*:?scope[\s>]/i.test(content)) return 'Scope';
      if (/<\w*:?sequence[\s>]/i.test(content)) return 'Sequence';
      if (/<\w*:?flow[\s>]/i.test(content)) return 'Parallel Flow';
      if (/<\w*:?pick[\s>]/i.test(content)) return 'Pick';
      if (/<\w*:?wait[\s>]/i.test(content)) return 'Wait';
    }
    
    // Detect Stage File action
    if (content.includes('StageFile') || content.includes('stage-file') || 
        lowerPath.includes('stagefile')) {
      if (content.includes('WriteFile') || content.includes('write')) return 'Stage File Write';
      if (content.includes('ReadFile') || content.includes('read')) return 'Stage File Read';
      if (content.includes('ListFile') || content.includes('list')) return 'Stage File List';
      return 'Stage File';
    }
    
    // Detect notification actions
    if (content.includes('notification') || content.includes('email')) {
      return 'Notification';
    }
    
    // Detect transformation from XSL
    if (lowerPath.endsWith('.xsl') || lowerPath.endsWith('.xslt')) {
      return 'Data Mapping';
    }
    
    // Detect JavaScript action
    if (content.includes('javascript') || content.includes('JavaScript')) {
      return 'JavaScript';
    }
    
    // Detect callback
    if (content.includes('callback') || content.includes('Callback')) {
      return 'Callback';
    }
    
    // Detect wait/delay
    if (content.includes('<wait') || content.includes('Wait')) {
      return 'Wait';
    }
    
    // Detect schedule
    if (lowerPath.includes('schedule') || content.includes('schedule')) {
      return 'Schedule';
    }
    
  } catch {
    // Ignore parsing errors
  }
  
  return null;
}

function extractOICObjectName(content: string | null, path: string): string | null {
  if (!content) return null;
  
  try {
    // Extract adapter-config name (e.g., <adapter-config name="Insert_EXTDATA_REQUEST" ...)
    const adapterMatch = content.match(/adapter-config\s+name="([^"]+)"/);
    if (adapterMatch) return adapterMatch[1];
    
    // Extract procedure name from JCA/adapter configs
    const procMatch = content.match(/ProcedureName"[^>]*value="([^"]+)"/);
    if (procMatch) return procMatch[1];
    
    // Extract table name from database configs
    const tableMatch = content.match(/TableName"[^>]*value="([^"]+)"/);
    if (tableMatch) return tableMatch[1];
    
    // Extract connection name
    const connMatch = content.match(/connection-factory\s+location="([^"]+)"/);
    if (connMatch) {
      const connName = connMatch[1].split('/').pop();
      if (connName) return connName;
    }
    
    // Extract operation name from WSDL
    const opMatch = content.match(/operation="([^"]+)"/);
    if (opMatch) return opMatch[1];
    
    // Extract schema element name
    const elemMatch = content.match(/xsd:element\s+name="([^"]+)"/);
    if (elemMatch) return elemMatch[1];
    
    // Extract targetNamespace for XSD/WSDL
    const nsMatch = content.match(/targetNamespace="[^"]*\/([^"/]+)"/);
    if (nsMatch) return nsMatch[1];
    
    // For JSON, try to extract meaningful keys
    if (content.trim().startsWith('{')) {
      const recordMatch = content.match(/"RECORD_NAME_KEY"\s*:\s*"([^"]+)"/);
      if (recordMatch) return recordMatch[1];
      const schemaMatch = content.match(/"SAMPLE_FILE_NAME_KEY"\s*:\s*"([^"]+)"/);
      if (schemaMatch) return schemaMatch[1].replace(/\.[^.]+$/, '');
    }
  } catch {
    // Ignore parsing errors
  }
  
  return null;
}

function generateChangeDescription(content: string | null, oldContent: string | null, changeType: string, path: string): string {
  const lowerPath = path.toLowerCase();
  
  if (changeType === 'Added') {
    const objName = extractOICObjectName(content, path);
    if (objName) return `New component "${objName}" was added to the integration`;
    if (lowerPath.includes('mapping') || lowerPath.endsWith('.xsl')) return 'New data transformation mapping was added';
    if (lowerPath.endsWith('.wsdl')) return 'New web service endpoint was configured';
    return 'New configuration file was added';
  }
  
  if (changeType === 'Removed') {
    const objName = extractOICObjectName(oldContent, path);
    if (objName) return `Component "${objName}" was removed from the integration`;
    if (lowerPath.includes('mapping') || lowerPath.endsWith('.xsl')) return 'Data transformation mapping was removed';
    if (lowerPath.endsWith('.wsdl')) return 'Web service endpoint was removed';
    return 'Configuration file was removed';
  }
  
  // Modified - detect specific changes
  if (content && oldContent) {
    const changes: string[] = [];
    
    // Check for connection string changes
    if (content.includes('ConnectionString') && oldContent.includes('ConnectionString')) {
      const oldConn = oldContent.match(/ConnectionString"[^>]*value="([^"]{20})/);
      const newConn = content.match(/ConnectionString"[^>]*value="([^"]{20})/);
      if (oldConn && newConn && oldConn[1] !== newConn[1]) {
        changes.push('Database connection string was updated');
      }
    }
    
    // Check for procedure name changes
    const oldProc = oldContent.match(/ProcedureName"[^>]*value="([^"]+)"/);
    const newProc = content.match(/ProcedureName"[^>]*value="([^"]+)"/);
    if (oldProc && newProc && oldProc[1] !== newProc[1]) {
      changes.push(`Stored procedure changed from "${oldProc[1]}" to "${newProc[1]}"`);
    }
    
    // Check for endpoint/URL changes
    const oldUrl = oldContent.match(/uriAbsoluteLocation>([^<]+)/);
    const newUrl = content.match(/uriAbsoluteLocation>([^<]+)/);
    if (oldUrl && newUrl && oldUrl[1] !== newUrl[1]) {
      changes.push('Service endpoint URL was updated');
    }
    
    // Check for schema changes in JSON
    if (lowerPath.endsWith('.json') || lowerPath.includes('metadata')) {
      const oldFields = oldContent.match(/"SAMPLE_COLUMN_HEADERS_KEY"\s*:\s*"([^"]+)"/);
      const newFields = content.match(/"SAMPLE_COLUMN_HEADERS_KEY"\s*:\s*"([^"]+)"/);
      if (oldFields && newFields && oldFields[1] !== newFields[1]) {
        changes.push('Data schema columns were modified');
      }
    }
    
    if (changes.length > 0) {
      return changes.join('. ');
    }
  }
  
  // Default descriptions
  const objName = extractOICObjectName(content, path);
  if (objName) return `Configuration for "${objName}" was modified`;
  if (lowerPath.includes('mapping') || lowerPath.endsWith('.xsl')) return 'Data transformation logic was updated';
  if (lowerPath.endsWith('.wsdl')) return 'Web service definition was modified';
  if (lowerPath.includes('connection')) return 'Connection settings were changed';
  
  return 'Configuration values were updated';
}

function getHumanReadableEntityType(path: string): string {
  const lowerPath = path.toLowerCase();
  if (lowerPath.includes('orchestration')) return 'Integration Flow';
  if (lowerPath.endsWith('.xsl') || lowerPath.endsWith('.xslt') || lowerPath.includes('mapping')) return 'Data Mapping';
  if (lowerPath.includes('connection') || lowerPath.endsWith('.jca')) return 'Connection';
  if (lowerPath.includes('lookup') || lowerPath.includes('dvm')) return 'Lookup Table';
  if (lowerPath.includes('schedule')) return 'Schedule';
  if (lowerPath.includes('tracking')) return 'Tracking';
  if (lowerPath.endsWith('.wsdl')) return 'Web Service';
  if (lowerPath.endsWith('.xsd')) return 'Data Schema';
  if (lowerPath.includes('fault') || lowerPath.includes('error')) return 'Error Handling';
  if (lowerPath.endsWith('.properties')) return 'Configuration';
  return 'Configuration';
}

function getHumanReadableEntityName(path: string): string {
  const entityType = getHumanReadableEntityType(path);
  const friendlyName = extractFriendlyName(path);
  
  if (friendlyName && friendlyName !== 'Request/Response' && friendlyName.length > 2) {
    return friendlyName;
  }
  return entityType;
}

export function computeFileDiff(
  leftFiles: ArchiveFile[],
  rightFiles: ArchiveFile[],
  diffRunId: number
): { items: InsertDiffItem[]; summary: DiffSummary } {
  const items: InsertDiffItem[] = [];
  const summary: DiffSummary = { 
    high: 0, 
    medium: 0, 
    low: 0, 
    info: 0,
    totalMeaningful: 0,
    categories: {
      connections: 0,
      mappings: 0,
      flowLogic: 0,
      lookups: 0,
      configuration: 0,
      other: 0,
    }
  };
  
  const leftMap = new Map<string, ArchiveFile>();
  const rightMap = new Map<string, ArchiveFile>();
  
  for (const f of leftFiles) {
    const normalized = normalizePath(f.path);
    leftMap.set(normalized, f);
  }
  
  for (const f of rightFiles) {
    const normalized = normalizePath(f.path);
    rightMap.set(normalized, f);
  }
  
  const allNormalizedPaths = new Set([...Array.from(leftMap.keys()), ...Array.from(rightMap.keys())]);
  
  const meaningfulChanges: InsertDiffItem[] = [];
  const minorChanges: InsertDiffItem[] = [];
  
  for (const normalizedPath of Array.from(allNormalizedPaths)) {
    const leftFile = leftMap.get(normalizedPath);
    const rightFile = rightMap.get(normalizedPath);
    
    let changeType: string;
    let severity: string;
    let riskReason: string | undefined;
    
    if (!leftFile) {
      changeType = 'Added';
      const analysis = analyzePathChange(normalizedPath, 'Added');
      severity = analysis.severity;
      riskReason = analysis.riskReason;
    } else if (!rightFile) {
      changeType = 'Removed';
      const analysis = analyzePathChange(normalizedPath, 'Removed');
      severity = analysis.severity;
      riskReason = analysis.riskReason;
    } else if (leftFile.hash !== rightFile.hash) {
      // Check if content is actually different after normalization
      if (leftFile.content && rightFile.content) {
        const leftNormalized = normalizeContent(leftFile.content, leftFile.path);
        const rightNormalized = normalizeContent(rightFile.content, rightFile.path);
        
        // Skip if content is the same after normalization (just noise differences)
        if (leftNormalized === rightNormalized) {
          continue;
        }
      }
      
      changeType = 'Modified';
      const analysis = analyzeFileChange(leftFile, rightFile);
      severity = analysis.severity;
      riskReason = analysis.riskReason;
    } else {
      continue;
    }
    
    const category = categorizeFile(normalizedPath);
    const simpleDescription = getSimpleDescription(normalizedPath, changeType);
    
    // Extract OIC object name from content
    const oicObjectName = extractOICObjectName(
      rightFile?.content || leftFile?.content || null,
      normalizedPath
    );
    
    // Extract OIC action type (e.g., "FTP Adapter", "Invoke", "Stage File")
    const actionType = extractOICActionType(
      rightFile?.content || leftFile?.content || null,
      normalizedPath
    );
    
    // Generate detailed change description
    const changeDescription = generateChangeDescription(
      rightFile?.content || null,
      leftFile?.content || null,
      changeType,
      normalizedPath
    );
    
    // Use OIC object name if found, otherwise fall back to path-based name
    const displayName = oicObjectName || getHumanReadableEntityName(normalizedPath);
    
    const item: InsertDiffItem = {
      diffRunId,
      entityType: getHumanReadableEntityType(normalizedPath),
      entityName: displayName,
      changeType,
      severity,
      riskReason: changeDescription, // Use rich description instead of generic risk reason
      leftRef: leftFile?.path || null,
      rightRef: rightFile?.path || null,
      diffPatch: generateDiffPatch(leftFile?.content || null, rightFile?.content || null),
      metadata: {
        leftHash: leftFile?.hash,
        rightHash: rightFile?.hash,
        path: normalizedPath,
        originalLeftPath: leftFile?.path,
        originalRightPath: rightFile?.path,
        category,
        simpleDescription,
        oicObjectName,
        actionType,
        changeDescription,
      },
    };
    
    if (severity === 'High' || severity === 'Medium') {
      meaningfulChanges.push(item);
    } else {
      minorChanges.push(item);
    }
    
    if (severity === 'High') summary.high++;
    else if (severity === 'Medium') summary.medium++;
    else if (severity === 'Low') summary.low++;
    else summary.info++;
    
    summary.categories[category as keyof typeof summary.categories]++;
  }
  
  meaningfulChanges.sort((a, b) => {
    const severityOrder = { 'High': 0, 'Medium': 1, 'Low': 2, 'Info': 3 };
    return (severityOrder[a.severity as keyof typeof severityOrder] || 3) - 
           (severityOrder[b.severity as keyof typeof severityOrder] || 3);
  });
  
  items.push(...meaningfulChanges, ...minorChanges);
  summary.totalMeaningful = summary.high + summary.medium;
  
  return { items, summary };
}

function analyzePathChange(path: string, changeType: string): { severity: string; riskReason: string } {
  const action = changeType === 'Added' ? 'added' : 'removed';
  const lowerPath = path.toLowerCase();
  
  if (lowerPath.includes('orchestration')) {
    return {
      severity: 'High',
      riskReason: `Integration flow was ${action}. This controls the main processing logic.`
    };
  }
  
  if (lowerPath.endsWith('.xsl') || lowerPath.endsWith('.xslt') || lowerPath.includes('mapping')) {
    return {
      severity: changeType === 'Removed' ? 'High' : 'Medium',
      riskReason: `Data transformation was ${action}. This affects how data is converted between systems.`
    };
  }
  
  if (lowerPath.includes('connection') || lowerPath.endsWith('.jca')) {
    return {
      severity: 'Medium',
      riskReason: `Connection configuration was ${action}. This affects connectivity to external systems.`
    };
  }
  
  if (lowerPath.endsWith('.wsdl') || lowerPath.endsWith('.xsd')) {
    return {
      severity: 'Medium',
      riskReason: `Service definition was ${action}. This may affect API compatibility.`
    };
  }
  
  if (lowerPath.includes('lookup') || lowerPath.includes('dvm')) {
    return {
      severity: 'Low',
      riskReason: `Lookup data was ${action}. Used for value translation.`
    };
  }
  
  if (lowerPath.includes('schedule')) {
    return {
      severity: 'Low',
      riskReason: `Schedule was ${action}. This controls when the integration runs.`
    };
  }
  
  return {
    severity: 'Info',
    riskReason: `Supporting file was ${action}.`
  };
}

function analyzeFileChange(leftFile: ArchiveFile, rightFile: ArchiveFile): {
  severity: string;
  riskReason: string;
} {
  const path = leftFile.path.toLowerCase();
  
  if (path.includes('orchestration')) {
    return {
      severity: 'High',
      riskReason: 'Integration flow logic changed. The processing steps or decision logic was modified.',
    };
  }
  
  if (path.endsWith('.xsl') || path.endsWith('.xslt') || path.includes('mapping')) {
    if (leftFile.content && rightFile.content) {
      const leftNormalized = normalizeXML(leftFile.content);
      const rightNormalized = normalizeXML(rightFile.content);
      
      if (leftNormalized !== rightNormalized) {
        return {
          severity: 'High',
          riskReason: 'Data transformation logic changed. The rules for converting data were modified.',
        };
      }
    }
    return {
      severity: 'Medium',
      riskReason: 'Data mapping updated with minor changes.',
    };
  }
  
  if (path.includes('connection') || path.endsWith('.jca')) {
    return {
      severity: 'Medium',
      riskReason: 'Connection settings changed. Endpoint URLs or credentials may have been updated.',
    };
  }
  
  if (path.endsWith('.wsdl')) {
    return {
      severity: 'Medium',
      riskReason: 'Web service definition changed. The API contract may have been updated.',
    };
  }
  
  if (path.endsWith('.xsd')) {
    return {
      severity: 'Medium',
      riskReason: 'Data schema changed. The expected data structure was modified.',
    };
  }
  
  if (path.includes('lookup') || path.includes('dvm')) {
    return {
      severity: 'Low',
      riskReason: 'Lookup values updated. Reference data for value translation was changed.',
    };
  }
  
  if (path.includes('schedule')) {
    return {
      severity: 'Low',
      riskReason: 'Schedule modified. The timing for when this integration runs was changed.',
    };
  }
  
  if (path.includes('tracking')) {
    return {
      severity: 'Low',
      riskReason: 'Tracking fields updated. Business identifiers for monitoring were changed.',
    };
  }
  
  if (path.endsWith('.properties')) {
    return {
      severity: 'Low',
      riskReason: 'Configuration values changed.',
    };
  }
  
  if (path.includes('error') || path.includes('fault')) {
    return {
      severity: 'Low',
      riskReason: 'Error handling changed. How failures are handled was modified.',
    };
  }
  
  return {
    severity: 'Info',
    riskReason: 'Supporting file modified.',
  };
}

function generateDiffPatch(leftContent: string | null, rightContent: string | null): string | null {
  if (!leftContent && !rightContent) return null;
  
  if (!leftContent) {
    return `+++ ADDED FILE +++\n\n${rightContent}`;
  }
  if (!rightContent) {
    return `--- REMOVED FILE ---\n\n${leftContent}`;
  }
  
  const leftLines = leftContent.split('\n');
  const rightLines = rightContent.split('\n');
  
  const diff: string[] = [];
  diff.push(`=== FILE MODIFIED ===`);
  diff.push(`Old: ${leftLines.length} lines, ${leftContent.length} bytes`);
  diff.push(`New: ${rightLines.length} lines, ${rightContent.length} bytes`);
  diff.push(`Change: ${rightContent.length - leftContent.length > 0 ? '+' : ''}${rightContent.length - leftContent.length} bytes`);
  diff.push('');
  
  const leftSet = new Set(leftLines.map(l => l.trim()));
  const rightSet = new Set(rightLines.map(l => l.trim()));
  
  const addedLines = rightLines.filter(l => !leftSet.has(l.trim()) && l.trim().length > 0);
  const removedLines = leftLines.filter(l => !rightSet.has(l.trim()) && l.trim().length > 0);
  
  if (removedLines.length > 0) {
    diff.push(`--- REMOVED (${removedLines.length} lines) ---`);
    removedLines.slice(0, 50).forEach(line => {
      diff.push(`- ${line}`);
    });
    if (removedLines.length > 50) {
      diff.push(`... and ${removedLines.length - 50} more removed lines`);
    }
    diff.push('');
  }
  
  if (addedLines.length > 0) {
    diff.push(`+++ ADDED (${addedLines.length} lines) +++`);
    addedLines.slice(0, 50).forEach(line => {
      diff.push(`+ ${line}`);
    });
    if (addedLines.length > 50) {
      diff.push(`... and ${addedLines.length - 50} more added lines`);
    }
  }
  
  if (addedLines.length === 0 && removedLines.length === 0) {
    diff.push('(Content differs only in whitespace or line ordering)');
  }
  
  return diff.join('\n');
}
