import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft,
  Download,
  Loader2,
  FileText,
  FolderOpen,
  ChevronRight,
  Search,
  X,
  Menu,
  Minus,
  Plus,
  Equal,
  Columns,
  AlignJustify,
  GitBranch,
  Code
} from "lucide-react";
import { FlowComparison } from "@/components/FlowDiagram";
import { cn } from "@/lib/utils";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { motion, AnimatePresence } from "framer-motion";

interface DiffItem {
  id: number;
  entityType: string;
  entityName: string;
  changeType: string;
  severity: string;
  leftRef?: string;
  rightRef?: string;
  diffPatch?: string;
  riskReason?: string;
  metadata?: {
    actionType?: string;
    oicObjectName?: string;
    changeDescription?: string;
    category?: string;
  };
}

interface DiffRun {
  id: number;
  status: string;
  leftArchive?: { name: string };
  rightArchive?: { name: string };
}

interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'unchanged' | 'added' | 'removed' | 'empty';
}

function getShortPath(path: string): string {
  if (!path) return 'Unknown';
  const parts = path.split('/');
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : path;
}

function formatXml(xml: string): string {
  if (!xml || !xml.trim().startsWith('<')) return xml;
  
  try {
    let formatted = '';
    let indent = 0;
    const lines = xml.replace(/>\s*</g, '>\n<').split('\n');
    
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      if (line.startsWith('</')) {
        indent = Math.max(0, indent - 1);
      }
      
      formatted += '  '.repeat(indent) + line + '\n';
      
      if (line.startsWith('<') && !line.startsWith('</') && !line.startsWith('<?') && 
          !line.endsWith('/>') && !line.includes('</')) {
        indent++;
      }
    }
    
    return formatted.trim();
  } catch {
    return xml;
  }
}

function formatJson(json: string): string {
  if (!json || !json.trim().startsWith('{') && !json.trim().startsWith('[')) return json;
  
  try {
    const parsed = JSON.parse(json);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return json;
  }
}

function formatContent(content: string, path: string): string {
  if (!content) return content;
  
  const ext = path?.split('.').pop()?.toLowerCase() || '';
  
  if (ext === 'xml' || ext === 'xsl' || ext === 'xslt' || ext === 'wsdl' || content.trim().startsWith('<')) {
    return formatXml(content);
  }
  
  if (ext === 'json' || content.trim().startsWith('{') || content.trim().startsWith('[')) {
    return formatJson(content);
  }
  
  return content;
}

function getChangeColor(changeType: string): string {
  switch (changeType?.toLowerCase()) {
    case 'added': return 'text-emerald-600 bg-emerald-500/20';
    case 'removed': return 'text-rose-600 bg-rose-500/20';
    case 'modified': return 'text-amber-600 bg-amber-500/20';
    default: return 'text-slate-600 bg-slate-500/20';
  }
}

function getSeverityColor(severity: string): string {
  switch (severity?.toLowerCase()) {
    case 'high': return 'text-rose-400 bg-rose-500/20';
    case 'medium': return 'text-amber-400 bg-amber-500/20';
    case 'low': return 'text-sky-400 bg-sky-500/20';
    default: return 'text-slate-400 bg-slate-500/20';
  }
}

function computeDiffOperations(left: string[], right: string[]): Array<{ type: 'unchanged' | 'removed' | 'added'; leftIdx: number; rightIdx: number }> {
  const m = left.length;
  const n = right.length;
  
  if (m === 0 && n === 0) return [];
  if (m === 0) {
    return right.map((_, idx) => ({ type: 'added' as const, leftIdx: -1, rightIdx: idx }));
  }
  if (n === 0) {
    return left.map((_, idx) => ({ type: 'removed' as const, leftIdx: idx, rightIdx: -1 }));
  }
  
  // Build DP table for LCS - O(mn)
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (left[i - 1] === right[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  // Backtrack from (m, n) to (0, 0) to build operations - O(m + n)
  const ops: Array<{ type: 'unchanged' | 'removed' | 'added'; leftIdx: number; rightIdx: number }> = [];
  let i = m;
  let j = n;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) {
      ops.push({ type: 'unchanged', leftIdx: i - 1, rightIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'added', leftIdx: -1, rightIdx: j - 1 });
      j--;
    } else {
      ops.push({ type: 'removed', leftIdx: i - 1, rightIdx: -1 });
      i--;
    }
  }
  
  // Reverse to get forward order
  return ops.reverse();
}

function computeLineDiff(leftContent: string, rightContent: string): { leftLines: DiffLine[], rightLines: DiffLine[] } {
  const leftRaw = leftContent?.split('\n') || [];
  const rightRaw = rightContent?.split('\n') || [];
  
  const leftLines: DiffLine[] = [];
  const rightLines: DiffLine[] = [];
  
  const operations = computeDiffOperations(leftRaw, rightRaw);
  
  let leftNum = 1;
  let rightNum = 1;
  
  for (const op of operations) {
    if (op.type === 'unchanged') {
      leftLines.push({ lineNumber: leftNum++, content: leftRaw[op.leftIdx], type: 'unchanged' });
      rightLines.push({ lineNumber: rightNum++, content: rightRaw[op.rightIdx], type: 'unchanged' });
    } else if (op.type === 'removed') {
      leftLines.push({ lineNumber: leftNum++, content: leftRaw[op.leftIdx], type: 'removed' });
      rightLines.push({ lineNumber: 0, content: '', type: 'empty' });
    } else {
      leftLines.push({ lineNumber: 0, content: '', type: 'empty' });
      rightLines.push({ lineNumber: rightNum++, content: rightRaw[op.rightIdx], type: 'added' });
    }
  }
  
  return { leftLines, rightLines };
}

interface UnifiedDiffLine {
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  content: string;
  type: 'unchanged' | 'added' | 'removed';
}

function computeUnifiedDiff(leftContent: string, rightContent: string): UnifiedDiffLine[] {
  const leftRaw = leftContent?.split('\n') || [];
  const rightRaw = rightContent?.split('\n') || [];
  
  const lines: UnifiedDiffLine[] = [];
  const operations = computeDiffOperations(leftRaw, rightRaw);
  
  let leftNum = 1;
  let rightNum = 1;
  
  for (const op of operations) {
    if (op.type === 'unchanged') {
      lines.push({ leftLineNumber: leftNum++, rightLineNumber: rightNum++, content: leftRaw[op.leftIdx], type: 'unchanged' });
    } else if (op.type === 'removed') {
      lines.push({ leftLineNumber: leftNum++, rightLineNumber: null, content: leftRaw[op.leftIdx], type: 'removed' });
    } else {
      lines.push({ leftLineNumber: null, rightLineNumber: rightNum++, content: rightRaw[op.rightIdx], type: 'added' });
    }
  }
  
  return lines;
}

function UnifiedDiffRow({ line }: { line: UnifiedDiffLine }) {
  const getBgColor = () => {
    switch (line.type) {
      case 'added': return 'bg-emerald-500/15';
      case 'removed': return 'bg-rose-500/15';
      default: return '';
    }
  };
  
  const getGutterColor = () => {
    switch (line.type) {
      case 'added': return 'bg-emerald-500/30 text-emerald-400';
      case 'removed': return 'bg-rose-500/30 text-rose-400';
      default: return 'bg-slate-800/50 text-slate-500';
    }
  };
  
  const getIcon = () => {
    switch (line.type) {
      case 'added': return <Plus className="w-3 h-3" />;
      case 'removed': return <Minus className="w-3 h-3" />;
      default: return null;
    }
  };

  return (
    <div className={cn("flex min-h-[24px] font-mono text-sm", getBgColor())}>
      <div className={cn("w-10 flex-shrink-0 px-1 text-right select-none text-xs", getGutterColor())}>
        {line.leftLineNumber || ''}
      </div>
      <div className={cn("w-10 flex-shrink-0 px-1 text-right select-none text-xs border-r border-slate-700/50", getGutterColor())}>
        {line.rightLineNumber || ''}
      </div>
      <div className={cn("w-6 flex-shrink-0 flex items-center justify-center select-none", getGutterColor())}>
        {getIcon()}
      </div>
      <div className="flex-1 px-3 py-0.5">
        <pre className="whitespace-pre text-slate-300">{line.content}</pre>
      </div>
    </div>
  );
}

function DiffLineRow({ line, side }: { line: DiffLine; side: 'left' | 'right' }) {
  const getBgColor = () => {
    switch (line.type) {
      case 'added': return 'bg-emerald-500/15';
      case 'removed': return 'bg-rose-500/15';
      case 'empty': return 'bg-slate-800/50';
      default: return '';
    }
  };
  
  const getGutterColor = () => {
    switch (line.type) {
      case 'added': return 'bg-emerald-500/30 text-emerald-400';
      case 'removed': return 'bg-rose-500/30 text-rose-400';
      case 'empty': return 'bg-slate-800 text-slate-600';
      default: return 'bg-slate-800/50 text-slate-500';
    }
  };
  
  const getIcon = () => {
    switch (line.type) {
      case 'added': return <Plus className="w-3 h-3" />;
      case 'removed': return <Minus className="w-3 h-3" />;
      default: return null;
    }
  };

  return (
    <div className={cn("flex min-h-[24px] font-mono text-sm", getBgColor())}>
      <div className={cn("w-12 flex-shrink-0 px-2 text-right select-none flex items-center justify-end gap-1", getGutterColor())}>
        {getIcon()}
        <span className="text-xs">{line.lineNumber || ''}</span>
      </div>
      <div className="flex-1 px-3 py-0.5">
        <pre className="whitespace-pre text-slate-300">{line.content}</pre>
      </div>
    </div>
  );
}

export default function DiffViewer() {
  const [match, params] = useRoute("/diff/:id");
  const diffId = params?.id;
  
  const [loading, setLoading] = useState(true);
  const [diffRun, setDiffRun] = useState<DiffRun | null>(null);
  const [diffItems, setDiffItems] = useState<DiffItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<DiffItem | null>(null);
  const [leftContent, setLeftContent] = useState<string>('');
  const [rightContent, setRightContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<string[]>([]);
  const [filterChange, setFilterChange] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [mainView, setMainView] = useState<'changes' | 'flow'>('changes');
  const [flowData, setFlowData] = useState<{ left: any; right: any } | null>(null);
  const [loadingFlow, setLoadingFlow] = useState(false);
  
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);

  const syncScroll = useCallback((source: 'left' | 'right') => {
    if (isScrolling.current) return;
    isScrolling.current = true;
    
    const sourceRef = source === 'left' ? leftScrollRef : rightScrollRef;
    const targetRef = source === 'left' ? rightScrollRef : leftScrollRef;
    
    if (sourceRef.current && targetRef.current) {
      targetRef.current.scrollTop = sourceRef.current.scrollTop;
    }
    
    setTimeout(() => { isScrolling.current = false; }, 50);
  }, []);

  useEffect(() => {
    if (diffId) {
      fetchDiffData();
    }
  }, [diffId]);

  // Poll for diff completion when status is processing
  useEffect(() => {
    const status = (diffRun as any)?.diffRun?.status || diffRun?.status;
    if (!diffRun || status !== 'processing') return;
    
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/diff-runs/${diffId}`);
        const data = await res.json();
        if (data.diffRun?.status === 'completed' || data.diffRun?.status === 'failed') {
          clearInterval(pollInterval);
          // Update diffRun state immediately with the polled data
          setDiffRun(data);
          // Then fetch items separately
          const itemsRes = await fetch(`/api/diff-runs/${diffId}/items`);
          const itemsData = await itemsRes.json();
          const items = itemsData.items || [];
          setDiffItems(items);
          
          // Select first item and load its content
          if (items.length > 0) {
            const firstItem = items[0];
            setSelectedItem(firstItem);
            setLoadingContent(true);
            const filePath = firstItem.leftRef || firstItem.rightRef || '';
            try {
              const contentRes = await fetch(`/api/diff-items/${firstItem.id}/content`);
              if (contentRes.ok) {
                const contentData = await contentRes.json();
                setLeftContent(formatContent(contentData.leftContent || '', filePath));
                setRightContent(formatContent(contentData.rightContent || '', filePath));
              } else {
                setLeftContent(formatContent(firstItem.diffPatch || '', filePath));
                setRightContent('');
              }
            } catch {
              setLeftContent(formatContent(firstItem.diffPatch || '', filePath));
              setRightContent('');
            } finally {
              setLoadingContent(false);
            }
          }
          setLoading(false);
        }
      } catch (e) {
        console.error('Polling error:', e);
      }
    }, 1000); // Check every second
    
    return () => clearInterval(pollInterval);
  }, [diffRun, diffId]);
  
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchDiffData = async () => {
    try {
      const [runRes, itemsRes] = await Promise.all([
        fetch(`/api/diff-runs/${diffId}`),
        fetch(`/api/diff-runs/${diffId}/items`),
      ]);

      const runData = await runRes.json();
      const itemsData = await itemsRes.json();

      setDiffRun(runData);
      setDiffItems(itemsData.items || []);
      
      if (itemsData.items?.length > 0) {
        selectItem(itemsData.items[0]);
      }
    } catch (error) {
      console.error('Failed to fetch diff data:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectItem = async (item: DiffItem) => {
    setSelectedItem(item);
    setLoadingContent(true);
    
    const filePath = item.leftRef || item.rightRef || '';
    
    try {
      const res = await fetch(`/api/diff-items/${item.id}/content`);
      if (res.ok) {
        const data = await res.json();
        setLeftContent(formatContent(data.leftContent || '', filePath));
        setRightContent(formatContent(data.rightContent || '', filePath));
      } else {
        setLeftContent(formatContent(item.diffPatch || '', filePath));
        setRightContent('');
      }
    } catch (error) {
      setLeftContent(formatContent(item.diffPatch || '', filePath));
      setRightContent('');
    } finally {
      setLoadingContent(false);
    }
  };

  const fetchFlowData = async () => {
    if (flowData || loadingFlow) return;
    setLoadingFlow(true);
    try {
      const res = await fetch(`/api/diff-runs/${diffId}/flow`);
      if (res.ok) {
        const data = await res.json();
        setFlowData(data);
      }
    } catch (error) {
      console.error('Failed to fetch flow data:', error);
    } finally {
      setLoadingFlow(false);
    }
  };

  useEffect(() => {
    if (mainView === 'flow' && diffId && !flowData && !loadingFlow) {
      fetchFlowData();
    }
  }, [mainView, diffId]);

  const { leftLines, rightLines } = useMemo(() => {
    return computeLineDiff(leftContent, rightContent);
  }, [leftContent, rightContent]);

  const unifiedLines = useMemo(() => {
    return computeUnifiedDiff(leftContent, rightContent);
  }, [leftContent, rightContent]);

  const diffStats = useMemo(() => {
    const added = rightLines.filter(l => l.type === 'added').length;
    const removed = leftLines.filter(l => l.type === 'removed').length;
    const unchanged = leftLines.filter(l => l.type === 'unchanged').length;
    return { added, removed, unchanged };
  }, [leftLines, rightLines]);

  const filteredItems = useMemo(() => {
    return diffItems.filter(item => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch = 
          item.entityName?.toLowerCase().includes(q) ||
          item.entityType?.toLowerCase().includes(q) ||
          item.leftRef?.toLowerCase().includes(q) ||
          item.rightRef?.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      
      if (filterSeverity.length > 0 && !filterSeverity.includes(item.severity)) {
        return false;
      }
      
      if (filterChange.length > 0 && !filterChange.includes(item.changeType)) {
        return false;
      }
      
      return true;
    });
  }, [diffItems, searchQuery, filterSeverity, filterChange]);

  const stats = useMemo(() => {
    const added = diffItems.filter(i => i.changeType === 'Added').length;
    const removed = diffItems.filter(i => i.changeType === 'Removed').length;
    const modified = diffItems.filter(i => i.changeType === 'Modified').length;
    return { added, removed, modified, total: diffItems.length };
  }, [diffItems]);

  const toggleFilter = (type: 'severity' | 'change', value: string) => {
    if (type === 'severity') {
      setFilterSeverity(prev => 
        prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
      );
    } else {
      setFilterChange(prev => 
        prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
      );
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterSeverity([]);
    setFilterChange([]);
  };

  const hasFilters = searchQuery || filterSeverity.length > 0 || filterChange.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-400" />
          <p className="text-slate-500 text-sm">Loading comparison...</p>
        </div>
      </div>
    );
  }

  if (!diffRun) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center space-y-4">
          <p className="text-slate-400">Comparison not found</p>
          <Button variant="outline" size="sm" asChild>
            <a href="/dashboard">Go Back</a>
          </Button>
        </div>
      </div>
    );
  }

  // Show processing state while diff is being computed
  const currentStatus = (diffRun as any)?.diffRun?.status || diffRun?.status;
  if (currentStatus === 'processing') {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin mx-auto text-blue-400" />
          <p className="text-slate-300 text-lg font-medium">Analyzing differences...</p>
          <p className="text-slate-500 text-sm">This may take a few seconds</p>
        </div>
      </div>
    );
  }

  const leftName = diffRun.leftArchive?.name || 'Version 1';
  const rightName = diffRun.rightArchive?.name || 'Version 2';

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100">
      <header className="flex-shrink-0 h-14 border-b border-slate-700/80 flex items-center px-4 gap-4 bg-gradient-to-r from-slate-800 to-slate-800/95 backdrop-blur-sm">
        <Button 
          variant="ghost" 
          size="icon" 
          className="md:hidden h-9 w-9 text-slate-400 hover:text-white hover:bg-slate-700"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          data-testid="button-toggle-sidebar"
        >
          <Menu className="w-5 h-5" />
        </Button>
        
        <Button variant="ghost" size="icon" asChild className="h-9 w-9 text-slate-400 hover:text-white hover:bg-slate-700">
          <a href="/dashboard" data-testid="button-back"><ArrowLeft className="w-5 h-5" /></a>
        </Button>
        
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="hidden sm:flex items-center gap-2 text-sm min-w-0 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
            <span className="text-rose-400 font-medium truncate max-w-[180px]" title={leftName} data-testid="text-old-version">
              {leftName}
            </span>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0 hidden sm:block" />
          <div className="hidden sm:flex items-center gap-2 text-sm min-w-0 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <span className="text-emerald-400 font-medium truncate max-w-[180px]" title={rightName} data-testid="text-new-version">
              {rightName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center border border-slate-600 rounded-lg overflow-hidden">
            <button
              onClick={() => setMainView('changes')}
              className={cn(
                "px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium transition-colors",
                mainView === 'changes' 
                  ? "bg-blue-500/20 text-blue-400" 
                  : "text-slate-400 hover:text-slate-300 hover:bg-slate-700/50"
              )}
              data-testid="button-view-changes"
            >
              <Code className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Changes</span>
            </button>
            <button
              onClick={() => setMainView('flow')}
              className={cn(
                "px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium transition-colors border-l border-slate-600",
                mainView === 'flow' 
                  ? "bg-blue-500/20 text-blue-400" 
                  : "text-slate-400 hover:text-slate-300 hover:bg-slate-700/50"
              )}
              data-testid="button-view-flow"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Flow</span>
            </button>
          </div>

          <div className="flex items-center gap-1 text-xs">
            {stats.removed > 0 && (
              <span className="px-2 py-1 rounded-md bg-rose-500/20 text-rose-300 font-medium">-{stats.removed}</span>
            )}
            {stats.added > 0 && (
              <span className="px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-300 font-medium">+{stats.added}</span>
            )}
            {stats.modified > 0 && (
              <span className="px-2 py-1 rounded-md bg-amber-500/20 text-amber-300 font-medium">~{stats.modified}</span>
            )}
          </div>

          <Button 
            variant="outline" 
            size="sm"
            className="h-9 text-slate-300 border-slate-600 hover:bg-slate-700 gap-2"
            data-testid="button-export-report"
            onClick={() => window.open(`/api/diff-runs/${diffId}/export`, '_blank')}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className={cn(
          "flex-shrink-0 border-r border-slate-700 flex flex-col bg-slate-850 transition-all duration-300",
          sidebarOpen ? "w-80" : "w-0 overflow-hidden",
          "md:w-80"
        )}>
          <div className="p-3 border-b border-slate-700 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-10 pr-3 text-sm bg-slate-800 border border-slate-600 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                data-testid="input-search"
              />
            </div>
            
            <div className="flex flex-wrap gap-1.5">
              {['Added', 'Removed', 'Modified'].map(type => (
                <button
                  key={type}
                  onClick={() => toggleFilter('change', type)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                    filterChange.includes(type) 
                      ? getChangeColor(type) + " ring-1 ring-current"
                      : "bg-slate-700/50 text-slate-400 hover:bg-slate-600"
                  )}
                  data-testid={`filter-${type.toLowerCase()}`}
                >
                  {type}
                </button>
              ))}
              <div className="w-px h-6 bg-slate-700 mx-1" />
              {['High', 'Medium', 'Low'].map(sev => (
                <button
                  key={sev}
                  onClick={() => toggleFilter('severity', sev)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                    filterSeverity.includes(sev)
                      ? getSeverityColor(sev) + " ring-1 ring-current"
                      : "bg-slate-700/50 text-slate-400 hover:bg-slate-600"
                  )}
                  data-testid={`filter-severity-${sev.toLowerCase()}`}
                >
                  {sev}
                </button>
              ))}
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="px-2 py-1 text-xs rounded-md bg-slate-600 text-slate-300 hover:bg-slate-500 flex items-center gap-1"
                  data-testid="button-clear-filters"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            {hasFilters && (
              <p className="text-xs text-slate-500">
                Showing {filteredItems.length} of {diffItems.length} changes
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredItems.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-6 text-center text-slate-500 text-sm"
              >
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                {diffItems.length === 0 ? 'No changes detected' : 'No matches found'}
              </motion.div>
            ) : (
              <div className="py-1">
                {filteredItems.map((item, index) => (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
                    onClick={() => selectItem(item)}
                    whileHover={{ x: 2 }}
                    className={cn(
                      "w-full px-3 py-3 text-left transition-all border-l-2",
                      selectedItem?.id === item.id 
                        ? "bg-gradient-to-r from-slate-700/80 to-slate-800/50 border-l-blue-500 shadow-[inset_0_0_20px_rgba(59,130,246,0.1)]" 
                        : "hover:bg-slate-800/50 border-l-transparent"
                    )}
                    data-testid={`diff-item-${item.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                        getChangeColor(item.changeType)
                      )}>
                        {item.changeType === 'Added' && <Plus className="w-4 h-4" />}
                        {item.changeType === 'Removed' && <Minus className="w-4 h-4" />}
                        {item.changeType === 'Modified' && <Equal className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-slate-200 truncate">
                          {item.entityName}
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {item.metadata?.actionType ? (
                            <span className="text-cyan-400">{item.metadata.actionType}</span>
                          ) : (
                            item.entityType
                          )} • {getShortPath(item.leftRef || item.rightRef || '')}
                        </p>
                        {item.metadata?.changeDescription && (
                          <p className="text-[11px] text-slate-400/80 mt-1 line-clamp-2 leading-relaxed">
                            {item.metadata.changeDescription}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {item.metadata?.actionType && (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-cyan-500/20 text-cyan-400">
                              {item.metadata.actionType}
                            </span>
                          )}
                          {item.severity && item.severity !== 'Info' && (
                            <span className={cn(
                              "inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full",
                              getSeverityColor(item.severity)
                            )}>
                              {item.severity} risk
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0 bg-slate-900">
          {mainView === 'flow' ? (
            <div className="flex-1 p-4" data-testid="flow-view-container">
              {loadingFlow ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
                </div>
              ) : (
                <FlowComparison 
                  leftFlow={flowData?.left} 
                  rightFlow={flowData?.right} 
                  className="h-full"
                />
              )}
            </div>
          ) : (
          <AnimatePresence mode="wait">
          {selectedItem ? (
            <motion.div
              key={selectedItem.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex flex-col"
            >
              <div className="flex-shrink-0 h-12 px-4 border-b border-slate-700/80 flex items-center gap-3 bg-gradient-to-r from-slate-800/80 to-slate-850/60">
                <FolderOpen className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <span className="text-sm font-mono text-slate-300 truncate flex-1" title={selectedItem.leftRef || selectedItem.rightRef}>
                  {selectedItem.leftRef || selectedItem.rightRef}
                </span>
                <div className="flex items-center gap-3 text-xs flex-shrink-0">
                  {diffStats.removed > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 font-mono">-{diffStats.removed}</span>
                  )}
                  {diffStats.added > 0 && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono">+{diffStats.added}</span>
                  )}
                  <span className="text-slate-500 font-mono">{diffStats.unchanged} unchanged</span>
                </div>
                <div className="flex items-center border border-slate-600 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setViewMode('split')}
                    className={cn(
                      "px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-medium transition-colors",
                      viewMode === 'split' 
                        ? "bg-blue-500/20 text-blue-400" 
                        : "text-slate-400 hover:text-slate-300 hover:bg-slate-700/50"
                    )}
                    data-testid="button-view-split"
                    title="Side-by-side view"
                  >
                    <Columns className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Split</span>
                  </button>
                  <button
                    onClick={() => setViewMode('unified')}
                    className={cn(
                      "px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-medium transition-colors border-l border-slate-600",
                      viewMode === 'unified' 
                        ? "bg-blue-500/20 text-blue-400" 
                        : "text-slate-400 hover:text-slate-300 hover:bg-slate-700/50"
                    )}
                    data-testid="button-view-unified"
                    title="Unified view"
                  >
                    <AlignJustify className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Unified</span>
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-hidden">
                {loadingContent ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
                  </div>
                ) : viewMode === 'unified' ? (
                  <div className="h-full flex flex-col">
                    <div className="flex-shrink-0 px-4 py-2 bg-slate-800/60 text-slate-300 text-xs font-semibold border-b border-slate-700 flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Minus className="w-3.5 h-3.5 text-rose-400" />
                        <span className="text-rose-400/80 font-normal truncate max-w-[150px]" title={leftName}>
                          {leftName}
                        </span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                      <div className="flex items-center gap-2">
                        <Plus className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400/80 font-normal truncate max-w-[150px]" title={rightName}>
                          {rightName}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto bg-slate-900 diff-scroll-container">
                      {unifiedLines.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 italic">
                          No content to display
                        </div>
                      ) : (
                        <div className="min-w-fit">
                          {unifiedLines.map((line, idx) => (
                            <UnifiedDiffRow key={idx} line={line} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <PanelGroup direction="horizontal" className="h-full">
                    <Panel defaultSize={50} minSize={20}>
                      <div className="h-full flex flex-col">
                        <div className="flex-shrink-0 px-4 py-2 bg-rose-500/10 text-rose-400 text-xs font-semibold border-b border-slate-700 flex items-center gap-2">
                          <Minus className="w-3.5 h-3.5" />
                          OLD VERSION
                          <span className="ml-auto text-rose-400/60 font-normal truncate max-w-[150px]" title={leftName}>
                            {leftName}
                          </span>
                        </div>
                        <div 
                          ref={leftScrollRef}
                          onScroll={() => syncScroll('left')}
                          className="flex-1 overflow-auto bg-slate-900 diff-scroll-container"
                        >
                          {leftLines.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 italic">
                              File not present in old version
                            </div>
                          ) : (
                            <div className="min-w-fit">
                              {leftLines.map((line, idx) => (
                                <DiffLineRow key={idx} line={line} side="left" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </Panel>
                    
                    <PanelResizeHandle className="w-1 bg-slate-700 hover:bg-blue-500 transition-colors cursor-col-resize" />
                    
                    <Panel defaultSize={50} minSize={20}>
                      <div className="h-full flex flex-col">
                        <div className="flex-shrink-0 px-4 py-2 bg-emerald-500/10 text-emerald-400 text-xs font-semibold border-b border-slate-700 flex items-center gap-2">
                          <Plus className="w-3.5 h-3.5" />
                          NEW VERSION
                          <span className="ml-auto text-emerald-400/60 font-normal truncate max-w-[150px]" title={rightName}>
                            {rightName}
                          </span>
                        </div>
                        <div 
                          ref={rightScrollRef}
                          onScroll={() => syncScroll('right')}
                          className="flex-1 overflow-auto bg-slate-900 diff-scroll-container"
                        >
                          {rightLines.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 italic">
                              File not present in new version
                            </div>
                          ) : (
                            <div className="min-w-fit">
                              {rightLines.map((line, idx) => (
                                <DiffLineRow key={idx} line={line} side="right" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </Panel>
                  </PanelGroup>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex items-center justify-center text-slate-500"
            >
              <div className="text-center">
                <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Select a file to view differences</p>
                <p className="text-sm text-slate-600 mt-1">Choose a file from the sidebar</p>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        )}
        </main>
      </div>
    </div>
  );
}
