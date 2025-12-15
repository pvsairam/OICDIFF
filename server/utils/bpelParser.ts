import { XMLParser } from 'fast-xml-parser';

export interface FlowNode {
  id: string;
  type: 'trigger' | 'action' | 'switch' | 'loop' | 'scope' | 'error' | 'end';
  name: string;
  activityType: string;
  icon?: string;
  position: { x: number; y: number };
  data: Record<string, any>;
}

export interface FlowConnection {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'default' | 'conditional' | 'error';
}

export interface ParsedFlow {
  nodes: FlowNode[];
  connections: FlowConnection[];
  metadata: {
    processName: string;
    namespace?: string;
    version?: string;
  };
}

const ACTIVITY_TYPES = [
  'receive', 'invoke', 'reply', 'assign', 'throw', 'rethrow', 'exit',
  'wait', 'empty', 'sequence', 'flow', 'switch', 'if', 'while',
  'repeatUntil', 'forEach', 'pick', 'scope', 'compensate', 'compensateScope',
  'validate', 'extensionActivity'
];

const NODE_TYPE_MAP: Record<string, FlowNode['type']> = {
  receive: 'trigger',
  invoke: 'action',
  reply: 'end',
  assign: 'action',
  throw: 'error',
  rethrow: 'error',
  exit: 'end',
  wait: 'action',
  empty: 'action',
  sequence: 'scope',
  flow: 'scope',
  switch: 'switch',
  if: 'switch',
  while: 'loop',
  repeatUntil: 'loop',
  forEach: 'loop',
  pick: 'switch',
  scope: 'scope',
  compensate: 'action',
  compensateScope: 'action',
  validate: 'action',
  extensionActivity: 'action',
  catch: 'error',
  catchAll: 'error',
  faultHandlers: 'error',
};

const ICON_MAP: Record<string, string> = {
  receive: 'inbox',
  invoke: 'send',
  reply: 'reply',
  assign: 'copy',
  throw: 'alert-triangle',
  wait: 'clock',
  sequence: 'list',
  flow: 'git-branch',
  switch: 'git-fork',
  if: 'git-fork',
  while: 'repeat',
  forEach: 'repeat',
  pick: 'mouse-pointer',
  scope: 'box',
  catch: 'shield',
};

interface ParserContext {
  nodes: FlowNode[];
  connections: FlowConnection[];
  nodeCounter: number;
  connectionCounter: number;
  yPosition: number;
  xCenter: number;
  ySpacing: number;
}

function generateNodeId(ctx: ParserContext): string {
  ctx.nodeCounter++;
  return `node_${ctx.nodeCounter}`;
}

function generateConnectionId(ctx: ParserContext): string {
  ctx.connectionCounter++;
  return `edge_${ctx.connectionCounter}`;
}

function processActivity(
  ctx: ParserContext,
  activity: any,
  activityType: string,
  parentId: string | null,
  xOffset: number = 0
): string | null {
  if (!activity) return null;

  const nodeId = generateNodeId(ctx);
  const name = activity['@_name'] || activityType;

  const node: FlowNode = {
    id: nodeId,
    type: NODE_TYPE_MAP[activityType] || 'action',
    name,
    activityType,
    icon: ICON_MAP[activityType],
    position: { x: ctx.xCenter + xOffset, y: ctx.yPosition },
    data: extractActivityData(activity, activityType),
  };

  ctx.nodes.push(node);
  ctx.yPosition += ctx.ySpacing;

  if (parentId) {
    ctx.connections.push({
      id: generateConnectionId(ctx),
      source: parentId,
      target: nodeId,
      type: 'default',
    });
  }

  if (activityType === 'sequence') {
    const childActivities = extractActivities(activity);
    let prevId = nodeId;
    for (const [type, child] of childActivities) {
      const childId = processActivity(ctx, child, type, prevId, xOffset);
      if (childId) prevId = childId;
    }
    return prevId;
  }

  if (activityType === 'flow') {
    const childActivities = extractActivities(activity);
    const branchWidth = 200;
    const startX = -((childActivities.length - 1) * branchWidth) / 2;
    const flowEndId = generateNodeId(ctx);
    const flowStartY = ctx.yPosition;
    let maxY = ctx.yPosition;

    childActivities.forEach(([type, child], index) => {
      ctx.yPosition = flowStartY;
      const branchX = startX + index * branchWidth;
      const branchEndId = processActivity(ctx, child, type, nodeId, branchX);
      if (ctx.yPosition > maxY) maxY = ctx.yPosition;
      if (branchEndId) {
        ctx.connections.push({
          id: generateConnectionId(ctx),
          source: branchEndId,
          target: flowEndId,
          type: 'default',
        });
      }
    });

    ctx.yPosition = maxY;
    ctx.nodes.push({
      id: flowEndId,
      type: 'action',
      name: 'Join',
      activityType: 'flowEnd',
      position: { x: ctx.xCenter + xOffset, y: ctx.yPosition },
      data: {},
    });
    ctx.yPosition += ctx.ySpacing;
    return flowEndId;
  }

  if (activityType === 'if' || activityType === 'switch') {
    const branches = extractConditionalBranches(activity, activityType);
    const branchWidth = 200;
    const startX = -((branches.length - 1) * branchWidth) / 2;
    const condEndId = generateNodeId(ctx);
    const condStartY = ctx.yPosition;
    let maxY = ctx.yPosition;

    branches.forEach((branch, index) => {
      ctx.yPosition = condStartY;
      const branchX = startX + index * branchWidth;
      const branchActivities = extractActivities(branch.content);
      let prevId = nodeId;

      ctx.connections.push({
        id: generateConnectionId(ctx),
        source: nodeId,
        target: prevId,
        label: branch.label,
        type: 'conditional',
      });

      for (const [type, child] of branchActivities) {
        const childId = processActivity(ctx, child, type, prevId, branchX);
        if (childId) prevId = childId;
      }

      if (ctx.yPosition > maxY) maxY = ctx.yPosition;
      ctx.connections.push({
        id: generateConnectionId(ctx),
        source: prevId,
        target: condEndId,
        type: 'default',
      });
    });

    ctx.yPosition = maxY;
    ctx.nodes.push({
      id: condEndId,
      type: 'action',
      name: 'Merge',
      activityType: 'conditionEnd',
      position: { x: ctx.xCenter + xOffset, y: ctx.yPosition },
      data: {},
    });
    ctx.yPosition += ctx.ySpacing;
    return condEndId;
  }

  if (activityType === 'while' || activityType === 'repeatUntil' || activityType === 'forEach') {
    const loopBody = extractActivities(activity);
    let prevId = nodeId;
    for (const [type, child] of loopBody) {
      const childId = processActivity(ctx, child, type, prevId, xOffset);
      if (childId) prevId = childId;
    }
    ctx.connections.push({
      id: generateConnectionId(ctx),
      source: prevId,
      target: nodeId,
      label: 'loop',
      type: 'conditional',
    });
    return nodeId;
  }

  if (activityType === 'scope') {
    const scopeActivities = extractActivities(activity);
    let prevId = nodeId;
    for (const [type, child] of scopeActivities) {
      const childId = processActivity(ctx, child, type, prevId, xOffset);
      if (childId) prevId = childId;
    }

    const faultHandlers = activity.faultHandlers;
    if (faultHandlers) {
      const catches: any[] = [];
      if (faultHandlers.catch) {
        const catchList = Array.isArray(faultHandlers.catch) 
          ? faultHandlers.catch 
          : [faultHandlers.catch];
        catches.push(...catchList);
      }
      if (faultHandlers.catchAll) {
        catches.push(faultHandlers.catchAll);
      }

      catches.forEach((catchBlock, idx) => {
        const catchId = generateNodeId(ctx);
        ctx.nodes.push({
          id: catchId,
          type: 'error',
          name: catchBlock['@_faultName'] || `Catch ${idx + 1}`,
          activityType: 'catch',
          icon: ICON_MAP.catch,
          position: { x: ctx.xCenter + xOffset + 250, y: ctx.yPosition },
          data: { faultName: catchBlock['@_faultName'] },
        });
        ctx.connections.push({
          id: generateConnectionId(ctx),
          source: nodeId,
          target: catchId,
          label: 'error',
          type: 'error',
        });
        ctx.yPosition += ctx.ySpacing / 2;
      });
    }

    return prevId;
  }

  if (activityType === 'pick') {
    const onMessages = activity.onMessage 
      ? (Array.isArray(activity.onMessage) ? activity.onMessage : [activity.onMessage])
      : [];
    const onAlarms = activity.onAlarm
      ? (Array.isArray(activity.onAlarm) ? activity.onAlarm : [activity.onAlarm])
      : [];
    
    const pickBranches = [...onMessages, ...onAlarms];
    const branchWidth = 200;
    const startX = -((pickBranches.length - 1) * branchWidth) / 2;
    const pickEndId = generateNodeId(ctx);
    const pickStartY = ctx.yPosition;
    let maxY = ctx.yPosition;

    pickBranches.forEach((branch, index) => {
      ctx.yPosition = pickStartY;
      const branchX = startX + index * branchWidth;
      const branchActivities = extractActivities(branch);
      let prevId = nodeId;

      for (const [type, child] of branchActivities) {
        const childId = processActivity(ctx, child, type, prevId, branchX);
        if (childId) prevId = childId;
      }

      if (ctx.yPosition > maxY) maxY = ctx.yPosition;
      ctx.connections.push({
        id: generateConnectionId(ctx),
        source: prevId,
        target: pickEndId,
        type: 'default',
      });
    });

    ctx.yPosition = maxY;
    ctx.nodes.push({
      id: pickEndId,
      type: 'action',
      name: 'Pick End',
      activityType: 'pickEnd',
      position: { x: ctx.xCenter + xOffset, y: ctx.yPosition },
      data: {},
    });
    ctx.yPosition += ctx.ySpacing;
    return pickEndId;
  }

  return nodeId;
}

function findProcess(parsed: any): any {
  if (parsed.process) return parsed.process;
  for (const key of Object.keys(parsed)) {
    if (key.toLowerCase().includes('process')) {
      return parsed[key];
    }
    if (typeof parsed[key] === 'object' && parsed[key] !== null) {
      const found = findProcess(parsed[key]);
      if (found) return found;
    }
  }
  return null;
}

function extractActivities(container: any): [string, any][] {
  const activities: [string, any][] = [];

  if (!container || typeof container !== 'object') return activities;

  for (const key of Object.keys(container)) {
    const normalizedKey = key.replace(/^[a-zA-Z0-9]+:/, '').toLowerCase();
    
    if (ACTIVITY_TYPES.includes(normalizedKey)) {
      const value = container[key];
      if (Array.isArray(value)) {
        value.forEach(v => activities.push([normalizedKey, v]));
      } else {
        activities.push([normalizedKey, value]);
      }
    }
  }

  return activities;
}

function extractConditionalBranches(activity: any, type: string): { label: string; content: any }[] {
  const branches: { label: string; content: any }[] = [];

  if (type === 'if') {
    const condition = activity.condition?.['#text'] || activity.condition || 'condition';
    branches.push({ label: String(condition).substring(0, 30), content: activity });

    if (activity.elseif) {
      const elseifs = Array.isArray(activity.elseif) ? activity.elseif : [activity.elseif];
      elseifs.forEach((elseif: any, idx: number) => {
        const cond = elseif.condition?.['#text'] || elseif.condition || `elseif ${idx + 1}`;
        branches.push({ label: String(cond).substring(0, 30), content: elseif });
      });
    }

    if (activity.else) {
      branches.push({ label: 'else', content: activity.else });
    }
  } else if (type === 'switch') {
    const cases = activity.case 
      ? (Array.isArray(activity.case) ? activity.case : [activity.case])
      : [];
    
    cases.forEach((caseBlock: any, idx: number) => {
      const condition = caseBlock['@_condition'] || caseBlock.condition || `case ${idx + 1}`;
      branches.push({ label: String(condition).substring(0, 30), content: caseBlock });
    });

    if (activity.otherwise) {
      branches.push({ label: 'otherwise', content: activity.otherwise });
    }
  }

  return branches;
}

function extractActivityData(activity: any, type: string): Record<string, any> {
  const data: Record<string, any> = {};

  if (activity['@_partnerLink']) data.partnerLink = activity['@_partnerLink'];
  if (activity['@_operation']) data.operation = activity['@_operation'];
  if (activity['@_variable']) data.variable = activity['@_variable'];
  if (activity['@_inputVariable']) data.inputVariable = activity['@_inputVariable'];
  if (activity['@_outputVariable']) data.outputVariable = activity['@_outputVariable'];
  if (activity['@_faultName']) data.faultName = activity['@_faultName'];
  if (activity['@_createInstance']) data.createInstance = activity['@_createInstance'];

  if (type === 'forEach') {
    if (activity['@_counterName']) data.counterName = activity['@_counterName'];
    if (activity['@_parallel']) data.parallel = activity['@_parallel'];
    if (activity.startCounterValue) data.startValue = activity.startCounterValue;
    if (activity.finalCounterValue) data.finalValue = activity.finalCounterValue;
  }

  if (type === 'wait') {
    if (activity.for) data.duration = activity.for;
    if (activity.until) data.deadline = activity.until;
  }

  if (type === 'assign' && activity.copy) {
    const copies = Array.isArray(activity.copy) ? activity.copy : [activity.copy];
    data.copyCount = copies.length;
  }

  return data;
}

export function parseBpelFlow(xmlContent: string): ParsedFlow {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });

  const ctx: ParserContext = {
    nodes: [],
    connections: [],
    nodeCounter: 0,
    connectionCounter: 0,
    yPosition: 50,
    xCenter: 300,
    ySpacing: 120,
  };

  try {
    const parsed = parser.parse(xmlContent);
    const process = findProcess(parsed);

    if (!process) {
      return {
        nodes: [],
        connections: [],
        metadata: { processName: 'Unknown' }
      };
    }

    const processName = process['@_name'] || 'Unnamed Process';
    const namespace = process['@_targetNamespace'];

    const rootActivities = extractActivities(process);
    let prevId: string | null = null;

    for (const [type, activity] of rootActivities) {
      prevId = processActivity(ctx, activity, type, prevId, 0);
    }

    return {
      nodes: ctx.nodes,
      connections: ctx.connections,
      metadata: {
        processName,
        namespace,
      },
    };
  } catch (error) {
    console.error('Error parsing BPEL:', error);
    return {
      nodes: [],
      connections: [],
      metadata: { processName: 'Parse Error' },
    };
  }
}

export function parseBpelFromArchiveFiles(
  files: { path: string; content: string | null }[]
): ParsedFlow | null {
  // First try Gen3 project.xml with orchestration section
  const gen3Flow = parseGen3FromArchiveFiles(files);
  if (gen3Flow && gen3Flow.nodes.length > 0) {
    return gen3Flow;
  }
  
  // Fall back to BPEL parsing for Gen2 integrations
  const bpelFile = files.find(f => {
    if (!f.content) return false;
    const lowerPath = f.path.toLowerCase();
    const hasBpelPath = lowerPath.includes('orchestration') || 
                        lowerPath.endsWith('.bpel') ||
                        lowerPath.includes('bpel');
    const hasBpelContent = f.content.includes('<process') || f.content.includes(':process');
    return hasBpelPath && hasBpelContent;
  });

  if (!bpelFile || !bpelFile.content) {
    return null;
  }

  return parseBpelFlow(bpelFile.content);
}

// Gen3 OIC Parser - parses project.xml orchestration section
const GEN3_NODE_TYPES: Record<string, FlowNode['type']> = {
  receive: 'trigger',
  transformer: 'action',
  invoke: 'action',
  stageFile: 'action',
  try: 'scope',
  catchAll: 'error',
  activityStreamLogger: 'action',
  stop: 'end',
  switch: 'switch',
  otherwise: 'action',
  case: 'switch',
  forEach: 'loop',
  assign: 'action',
};

const GEN3_ICON_MAP: Record<string, string> = {
  receive: 'inbox',
  transformer: 'shuffle',
  invoke: 'database',
  stageFile: 'file',
  try: 'shield',
  catchAll: 'alert-triangle',
  activityStreamLogger: 'activity',
  stop: 'square',
  switch: 'git-fork',
  forEach: 'repeat',
  assign: 'copy',
};

interface Gen3ParserContext {
  nodes: FlowNode[];
  connections: FlowConnection[];
  nodeCounter: number;
  connectionCounter: number;
  yPosition: number;
  xCenter: number;
  ySpacing: number;
  applications: Map<string, { name: string; role: string; type: string; code: string }>;
  processors: Map<string, { type: string; role: string }>;
}

function parseGen3Orchestration(xmlContent: string): ParsedFlow {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });

  const ctx: Gen3ParserContext = {
    nodes: [],
    connections: [],
    nodeCounter: 0,
    connectionCounter: 0,
    yPosition: 50,
    xCenter: 400,
    ySpacing: 100,
    applications: new Map(),
    processors: new Map(),
  };

  try {
    const parsed = parser.parse(xmlContent);
    
    // Find icsproject/icsflow structure
    const project = parsed.icsproject;
    if (!project) return { nodes: [], connections: [], metadata: { processName: 'Unknown' } };
    
    const flow = project.icsflow;
    if (!flow) return { nodes: [], connections: [], metadata: { processName: 'Unknown' } };

    // Index applications (source/target adapters)
    if (flow.application) {
      const apps = Array.isArray(flow.application) ? flow.application : [flow.application];
      for (const app of apps) {
        const name = app['@_name'];
        const adapter = app.adapter || {};
        ctx.applications.set(name, {
          name: adapter.name || name,
          role: app.role || 'unknown',
          type: adapter.type || 'unknown',
          code: adapter.code || '',
        });
      }
    }

    // Index processors (transformer, stageFile, etc.)
    if (flow.processor) {
      const procs = Array.isArray(flow.processor) ? flow.processor : [flow.processor];
      for (const proc of procs) {
        const name = proc['@_name'];
        ctx.processors.set(name, {
          type: proc.type || 'unknown',
          role: proc.role || '',
        });
      }
    }

    // Find orchestration section
    const orchestration = findOrchestration(flow);
    if (!orchestration) {
      return { nodes: [], connections: [], metadata: { processName: project.projectName || 'Unknown' } };
    }

    // Parse the orchestration flow
    const globalTry = orchestration.globalTry;
    if (globalTry) {
      processGen3Element(ctx, globalTry, null, 0);
    }

    return {
      nodes: ctx.nodes,
      connections: ctx.connections,
      metadata: {
        processName: project.projectName || project.projectCode || 'OIC Integration',
        version: project.projectVersion,
      },
    };
  } catch (error) {
    console.error('Error parsing Gen3 project.xml:', error);
    return { nodes: [], connections: [], metadata: { processName: 'Parse Error' } };
  }
}

function findOrchestration(flow: any): any {
  // Look for orchestration in various locations
  if (flow.orchestration) return flow.orchestration;
  
  // Check messageContext array for embedded orchestration
  if (flow.messageContext) {
    const contexts = Array.isArray(flow.messageContext) ? flow.messageContext : [flow.messageContext];
    for (const ctx of contexts) {
      if (ctx.orchestration) return ctx.orchestration;
      if (ctx.globalTry) return ctx;
    }
  }
  
  // Direct globalTry
  if (flow.globalTry) return { globalTry: flow.globalTry };
  
  return null;
}

function processGen3Element(
  ctx: Gen3ParserContext,
  element: any,
  parentId: string | null,
  xOffset: number
): string | null {
  if (!element || typeof element !== 'object') return parentId;

  let lastNodeId = parentId;

  // Process orchestration elements in order
  const orchestrationElements = [
    'integrationMetadata', 'receive', 'transformer', 'invoke', 'stageFile',
    'try', 'switch', 'forEach', 'assign', 'activityStreamLogger', 'stop', 'case', 'otherwise'
  ];

  for (const elemType of orchestrationElements) {
    if (element[elemType]) {
      const items = Array.isArray(element[elemType]) ? element[elemType] : [element[elemType]];
      for (const item of items) {
        const nodeId = createGen3Node(ctx, elemType, item, lastNodeId, xOffset);
        if (nodeId) lastNodeId = nodeId;
      }
    }
  }

  // Handle catchAll separately (it's an error handler, connected differently)
  if (element.catchAll) {
    const catchItems = Array.isArray(element.catchAll) ? element.catchAll : [element.catchAll];
    for (const item of catchItems) {
      createGen3Node(ctx, 'catchAll', item, parentId, xOffset + 250);
    }
  }

  return lastNodeId;
}

function createGen3Node(
  ctx: Gen3ParserContext,
  elemType: string,
  element: any,
  parentId: string | null,
  xOffset: number
): string | null {
  // Skip metadata nodes
  if (elemType === 'integrationMetadata') return parentId;

  ctx.nodeCounter++;
  const nodeId = `gen3_node_${ctx.nodeCounter}`;

  // Get display name
  let displayName = element['@_name'] || element['@_id'] || elemType;
  let activityType = elemType;

  // Enrich with application/processor info
  const refUri = element['@_refUri'];
  if (refUri) {
    const appMatch = refUri.match(/^(application_\d+)/);
    if (appMatch) {
      const app = ctx.applications.get(appMatch[1]);
      if (app) {
        displayName = app.name;
        activityType = `${elemType} (${app.code || app.type})`;
      }
    }
    const procMatch = refUri.match(/^(processor_\d+)/);
    if (procMatch) {
      const proc = ctx.processors.get(procMatch[1]);
      if (proc) {
        if (proc.type === 'transformer') {
          displayName = element['@_name'] || 'Map';
          activityType = 'Map';
        } else if (proc.type === 'stageFile' || proc.type.includes('stage')) {
          displayName = 'Stage File';
          activityType = 'Stage File';
        }
      }
    }
  }

  // Extract additional metadata for detailed view
  const nodeData: Record<string, any> = { 
    id: element['@_id'], 
    refUri,
  };
  
  // Extract application/connection info
  if (refUri) {
    const appMatch = refUri.match(/^(application_\d+)/);
    if (appMatch) {
      const app = ctx.applications.get(appMatch[1]);
      if (app) {
        nodeData.partnerLink = app.name;
        nodeData.adapterType = app.type;
        nodeData.adapterCode = app.code;
        nodeData.role = app.role;
      }
    }
  }
  
  // Extract operation info from nested elements
  if (element.operation) {
    const op = Array.isArray(element.operation) ? element.operation[0] : element.operation;
    nodeData.operation = op?.['@_name'] || op?.name;
  }
  
  // Extract variable info
  if (element['@_outputVariable']) {
    nodeData.variable = element['@_outputVariable'];
  }
  if (element['@_inputVariable']) {
    nodeData.inputVariable = element['@_inputVariable'];
  }
  
  // Extract endpoint/URL for invoke activities
  if (element.endpoint || element.endpointUrl) {
    nodeData.endpoint = element.endpoint || element.endpointUrl;
  }
  
  // Count children for scope/try nodes
  if (elemType === 'try' || elemType === 'switch' || elemType === 'forEach' || elemType === 'scope') {
    let childCount = 0;
    const childElements = ['transformer', 'invoke', 'assign', 'stageFile'];
    for (const childType of childElements) {
      if (element[childType]) {
        const items = Array.isArray(element[childType]) ? element[childType] : [element[childType]];
        childCount += items.length;
      }
    }
    nodeData.childCount = childCount;
    nodeData.hasErrorHandler = !!element.catchAll;
  }
  
  // Extract condition for switch nodes
  if (element.case) {
    const cases = Array.isArray(element.case) ? element.case : [element.case];
    nodeData.branchCount = cases.length + (element.otherwise ? 1 : 0);
  }

  const node: FlowNode = {
    id: nodeId,
    type: GEN3_NODE_TYPES[elemType] || 'action',
    name: displayName,
    activityType,
    icon: GEN3_ICON_MAP[elemType],
    position: { x: ctx.xCenter + xOffset, y: ctx.yPosition },
    data: nodeData,
  };

  ctx.nodes.push(node);
  ctx.yPosition += ctx.ySpacing;

  // Connect to parent
  if (parentId) {
    ctx.connectionCounter++;
    ctx.connections.push({
      id: `gen3_edge_${ctx.connectionCounter}`,
      source: parentId,
      target: nodeId,
      type: elemType === 'catchAll' ? 'error' : 'default',
      label: elemType === 'catchAll' ? 'error' : undefined,
    });
  }

  // Process nested elements for try/switch/forEach
  if (elemType === 'try' || elemType === 'switch' || elemType === 'forEach') {
    const tryEndY = ctx.yPosition;
    processGen3Element(ctx, element, nodeId, xOffset);
    
    // Add end node for scope
    ctx.nodeCounter++;
    const endId = `gen3_node_${ctx.nodeCounter}`;
    ctx.nodes.push({
      id: endId,
      type: 'action',
      name: `End ${displayName}`,
      activityType: `${elemType}End`,
      position: { x: ctx.xCenter + xOffset, y: ctx.yPosition },
      data: {},
    });
    ctx.yPosition += ctx.ySpacing;
    
    // Connect last inner node to end
    const lastInner = ctx.nodes[ctx.nodes.length - 2];
    if (lastInner && lastInner.id !== nodeId) {
      ctx.connectionCounter++;
      ctx.connections.push({
        id: `gen3_edge_${ctx.connectionCounter}`,
        source: lastInner.id,
        target: endId,
        type: 'default',
      });
    }
    
    return endId;
  }

  return nodeId;
}

function parseGen3FromArchiveFiles(
  files: { path: string; content: string | null }[]
): ParsedFlow | null {
  // Look for project.xml with orchestration section
  const projectFile = files.find(f => {
    if (!f.content) return false;
    const lowerPath = f.path.toLowerCase();
    return lowerPath.includes('project-inf/project.xml') || 
           (lowerPath.endsWith('project.xml') && f.content.includes('orchestration'));
  });

  if (!projectFile || !projectFile.content) {
    return null;
  }

  return parseGen3Orchestration(projectFile.content);
}
