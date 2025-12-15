import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  TrendingUp, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  FileDiff,
  ArrowRight,
} from "lucide-react";
import { Link } from "wouter";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";

interface DiffRun {
  id: number;
  leftArchiveId: number;
  rightArchiveId: number;
  status: string;
  createdAt: string;
  summary?: {
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

export default function Dashboard() {
  const [diffRuns, setDiffRuns] = useState<DiffRun[]>([]);
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [runsRes, archivesRes] = await Promise.all([
        fetch('/api/diff-runs'),
        fetch('/api/archives'),
      ]);

      const runsData = await runsRes.json();
      const archivesData = await archivesRes.json();

      setDiffRuns(runsData.diffRuns || []);
      setArchives(archivesData.archives || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalRuns = diffRuns.length;
  const completedRuns = diffRuns.filter(r => r.status === 'completed').length;
  const highSeverityCount = diffRuns
    .filter(r => r.summary?.high)
    .reduce((sum, r) => sum + (r.summary?.high || 0), 0);

  const successRate = totalRuns > 0 ? ((completedRuns / totalRuns) * 100).toFixed(1) : '0';

  // Generate chart data from diff runs (last 7 days)
  const chartData = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    
    const runsOnDay = diffRuns.filter(run => {
      const runDate = new Date(run.createdAt);
      return runDate.toDateString() === date.toDateString();
    }).length;

    return { name: dayName, runs: runsOnDay };
  });

  const getSeverityBadge = (summary?: { high: number; medium: number; low: number; info: number }) => {
    if (!summary) return { variant: 'secondary' as const, label: 'Processing' };
    if (summary.high > 0) return { variant: 'destructive' as const, label: 'High' };
    if (summary.medium > 0) return { variant: 'default' as const, label: 'Medium' };
    if (summary.low > 0) return { variant: 'secondary' as const, label: 'Low' };
    return { variant: 'outline' as const, label: 'Info' };
  };

  const getArchiveName = (id: number) => {
    const archive = archives.find(a => a.id === id);
    return archive?.name || `Archive ${id}`;
  };

  if (loading) {
    return (
      <AppLayout title="Dashboard" description="Loading...">
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout 
      title="Dashboard" 
      description="Overview of recent integration comparisons and analysis stats."
    >
      <div className="space-y-6">
        
        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { title: 'Total Runs', value: totalRuns, subtitle: `${completedRuns} completed`, icon: FileDiff, iconColor: 'text-primary', testId: 'card-total-runs', valueTestId: 'text-total-runs' },
            { title: 'High Severity Items', value: highSeverityCount, subtitle: 'Across all comparisons', icon: AlertTriangle, iconColor: 'text-destructive', testId: 'card-high-severity', valueTestId: 'text-high-severity' },
            { title: 'Archives', value: archives.length, subtitle: 'Uploaded archives', icon: Clock, iconColor: 'text-muted-foreground' },
            { title: 'Success Rate', value: `${successRate}%`, subtitle: 'Successful comparisons', icon: CheckCircle2, iconColor: 'text-green-500' },
          ].map((stat, index) => (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: index * 0.1, ease: "easeOut" }}
            >
              <Card className="shadow-xs hover:shadow-md transition-all hover:-translate-y-0.5" data-testid={stat.testId}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                  <stat.icon className={`h-4 w-4 ${stat.iconColor}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-display" data-testid={stat.valueTestId}>{stat.value}</div>
                  <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          
          {/* Main Chart */}
          <Card className="col-span-4 shadow-sm">
            <CardHeader>
              <CardTitle>Comparison Activity</CardTitle>
            </CardHeader>
            <CardContent className="pl-2">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis 
                      dataKey="name" 
                      stroke="#888888" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <YAxis 
                      stroke="#888888" 
                      fontSize={12} 
                      tickLine={false} 
                      axisLine={false} 
                      tickFormatter={(value) => `${value}`} 
                    />
                    <Tooltip 
                      cursor={{fill: 'transparent'}}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    />
                    <Bar 
                      dataKey="runs" 
                      fill="hsl(var(--primary))" 
                      radius={[4, 4, 0, 0]} 
                      barSize={40}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Recent Runs List */}
          <Card className="col-span-3 shadow-sm overflow-hidden">
            <CardHeader>
              <CardTitle>Recent Comparisons</CardTitle>
            </CardHeader>
            <CardContent className="overflow-hidden">
              <div className="space-y-4">
                {diffRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No comparisons yet. Upload archives to get started.
                  </p>
                ) : (
                  diffRuns.slice(0, 4).map((run) => {
                    const severity = getSeverityBadge(run.summary);
                    const changesCount = run.summary 
                      ? run.summary.high + run.summary.medium + run.summary.low 
                      : 0;

                    return (
                      <Link key={run.id} href={`/diff/${run.id}`}>
                        <div 
                          className="group cursor-pointer hover:bg-secondary/50 p-3 rounded-lg transition-colors"
                          data-testid={`row-diff-run-${run.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`
                              w-2 h-2 rounded-full mt-1.5 flex-shrink-0
                              ${severity.variant === 'destructive' ? 'bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 
                                severity.variant === 'default' ? 'bg-orange-500' : 
                                'bg-blue-500'}
                            `} />
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="text-sm font-medium leading-tight group-hover:text-primary transition-colors truncate" data-testid={`text-diff-run-name-${run.id}`}>
                                {getArchiveName(run.leftArchiveId)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                vs
                              </p>
                              <p className="text-sm font-medium leading-tight group-hover:text-primary transition-colors truncate">
                                {getArchiveName(run.rightArchiveId)}
                              </p>
                              <div className="flex items-center justify-between pt-1">
                                <p className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                                </p>
                                <Badge variant={severity.variant} className="text-xs font-normal flex-shrink-0">
                                  {changesCount} changes
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
