import { useCallback, useMemo, useState, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import {
  Inbox,
  Send,
  Reply,
  Copy,
  AlertTriangle,
  Clock,
  List,
  GitBranch,
  GitFork,
  Repeat,
  MousePointer,
  Box,
  Shield,
  ArrowDown,
  ArrowRight,
  Database,
  Globe,
  FileText,
  Zap,
  Link,
  ChevronDown,
  ChevronUp,
  Info,
  Maximize2,
  X,
} from 'lucide-react';

interface FlowNode {
  id: string;
  type: 'trigger' | 'action' | 'switch' | 'loop' | 'scope' | 'error' | 'end';
  name: string;
  activityType: string;
  icon?: string;
  position: { x: number; y: number };
  data: Record<string, any>;
}

interface FlowConnection {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'default' | 'conditional' | 'error';
}

interface ParsedFlow {
  nodes: FlowNode[];
  connections: FlowConnection[];
  metadata: {
    processName: string;
    namespace?: string;
    version?: string;
  };
}

type NodeChangeStatus = 'added' | 'removed' | 'modified' | 'unchanged';

interface NodeChanges {
  [nodeId: string]: NodeChangeStatus;
}

interface FlowDiagramProps {
  flow: ParsedFlow | null;
  className?: string;
  side?: 'left' | 'right';
  orientation?: 'vertical' | 'horizontal';
  onOrientationChange?: (orientation: 'vertical' | 'horizontal') => void;
  showControls?: boolean;
  nodeChanges?: NodeChanges;
}

export function compareFlows(leftFlow: ParsedFlow | null, rightFlow: ParsedFlow | null): { leftChanges: NodeChanges; rightChanges: NodeChanges } {
  const leftChanges: NodeChanges = {};
  const rightChanges: NodeChanges = {};
  
  if (!leftFlow || !rightFlow) {
    return { leftChanges, rightChanges };
  }
  
  const leftNodeMap = new Map(leftFlow.nodes.map(n => [n.name.toLowerCase(), n]));
  const rightNodeMap = new Map(rightFlow.nodes.map(n => [n.name.toLowerCase(), n]));
  
  for (const node of leftFlow.nodes) {
    const key = node.name.toLowerCase();
    const rightNode = rightNodeMap.get(key);
    
    if (!rightNode) {
      leftChanges[node.id] = 'removed';
    } else if (
      node.activityType !== rightNode.activityType ||
      node.type !== rightNode.type ||
      JSON.stringify(node.data) !== JSON.stringify(rightNode.data)
    ) {
      leftChanges[node.id] = 'modified';
    } else {
      leftChanges[node.id] = 'unchanged';
    }
  }
  
  for (const node of rightFlow.nodes) {
    const key = node.name.toLowerCase();
    const leftNode = leftNodeMap.get(key);
    
    if (!leftNode) {
      rightChanges[node.id] = 'added';
    } else if (
      node.activityType !== leftNode.activityType ||
      node.type !== leftNode.type ||
      JSON.stringify(node.data) !== JSON.stringify(leftNode.data)
    ) {
      rightChanges[node.id] = 'modified';
    } else {
      rightChanges[node.id] = 'unchanged';
    }
  }
  
  return { leftChanges, rightChanges };
}

const iconMap: Record<string, React.ComponentType<any>> = {
  inbox: Inbox,
  send: Send,
  reply: Reply,
  copy: Copy,
  'alert-triangle': AlertTriangle,
  clock: Clock,
  list: List,
  'git-branch': GitBranch,
  'git-fork': GitFork,
  repeat: Repeat,
  'mouse-pointer': MousePointer,
  box: Box,
  shield: Shield,
  database: Database,
  globe: Globe,
  file: FileText,
  zap: Zap,
  link: Link,
};

function getActivityIcon(activityType: string): React.ComponentType<any> {
  const typeMap: Record<string, React.ComponentType<any>> = {
    receive: Inbox,
    reply: Reply,
    invoke: Send,
    assign: Copy,
    transform: Copy,
    transformer: Copy,
    map: Copy,
    switch: GitFork,
    while: Repeat,
    forEach: Repeat,
    scope: Box,
    try: Shield,
    catch: AlertTriangle,
    catchAll: AlertTriangle,
    stageFile: FileText,
    readFile: FileText,
    writeFile: FileText,
    wait: Clock,
    stop: Reply,
    notification: Send,
  };
  return typeMap[activityType] || Zap;
}

function getActivityDescription(activityType: string): string {
  const descMap: Record<string, string> = {
    receive: 'Trigger / Entry Point',
    reply: 'Send Response',
    invoke: 'Call External Service',
    assign: 'Data Mapping',
    transform: 'Transform Data',
    transformer: 'Data Transformation',
    map: 'Map Variables',
    switch: 'Conditional Branch',
    while: 'While Loop',
    forEach: 'For Each Loop',
    scope: 'Scope Container',
    try: 'Try Block',
    catch: 'Catch Handler',
    catchAll: 'Global Error Handler',
    stageFile: 'Stage File Operation',
    readFile: 'Read File',
    writeFile: 'Write File',
    wait: 'Wait/Delay',
    stop: 'End Integration',
    notification: 'Send Notification',
  };
  return descMap[activityType] || activityType;
}

function getChangeStatusStyles(changeStatus: NodeChangeStatus | undefined): { ring: string; badge: { bg: string; text: string; label: string } | null } {
  switch (changeStatus) {
    case 'added':
      return { 
        ring: 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-900',
        badge: { bg: 'bg-emerald-500', text: 'text-white', label: 'NEW' }
      };
    case 'removed':
      return { 
        ring: 'ring-2 ring-rose-400 ring-offset-2 ring-offset-slate-900',
        badge: { bg: 'bg-rose-500', text: 'text-white', label: 'REMOVED' }
      };
    case 'modified':
      return { 
        ring: 'ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900',
        badge: { bg: 'bg-amber-500', text: 'text-white', label: 'MODIFIED' }
      };
    default:
      return { ring: '', badge: null };
  }
}

function ChangeStatusBadge({ changeStatus }: { changeStatus: NodeChangeStatus | undefined }) {
  const styles = getChangeStatusStyles(changeStatus);
  if (!styles.badge) return null;
  
  return (
    <div className={`absolute -top-2 -right-2 ${styles.badge.bg} ${styles.badge.text} text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-lg z-10`}>
      {styles.badge.label}
    </div>
  );
}

function DetailedTriggerNode({ data }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = data.isSelected;
  const changeStyles = getChangeStatusStyles(data.changeStatus);
  const hasChange = data.changeStatus && data.changeStatus !== 'unchanged';
  
  return (
    <div
      className={`relative flex flex-col items-stretch min-w-48 transition-all rounded-lg ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900 scale-105' : hasChange ? changeStyles.ring : ''}`}
      data-testid={`flow-node-trigger-${data.id}`}
    >
      <ChangeStatusBadge changeStatus={data.changeStatus} />
      <div 
        className={`bg-gradient-to-r from-teal-600 to-teal-700 rounded-t-lg p-3 cursor-pointer ${isSelected ? 'shadow-lg shadow-blue-500/30' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-teal-400/30 flex items-center justify-center">
            <Inbox className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-teal-200 font-medium">TRIGGER</div>
            <div className="text-sm font-semibold text-white truncate">{data.label}</div>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-teal-300" />
          ) : (
            <ChevronDown className="w-4 h-4 text-teal-300" />
          )}
        </div>
      </div>
      {expanded && (
        <div className="bg-slate-800 border border-t-0 border-teal-600/50 rounded-b-lg p-3 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400">Type:</span>
            <span className="text-slate-200">{data.activityType || 'REST/SOAP'}</span>
          </div>
          {data.operation && (
            <div className="flex justify-between">
              <span className="text-slate-400">Operation:</span>
              <span className="text-slate-200">{data.operation}</span>
            </div>
          )}
          {data.endpoint && (
            <div className="flex justify-between">
              <span className="text-slate-400">Endpoint:</span>
              <span className="text-slate-200 truncate max-w-24">{data.endpoint}</span>
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={data.orientation === 'horizontal' ? Position.Right : Position.Bottom} className="!bg-teal-400 !w-3 !h-3" />
    </div>
  );
}

function DetailedActionNode({ data }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const IconComponent = data.icon ? iconMap[data.icon] : getActivityIcon(data.activityType);
  const isMapping = data.activityType === 'assign' || data.activityType?.includes('map') || data.activityType?.includes('transform');
  const description = getActivityDescription(data.activityType);
  const isSelected = data.isSelected;
  const changeStyles = getChangeStatusStyles(data.changeStatus);
  const hasChange = data.changeStatus && data.changeStatus !== 'unchanged';
  
  const bgColor = isMapping 
    ? 'from-teal-600/80 to-teal-700/80' 
    : 'from-slate-600 to-slate-700';
  const borderColor = isMapping ? 'border-teal-500/50' : 'border-slate-500/50';
  
  return (
    <div
      className={`relative flex flex-col items-stretch min-w-48 transition-all rounded-lg ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900 scale-105' : hasChange ? changeStyles.ring : ''}`}
      data-testid={`flow-node-action-${data.id}`}
    >
      <ChangeStatusBadge changeStatus={data.changeStatus} />
      <Handle type="target" position={data.orientation === 'horizontal' ? Position.Left : Position.Top} className="!bg-slate-400 !w-3 !h-3" />
      <div 
        className={`bg-gradient-to-r ${bgColor} rounded-t-lg p-3 cursor-pointer border ${borderColor} border-b-0`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center ${isMapping ? 'bg-teal-400/30' : 'bg-slate-500/50'}`}>
            {IconComponent && <IconComponent className="w-4 h-4 text-white" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-300 font-medium uppercase">{description}</div>
            <div className="text-sm font-semibold text-white truncate">{data.label}</div>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </div>
      {expanded && (
        <div className={`bg-slate-800 border border-t-0 ${borderColor} rounded-b-lg p-3 text-xs space-y-2`}>
          <div className="flex justify-between">
            <span className="text-slate-400">Activity:</span>
            <span className="text-slate-200">{data.activityType}</span>
          </div>
          {data.partnerLink && (
            <div className="flex justify-between">
              <span className="text-slate-400">Connection:</span>
              <span className="text-slate-200 truncate max-w-24">{data.partnerLink}</span>
            </div>
          )}
          {data.operation && (
            <div className="flex justify-between">
              <span className="text-slate-400">Operation:</span>
              <span className="text-slate-200">{data.operation}</span>
            </div>
          )}
          {data.variable && (
            <div className="flex justify-between">
              <span className="text-slate-400">Variable:</span>
              <span className="text-slate-200 truncate max-w-24">{data.variable}</span>
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={data.orientation === 'horizontal' ? Position.Right : Position.Bottom} className="!bg-slate-400 !w-3 !h-3" />
    </div>
  );
}

function DetailedSwitchNode({ data }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = data.isSelected;
  const changeStyles = getChangeStatusStyles(data.changeStatus);
  const hasChange = data.changeStatus && data.changeStatus !== 'unchanged';
  
  return (
    <div
      className={`relative flex flex-col items-stretch min-w-48 transition-all rounded-lg ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900 scale-105' : hasChange ? changeStyles.ring : ''}`}
      data-testid={`flow-node-switch-${data.id}`}
    >
      <ChangeStatusBadge changeStatus={data.changeStatus} />
      <Handle type="target" position={data.orientation === 'horizontal' ? Position.Left : Position.Top} className="!bg-amber-400 !w-3 !h-3" />
      <div 
        className="bg-gradient-to-r from-amber-600 to-amber-700 rounded-t-lg p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-amber-400/30 flex items-center justify-center">
            <GitFork className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-amber-200 font-medium">SWITCH / IF</div>
            <div className="text-sm font-semibold text-white truncate">{data.label}</div>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-amber-300" />
          ) : (
            <ChevronDown className="w-4 h-4 text-amber-300" />
          )}
        </div>
      </div>
      {expanded && (
        <div className="bg-slate-800 border border-t-0 border-amber-600/50 rounded-b-lg p-3 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400">Branches:</span>
            <span className="text-slate-200">{data.branchCount || 2}</span>
          </div>
          {data.condition && (
            <div className="mt-2">
              <span className="text-slate-400">Condition:</span>
              <div className="text-slate-200 font-mono text-xs mt-1 bg-slate-900 p-2 rounded truncate">
                {data.condition}
              </div>
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={data.orientation === 'horizontal' ? Position.Right : Position.Bottom} className="!bg-amber-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-amber-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-amber-400 !w-2 !h-2" />
    </div>
  );
}

function DetailedLoopNode({ data }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isForEach = data.activityType === 'forEach';
  const isSelected = data.isSelected;
  const changeStyles = getChangeStatusStyles(data.changeStatus);
  const hasChange = data.changeStatus && data.changeStatus !== 'unchanged';
  
  return (
    <div
      className={`relative flex flex-col items-stretch min-w-48 transition-all rounded-lg ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900 scale-105' : hasChange ? changeStyles.ring : ''}`}
      data-testid={`flow-node-loop-${data.id}`}
    >
      <ChangeStatusBadge changeStatus={data.changeStatus} />
      <Handle type="target" position={data.orientation === 'horizontal' ? Position.Left : Position.Top} className="!bg-violet-400 !w-3 !h-3" />
      <div 
        className="bg-gradient-to-r from-violet-600 to-violet-700 rounded-t-lg p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-violet-400/30 flex items-center justify-center">
            <Repeat className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-violet-200 font-medium">{isForEach ? 'FOR EACH' : 'WHILE LOOP'}</div>
            <div className="text-sm font-semibold text-white truncate">{data.label}</div>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-violet-300" />
          ) : (
            <ChevronDown className="w-4 h-4 text-violet-300" />
          )}
        </div>
      </div>
      {expanded && (
        <div className="bg-slate-800 border border-t-0 border-violet-600/50 rounded-b-lg p-3 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400">Type:</span>
            <span className="text-slate-200">{isForEach ? 'For Each' : 'While'}</span>
          </div>
          {data.collection && (
            <div className="flex justify-between">
              <span className="text-slate-400">Collection:</span>
              <span className="text-slate-200 truncate max-w-24">{data.collection}</span>
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={data.orientation === 'horizontal' ? Position.Right : Position.Bottom} className="!bg-violet-400 !w-3 !h-3" />
    </div>
  );
}

function DetailedScopeNode({ data }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isTry = data.activityType === 'try';
  const isSelected = data.isSelected;
  const changeStyles = getChangeStatusStyles(data.changeStatus);
  const hasChange = data.changeStatus && data.changeStatus !== 'unchanged';
  
  return (
    <div
      className={`relative flex flex-col items-stretch min-w-48 transition-all rounded-lg ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900 scale-105' : hasChange ? changeStyles.ring : ''}`}
      data-testid={`flow-node-scope-${data.id}`}
    >
      <ChangeStatusBadge changeStatus={data.changeStatus} />
      <Handle type="target" position={data.orientation === 'horizontal' ? Position.Left : Position.Top} className="!bg-indigo-400 !w-3 !h-3" />
      <div 
        className={`bg-gradient-to-r ${isTry ? 'from-indigo-600 to-indigo-700' : 'from-slate-600 to-slate-700'} rounded-t-lg p-3 cursor-pointer border-2 border-dashed ${isTry ? 'border-indigo-400/50' : 'border-slate-400/50'}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center ${isTry ? 'bg-indigo-400/30' : 'bg-slate-500/50'}`}>
            <Box className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-300 font-medium">{isTry ? 'TRY BLOCK' : 'SCOPE'}</div>
            <div className="text-sm font-semibold text-white truncate">{data.label}</div>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </div>
      {expanded && (
        <div className="bg-slate-800 border-2 border-t-0 border-dashed border-indigo-400/30 rounded-b-lg p-3 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400">Contains:</span>
            <span className="text-slate-200">{data.childCount || 0} activities</span>
          </div>
          {data.hasErrorHandler && (
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              <span>Has error handler</span>
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={data.orientation === 'horizontal' ? Position.Right : Position.Bottom} className="!bg-indigo-400 !w-3 !h-3" />
    </div>
  );
}

function DetailedErrorNode({ data }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = data.isSelected;
  const changeStyles = getChangeStatusStyles(data.changeStatus);
  const hasChange = data.changeStatus && data.changeStatus !== 'unchanged';
  
  return (
    <div
      className={`relative flex flex-col items-stretch min-w-48 transition-all rounded-lg ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900 scale-105' : hasChange ? changeStyles.ring : ''}`}
      data-testid={`flow-node-error-${data.id}`}
    >
      <ChangeStatusBadge changeStatus={data.changeStatus} />
      <Handle type="target" position={data.orientation === 'horizontal' ? Position.Left : Position.Top} className="!bg-red-400 !w-3 !h-3" />
      <div 
        className="bg-gradient-to-r from-red-600 to-red-700 rounded-t-lg p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-red-400/30 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-red-200 font-medium">ERROR HANDLER</div>
            <div className="text-sm font-semibold text-white truncate">{data.label}</div>
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-red-300" />
          ) : (
            <ChevronDown className="w-4 h-4 text-red-300" />
          )}
        </div>
      </div>
      {expanded && (
        <div className="bg-slate-800 border border-t-0 border-red-600/50 rounded-b-lg p-3 text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400">Catches:</span>
            <span className="text-slate-200">{data.faultType || 'All Errors'}</span>
          </div>
        </div>
      )}
      <Handle type="source" position={data.orientation === 'horizontal' ? Position.Right : Position.Bottom} className="!bg-red-400 !w-3 !h-3" />
    </div>
  );
}

function DetailedEndNode({ data }: NodeProps) {
  const isSelected = data.isSelected;
  const changeStyles = getChangeStatusStyles(data.changeStatus);
  const hasChange = data.changeStatus && data.changeStatus !== 'unchanged';
  
  return (
    <div
      className={`relative flex flex-col items-stretch min-w-40 transition-all rounded-lg ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900 scale-105' : hasChange ? changeStyles.ring : ''}`}
      data-testid={`flow-node-end-${data.id}`}
    >
      <ChangeStatusBadge changeStatus={data.changeStatus} />
      <Handle type="target" position={data.orientation === 'horizontal' ? Position.Left : Position.Top} className="!bg-emerald-400 !w-3 !h-3" />
      <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 rounded-lg p-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-400/30 flex items-center justify-center">
            <Reply className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-emerald-200 font-medium">END</div>
            <div className="text-sm font-semibold text-white truncate">{data.label}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  trigger: DetailedTriggerNode,
  action: DetailedActionNode,
  switch: DetailedSwitchNode,
  loop: DetailedLoopNode,
  scope: DetailedScopeNode,
  error: DetailedErrorNode,
  end: DetailedEndNode,
};

const NODE_WIDTH = 250;
const NODE_HEIGHT = 100;

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 120, ranksep: 150 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
      data: {
        ...node.data,
        orientation: direction === 'LR' ? 'horizontal' : 'vertical',
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

function convertToReactFlowNodes(flowNodes: FlowNode[], orientation: 'vertical' | 'horizontal', selectedNodeId?: string, nodeChanges?: NodeChanges): Node[] {
  return flowNodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    selected: node.id === selectedNodeId,
    data: {
      id: node.id,
      label: node.name,
      icon: node.icon,
      activityType: node.activityType,
      orientation,
      isSelected: node.id === selectedNodeId,
      changeStatus: nodeChanges?.[node.id] || 'unchanged',
      ...node.data,
    },
  }));
}

function convertToReactFlowEdges(connections: FlowConnection[]): Edge[] {
  return connections.map((conn) => ({
    id: conn.id,
    source: conn.source,
    target: conn.target,
    label: conn.label,
    type: 'smoothstep',
    animated: conn.type === 'error',
    style: {
      stroke: conn.type === 'error' ? '#ef4444' : 
              conn.type === 'conditional' ? '#f59e0b' : '#64748b',
      strokeWidth: 2,
    },
    labelStyle: {
      fill: '#94a3b8',
      fontSize: 10,
    },
    labelBgStyle: {
      fill: '#1e293b',
    },
  }));
}

interface SelectedNodeData {
  id: string;
  label: string;
  activityType: string;
  type: string;
  partnerLink?: string;
  adapterType?: string;
  adapterCode?: string;
  operation?: string;
  variable?: string;
  inputVariable?: string;
  endpoint?: string;
  role?: string;
  childCount?: number;
  hasErrorHandler?: boolean;
  branchCount?: number;
  refUri?: string;
}

export function FlowDiagram({ 
  flow, 
  className = '', 
  side,
  orientation: externalOrientation,
  onOrientationChange,
  showControls = true,
  nodeChanges,
}: FlowDiagramProps) {
  const [internalOrientation, setInternalOrientation] = useState<'vertical' | 'horizontal'>('vertical');
  const [selectedNode, setSelectedNode] = useState<SelectedNodeData | null>(null);
  const orientation = externalOrientation ?? internalOrientation;
  
  const { layoutedNodes, layoutedEdges } = useMemo(() => {
    if (!flow) return { layoutedNodes: [], layoutedEdges: [] };
    
    const initialNodes = convertToReactFlowNodes(flow.nodes, orientation, selectedNode?.id, nodeChanges);
    const initialEdges = convertToReactFlowEdges(flow.connections);
    
    const { nodes, edges } = getLayoutedElements(
      initialNodes,
      initialEdges,
      orientation === 'horizontal' ? 'LR' : 'TB'
    );
    
    return { layoutedNodes: nodes, layoutedEdges: edges };
  }, [flow, orientation, selectedNode?.id]);
  
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  const handleOrientationToggle = useCallback(() => {
    const newOrientation = orientation === 'vertical' ? 'horizontal' : 'vertical';
    if (onOrientationChange) {
      onOrientationChange(newOrientation);
    } else {
      setInternalOrientation(newOrientation);
    }
  }, [orientation, onOrientationChange]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode({
      id: node.id,
      label: node.data.label,
      activityType: node.data.activityType,
      type: node.type || 'action',
      partnerLink: node.data.partnerLink,
      adapterType: node.data.adapterType,
      adapterCode: node.data.adapterCode,
      operation: node.data.operation,
      variable: node.data.variable,
      inputVariable: node.data.inputVariable,
      endpoint: node.data.endpoint,
      role: node.data.role,
      childCount: node.data.childCount,
      hasErrorHandler: node.data.hasErrorHandler,
      branchCount: node.data.branchCount,
      refUri: node.data.refUri,
    });
  }, []);

  const onInit = useCallback((reactFlowInstance: any) => {
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.2 });
    }, 100);
  }, []);

  if (!flow || flow.nodes.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center h-full bg-slate-900/50 rounded-lg ${className}`}>
        <GitBranch className="w-12 h-12 text-slate-600 mb-4" />
        <p className="text-slate-400 text-sm font-medium">Flow visualization not available</p>
        <p className="text-slate-500 text-xs mt-2 text-center max-w-xs">
          Flow data not found. Please re-upload the IAR file to enable flow visualization.
        </p>
      </div>
    );
  }

  return (
    <div className={`h-full bg-slate-900/50 rounded-lg overflow-hidden relative ${className}`} data-testid={`flow-diagram-${side || 'main'}`}>
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
        <div className="bg-slate-800/90 px-3 py-1.5 rounded-md border border-slate-700">
          <span className="text-xs font-medium text-slate-300">{flow.metadata.processName}</span>
        </div>
        <div className="bg-slate-800/90 px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-400">
          {flow.nodes.length} nodes
        </div>
      </div>
      
      {showControls && (
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={handleOrientationToggle}
            className="bg-slate-800/90 p-2 rounded-md border border-slate-700 hover:bg-slate-700 transition-colors"
            title={`Switch to ${orientation === 'vertical' ? 'horizontal' : 'vertical'} layout`}
            data-testid="toggle-orientation"
          >
            {orientation === 'vertical' ? (
              <ArrowRight className="w-4 h-4 text-slate-300" />
            ) : (
              <ArrowDown className="w-4 h-4 text-slate-300" />
            )}
          </button>
        </div>
      )}
      
      <ReactFlow
        key={`flow-${side}-${orientation}`}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelectedNode(null)}
        onInit={onInit}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3, minZoom: 0.5, maxZoom: 1.5 }}
        minZoom={0.3}
        maxZoom={3}
        nodesDraggable={true}
        nodesConnectable={false}
        panOnDrag={true}
        panOnScroll={true}
        zoomOnScroll={true}
        zoomOnDoubleClick={false}
        attributionPosition="bottom-right"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#334155" gap={20} />
        <Controls 
          className="!bg-slate-800 !border-slate-700 !shadow-lg"
          showInteractive={false}
          showFitView={true}
        />
        <MiniMap
          className="!bg-slate-800 !border-slate-700"
          nodeColor={(node) => {
            switch (node.type) {
              case 'trigger': return '#14b8a6';
              case 'action': return '#475569';
              case 'switch': return '#f59e0b';
              case 'loop': return '#8b5cf6';
              case 'scope': return '#6366f1';
              case 'error': return '#ef4444';
              case 'end': return '#10b981';
              default: return '#64748b';
            }
          }}
          maskColor="rgba(15, 23, 42, 0.8)"
        />
        <Panel position="bottom-left" className="!m-2">
          <div className="bg-slate-800/90 p-2 rounded-md border border-slate-700 text-xs text-slate-400 flex items-center gap-2">
            <Info className="w-3 h-3" />
            <span>Drag to pan • Scroll to zoom • Click nodes for details</span>
          </div>
        </Panel>
      </ReactFlow>
      
      {selectedNode && (
        <div className="absolute top-2 right-2 z-20 w-80 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                selectedNode.type === 'trigger' ? 'bg-teal-500' :
                selectedNode.type === 'error' ? 'bg-red-500' :
                selectedNode.type === 'switch' ? 'bg-amber-500' :
                selectedNode.type === 'loop' ? 'bg-violet-500' :
                selectedNode.type === 'scope' ? 'bg-indigo-500' :
                selectedNode.type === 'end' ? 'bg-emerald-500' :
                'bg-slate-500'
              }`} />
              <span className="text-sm font-semibold text-white truncate max-w-48">
                {selectedNode.label}
              </span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="p-1 hover:bg-slate-700 rounded transition-colors"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
          
          <div className="p-3 space-y-3 max-h-80 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-slate-400">Activity Type</div>
              <div className="text-slate-200 font-medium">{selectedNode.activityType}</div>
              
              <div className="text-slate-400">Node Type</div>
              <div className="text-slate-200 font-medium capitalize">{selectedNode.type}</div>
              
              {selectedNode.role && (
                <>
                  <div className="text-slate-400">Role</div>
                  <div className="text-slate-200 font-medium capitalize">{selectedNode.role}</div>
                </>
              )}
              
              {selectedNode.partnerLink && (
                <>
                  <div className="text-slate-400">Connection</div>
                  <div className="text-slate-200 font-medium truncate" title={selectedNode.partnerLink}>
                    {selectedNode.partnerLink}
                  </div>
                </>
              )}
              
              {selectedNode.adapterType && (
                <>
                  <div className="text-slate-400">Adapter Type</div>
                  <div className="text-slate-200 font-medium">{selectedNode.adapterType}</div>
                </>
              )}
              
              {selectedNode.adapterCode && (
                <>
                  <div className="text-slate-400">Adapter Code</div>
                  <div className="text-slate-200 font-medium truncate" title={selectedNode.adapterCode}>
                    {selectedNode.adapterCode}
                  </div>
                </>
              )}
              
              {selectedNode.operation && (
                <>
                  <div className="text-slate-400">Operation</div>
                  <div className="text-slate-200 font-medium">{selectedNode.operation}</div>
                </>
              )}
              
              {selectedNode.variable && (
                <>
                  <div className="text-slate-400">Output Variable</div>
                  <div className="text-slate-200 font-medium truncate" title={selectedNode.variable}>
                    {selectedNode.variable}
                  </div>
                </>
              )}
              
              {selectedNode.inputVariable && (
                <>
                  <div className="text-slate-400">Input Variable</div>
                  <div className="text-slate-200 font-medium truncate" title={selectedNode.inputVariable}>
                    {selectedNode.inputVariable}
                  </div>
                </>
              )}
              
              {selectedNode.endpoint && (
                <>
                  <div className="text-slate-400">Endpoint</div>
                  <div className="text-slate-200 font-medium truncate" title={selectedNode.endpoint}>
                    {selectedNode.endpoint}
                  </div>
                </>
              )}
              
              {selectedNode.childCount !== undefined && (
                <>
                  <div className="text-slate-400">Child Activities</div>
                  <div className="text-slate-200 font-medium">{selectedNode.childCount}</div>
                </>
              )}
              
              {selectedNode.branchCount !== undefined && (
                <>
                  <div className="text-slate-400">Branches</div>
                  <div className="text-slate-200 font-medium">{selectedNode.branchCount}</div>
                </>
              )}
              
              {selectedNode.hasErrorHandler && (
                <>
                  <div className="text-slate-400">Error Handler</div>
                  <div className="text-amber-400 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Yes
                  </div>
                </>
              )}
            </div>
            
            {selectedNode.refUri && (
              <div className="pt-2 border-t border-slate-700">
                <div className="text-xs text-slate-400 mb-1">Reference URI</div>
                <div className="text-xs text-slate-500 font-mono bg-slate-800 p-2 rounded break-all">
                  {selectedNode.refUri}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface FlowComparisonProps {
  leftFlow: ParsedFlow | null;
  rightFlow: ParsedFlow | null;
  className?: string;
}

export function FlowComparison({ leftFlow, rightFlow, className = '' }: FlowComparisonProps) {
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('vertical');
  const [fullscreen, setFullscreen] = useState<'left' | 'right' | null>(null);
  
  const { leftChanges, rightChanges } = useMemo(() => {
    return compareFlows(leftFlow, rightFlow);
  }, [leftFlow, rightFlow]);
  
  const changeStats = useMemo(() => {
    const added = Object.values(rightChanges).filter(s => s === 'added').length;
    const removed = Object.values(leftChanges).filter(s => s === 'removed').length;
    const modified = Object.values(leftChanges).filter(s => s === 'modified').length;
    return { added, removed, modified };
  }, [leftChanges, rightChanges]);
  
  const renderFlowContent = () => (
    <>
      <div className="flex items-center justify-between p-2 bg-slate-800/50 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">Layout:</span>
          <div className="flex rounded-md overflow-hidden border border-slate-600">
            <button
              onClick={() => setOrientation('vertical')}
              className={`px-3 py-1 text-xs font-medium flex items-center gap-1 ${
                orientation === 'vertical' 
                  ? 'bg-slate-600 text-white' 
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
              data-testid="layout-vertical"
            >
              <ArrowDown className="w-3 h-3" />
              Vertical
            </button>
            <button
              onClick={() => setOrientation('horizontal')}
              className={`px-3 py-1 text-xs font-medium flex items-center gap-1 ${
                orientation === 'horizontal' 
                  ? 'bg-slate-600 text-white' 
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
              data-testid="layout-horizontal"
            >
              <ArrowRight className="w-3 h-3" />
              Horizontal
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(changeStats.added > 0 || changeStats.removed > 0 || changeStats.modified > 0) && (
            <div className="flex items-center gap-2 text-xs">
              {changeStats.added > 0 && (
                <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  {changeStats.added} new
                </span>
              )}
              {changeStats.removed > 0 && (
                <span className="flex items-center gap-1 bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-rose-400" />
                  {changeStats.removed} removed
                </span>
              )}
              {changeStats.modified > 0 && (
                <span className="flex items-center gap-1 bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {changeStats.modified} modified
                </span>
              )}
            </div>
          )}
          <div className="text-xs text-slate-500">
            Use scroll to zoom • Click nodes for details
          </div>
        </div>
      </div>
      
      <div className="flex-1 flex gap-4 p-4">
        <div className="flex-1 relative">
          <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
            <span className="bg-red-500/20 text-red-300 px-2 py-1 rounded text-xs font-medium border border-red-500/30">
              Previous
            </span>
            <button
              onClick={() => setFullscreen('left')}
              className="bg-slate-800/90 p-1.5 rounded-md border border-slate-700 hover:bg-slate-700 transition-colors"
              title="View fullscreen"
              data-testid="fullscreen-left"
            >
              <Maximize2 className="w-3 h-3 text-slate-400" />
            </button>
          </div>
          <FlowDiagram 
            flow={leftFlow} 
            side="left" 
            className="h-full" 
            orientation={orientation}
            showControls={false}
            nodeChanges={leftChanges}
          />
        </div>
        <div className="w-px bg-slate-700" />
        <div className="flex-1 relative">
          <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
            <span className="bg-green-500/20 text-green-300 px-2 py-1 rounded text-xs font-medium border border-green-500/30">
              Current
            </span>
            <button
              onClick={() => setFullscreen('right')}
              className="bg-slate-800/90 p-1.5 rounded-md border border-slate-700 hover:bg-slate-700 transition-colors"
              title="View fullscreen"
              data-testid="fullscreen-right"
            >
              <Maximize2 className="w-3 h-3 text-slate-400" />
            </button>
          </div>
          <FlowDiagram 
            flow={rightFlow} 
            side="right" 
            className="h-full" 
            orientation={orientation}
            showControls={false}
            nodeChanges={rightChanges}
          />
        </div>
      </div>
    </>
  );

  return (
    <div className={`flex flex-col h-full ${className}`} data-testid="flow-comparison">
      {renderFlowContent()}
      
      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-700">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-white">
                {fullscreen === 'left' ? 'Previous Version' : 'Current Version'} Flow
              </h2>
              <div className="flex rounded-md overflow-hidden border border-slate-600">
                <button
                  onClick={() => setOrientation('vertical')}
                  className={`px-3 py-1 text-xs font-medium flex items-center gap-1 ${
                    orientation === 'vertical' 
                      ? 'bg-slate-600 text-white' 
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                  }`}
                >
                  <ArrowDown className="w-3 h-3" />
                  Vertical
                </button>
                <button
                  onClick={() => setOrientation('horizontal')}
                  className={`px-3 py-1 text-xs font-medium flex items-center gap-1 ${
                    orientation === 'horizontal' 
                      ? 'bg-slate-600 text-white' 
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                  }`}
                >
                  <ArrowRight className="w-3 h-3" />
                  Horizontal
                </button>
              </div>
            </div>
            <button
              onClick={() => setFullscreen(null)}
              className="p-2 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors"
              title="Close fullscreen"
              data-testid="close-fullscreen"
            >
              <X className="w-5 h-5 text-slate-300" />
            </button>
          </div>
          <div className="flex-1 p-4">
            <FlowDiagram 
              flow={fullscreen === 'left' ? leftFlow : rightFlow} 
              side={fullscreen} 
              className="h-full" 
              orientation={orientation}
              showControls={false}
              nodeChanges={fullscreen === 'left' ? leftChanges : rightChanges}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowDiagram;
