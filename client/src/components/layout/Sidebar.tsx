import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  GitCompare, 
  History, 
  Settings, 
  FileDiff,
  Trash2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export function Sidebar() {
  const [location] = useLocation();
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [isClearing, setIsClearing] = useState(false);
  const { toast } = useToast();

  const handleClearDatabase = async () => {
    if (!password) return;
    
    setIsClearing(true);
    try {
      const res = await fetch('/api/admin/clear-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        toast({ title: "Database Cleared", description: "All data has been removed." });
        setClearDialogOpen(false);
        setPassword("");
        window.location.reload();
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to clear database", variant: "destructive" });
    } finally {
      setIsClearing(false);
    }
  };

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", disabled: false },
    { icon: GitCompare, label: "New Comparison", href: "/", disabled: false },
    { icon: History, label: "History", href: "/history", disabled: true },
    { icon: Settings, label: "Settings", href: "/settings", disabled: true },
  ];

  return (
    <div className="h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
      <div className="p-6 flex items-center gap-3">
        <div className="bg-primary/20 p-2 rounded-lg">
          <FileDiff className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="font-display font-bold text-lg tracking-tight">OIC Diff</h1>
          <p className="text-xs text-sidebar-foreground/60">Enterprise Edition</p>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-1">
        <div className="text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider mb-4 px-2">
          Platform
        </div>
        {navItems.map((item) => {
          const isActive = location === item.href;
          
          if (item.disabled) {
            return (
              <div key={item.href} className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground/30 cursor-not-allowed">
                <item.icon className="w-4 h-4 text-sidebar-foreground/20" />
                {item.label}
                <span className="text-[10px] ml-auto opacity-60">Soon</span>
              </div>
            );
          }
          
          return (
            <Link key={item.href} href={item.href} className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 group",
              isActive 
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm" 
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}>
              <item.icon className={cn("w-4 h-4", isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground")} />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="p-4 border-t border-sidebar-border space-y-3">
        <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="w-4 h-4 mr-2" />
              Clear Database
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clear Database</DialogTitle>
              <DialogDescription>
                This will remove all archives, comparisons, and reports. Enter the admin password to confirm.
              </DialogDescription>
            </DialogHeader>
            <Input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleClearDatabase()}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setClearDialogOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleClearDatabase} disabled={isClearing || !password}>
                {isClearing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Clear All Data
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="px-2 py-1 text-xs text-sidebar-foreground/40 text-center">
          Public Access Mode
        </div>
      </div>
    </div>
  );
}
