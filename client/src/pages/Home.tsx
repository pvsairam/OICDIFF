import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Upload, FileArchive, ArrowRight, Loader2, FileCheck, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { processArchiveClientSide } from "@/lib/archiveProcessor";

interface SavedArchive {
  id: number;
  name: string;
  size: number;
}

const STORAGE_KEY = 'oic-diff-uploads';

export default function Home() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const [isComparing, setIsComparing] = useState(false);
  const [leftFile, setLeftFile] = useState<File | null>(null);
  const [rightFile, setRightFile] = useState<File | null>(null);
  const [leftArchiveId, setLeftArchiveId] = useState<number | null>(null);
  const [rightArchiveId, setRightArchiveId] = useState<number | null>(null);
  const [leftUploading, setLeftUploading] = useState(false);
  const [rightUploading, setRightUploading] = useState(false);
  const [leftProgress, setLeftProgress] = useState(0);
  const [rightProgress, setRightProgress] = useState(0);
  const [leftSavedArchive, setLeftSavedArchive] = useState<SavedArchive | null>(null);
  const [rightSavedArchive, setRightSavedArchive] = useState<SavedArchive | null>(null);
  const leftInputRef = useRef<HTMLInputElement>(null);
  const rightInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const { left, right } = JSON.parse(saved);
        if (left) {
          setLeftSavedArchive(left);
          setLeftArchiveId(left.id);
        }
        if (right) {
          setRightSavedArchive(right);
          setRightArchiveId(right.id);
        }
      } catch (e) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const saveToStorage = (left: SavedArchive | null, right: SavedArchive | null) => {
    if (left || right) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, right }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const handleFileSelect = (file: File, side: 'left' | 'right') => {
    if (!file.name.endsWith('.iar')) {
      toast({
        title: "Invalid file",
        description: "Please upload a .iar file",
        variant: "destructive",
      });
      return;
    }

    if (side === 'left') {
      setLeftFile(file);
      setLeftSavedArchive(null);
      setLeftUploading(true);
      setLeftProgress(0);
    } else {
      setRightFile(file);
      setRightSavedArchive(null);
      setRightUploading(true);
      setRightProgress(0);
    }
    
    requestAnimationFrame(() => {
      uploadFile(file, side);
    });
  };

  const [leftProcessStage, setLeftProcessStage] = useState('');
  const [rightProcessStage, setRightProcessStage] = useState('');

  const uploadFile = async (file: File, side: 'left' | 'right') => {
    const setProgress = side === 'left' ? setLeftProgress : setRightProgress;
    const setProcessStage = side === 'left' ? setLeftProcessStage : setRightProcessStage;

    try {
      // Process archive client-side (extract, hash, parse)
      setProcessStage('Extracting archive...');
      const processed = await processArchiveClientSide(file, (stage, percent) => {
        setProcessStage(stage);
        setProgress(Math.round(percent * 0.7)); // 0-70% for client processing
      });
      
      // Send pre-processed data to lightweight API endpoint
      setProcessStage('Uploading to server...');
      setProgress(75);

      const response = await fetch('/api/archives/upload-processed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(processed),
      });

      setProgress(90);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await response.json();
      setProgress(100);
      setProcessStage('');
      
      const savedArchive: SavedArchive = {
        id: data.archive.id,
        name: file.name,
        size: file.size,
      };

      if (side === 'left') {
        setLeftArchiveId(data.archive.id);
        setLeftSavedArchive(savedArchive);
        saveToStorage(savedArchive, rightSavedArchive);
      } else {
        setRightArchiveId(data.archive.id);
        setRightSavedArchive(savedArchive);
        saveToStorage(leftSavedArchive, savedArchive);
      }

      toast({
        title: "Upload successful",
        description: `${file.name} processed successfully`,
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload archive. Please try again.",
        variant: "destructive",
      });
      
      if (side === 'left') {
        setLeftFile(null);
        setLeftArchiveId(null);
        setLeftSavedArchive(null);
        saveToStorage(null, rightSavedArchive);
      } else {
        setRightFile(null);
        setRightArchiveId(null);
        setRightSavedArchive(null);
        saveToStorage(leftSavedArchive, null);
      }
    } finally {
      if (side === 'left') {
        setLeftUploading(false);
        setLeftProcessStage('');
      } else {
        setRightUploading(false);
        setRightProcessStage('');
      }
    }
  };

  const clearArchive = (side: 'left' | 'right') => {
    if (side === 'left') {
      setLeftFile(null);
      setLeftArchiveId(null);
      setLeftSavedArchive(null);
      saveToStorage(null, rightSavedArchive);
    } else {
      setRightFile(null);
      setRightArchiveId(null);
      setRightSavedArchive(null);
      saveToStorage(leftSavedArchive, null);
    }
  };

  const handleCompare = async () => {
    if (!leftArchiveId || !rightArchiveId) return;

    setIsComparing(true);

    try {
      const response = await fetch('/api/diff-runs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leftArchiveId,
          rightArchiveId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create diff run');
      }

      const data = await response.json();
      localStorage.removeItem(STORAGE_KEY);
      setLocation(`/diff/${data.diffRun.id}`);
    } catch (error) {
      toast({
        title: "Comparison failed",
        description: "Failed to create diff run. Please try again.",
        variant: "destructive",
      });
      setIsComparing(false);
    }
  };

  const DropZone = ({ 
    file, 
    savedArchive,
    label, 
    side,
    isUploading,
  }: { 
    file: File | null, 
    savedArchive: SavedArchive | null,
    label: string,
    side: 'left' | 'right',
    isUploading: boolean,
  }) => {
    const inputRef = side === 'left' ? leftInputRef : rightInputRef;
    const hasArchive = file || savedArchive;
    const archiveName = file?.name || savedArchive?.name;
    const archiveSize = file?.size || savedArchive?.size;
    const isLeft = side === 'left';

    return (
      <div 
        className={`
          relative border-2 border-dashed rounded-xl p-8 transition-all duration-300 h-64 flex flex-col items-center justify-center cursor-pointer group
          ${hasArchive 
            ? isLeft 
              ? "border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20" 
              : "border-teal-500/50 bg-teal-50/50 dark:bg-teal-950/20"
            : "border-border hover:border-primary/50 hover:bg-secondary/30"
          }
          ${isUploading ? 'pointer-events-none' : ''}
        `}
        onClick={() => !hasArchive && !isUploading && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (isUploading) return;
          const droppedFile = e.dataTransfer.files[0];
          if (droppedFile) {
            handleFileSelect(droppedFile, side);
          }
        }}
        data-testid={`dropzone-${side}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".iar,application/zip"
          className="hidden"
          onChange={(e) => {
            const selectedFile = e.target.files?.[0];
            if (selectedFile) {
              handleFileSelect(selectedFile, side);
            }
          }}
        />
        
        <AnimatePresence mode="wait">
          {isUploading ? (
            <motion.div 
              key="uploading"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="flex flex-col items-center text-center space-y-4 w-full px-6"
            >
              <div className="relative">
                <motion.div
                  className={`absolute inset-0 rounded-full ${isLeft ? 'bg-blue-400/30' : 'bg-teal-400/30'}`}
                  animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                />
                <div className={`relative w-16 h-16 rounded-full flex items-center justify-center ${isLeft ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-gradient-to-br from-teal-500 to-teal-600'} shadow-lg`}>
                  <span className="text-white font-bold text-lg">
                    {isLeft ? leftProgress : rightProgress}%
                  </span>
                </div>
              </div>
              <div className="w-full max-w-[200px]">
                <div className={`h-2 rounded-full overflow-hidden ${isLeft ? 'bg-blue-200 dark:bg-blue-900/50' : 'bg-teal-200 dark:bg-teal-900/50'}`}>
                  <motion.div 
                    className={`h-full rounded-full ${isLeft ? 'bg-gradient-to-r from-blue-500 to-blue-600' : 'bg-gradient-to-r from-teal-500 to-teal-600'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${isLeft ? leftProgress : rightProgress}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </div>
              </div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <p className={`font-semibold text-lg ${isLeft ? 'text-blue-600 dark:text-blue-400' : 'text-teal-600 dark:text-teal-400'}`}>
                  Processing...
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {isLeft ? leftProcessStage : rightProcessStage || 'Extracting and indexing files'}
                </p>
              </motion.div>
            </motion.div>
          ) : hasArchive ? (
            <motion.div 
              key="uploaded"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="flex flex-col items-center text-center space-y-4"
            >
              <motion.div 
                className="relative"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.1 }}
              >
                <div className={`w-20 h-20 rounded-full flex items-center justify-center ${isLeft ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-gradient-to-br from-teal-500 to-teal-600'} shadow-lg`}>
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.2 }}
                  >
                    <FileCheck className="w-10 h-10 text-white" />
                  </motion.div>
                </div>
                <motion.div
                  className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 15, delay: 0.4 }}
                >
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </motion.div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <p className="font-semibold text-foreground">{archiveName}</p>
                <p className="text-sm text-muted-foreground">
                  {archiveSize ? `${(archiveSize / 1024 / 1024).toFixed(2)} MB • ` : ''}
                  <span className="text-green-600 dark:text-green-400">Ready</span>
                </p>
              </motion.div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearArchive(side);
                  }}
                  data-testid={`button-remove-${side}`}
                >
                  <X className="w-4 h-4 mr-1" /> Remove
                </Button>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div 
              key="empty"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="flex flex-col items-center text-center space-y-4"
            >
              <motion.div 
                className={`w-20 h-20 rounded-2xl flex items-center justify-center transition-all duration-300 ${isLeft ? 'bg-blue-50 dark:bg-blue-950/30 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50' : 'bg-teal-50 dark:bg-teal-950/30 group-hover:bg-teal-100 dark:group-hover:bg-teal-900/50'}`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <FileArchive className={`w-10 h-10 transition-colors duration-300 ${isLeft ? 'text-blue-400 group-hover:text-blue-600' : 'text-teal-400 group-hover:text-teal-600'}`} />
              </motion.div>
              <div>
                <p className="font-semibold text-foreground text-lg">{label}</p>
                <p className="text-sm text-muted-foreground mt-1">Drag & drop .iar file here</p>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                className={`mt-2 transition-all duration-300 ${isLeft ? 'hover:border-blue-400 hover:text-blue-600' : 'hover:border-teal-400 hover:text-teal-600'}`}
                data-testid={`button-browse-${side}`}
              >
                <Upload className="w-4 h-4 mr-2" /> Browse Files
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <AppLayout 
      title="New Comparison" 
      description="Upload two Oracle Integration Cloud (OIC) archives to generate a semantic diff report."
    >
      <div className="flex-1 flex flex-col justify-center max-w-5xl mx-auto w-full">
        
        <div className="grid md:grid-cols-2 gap-8 items-center relative">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden md:flex w-10 h-10 bg-background border border-border rounded-full items-center justify-center shadow-sm text-muted-foreground">
            <ArrowRight className="w-5 h-5" />
          </div>

          <DropZone 
            file={leftFile} 
            savedArchive={leftSavedArchive}
            label="Source Archive (Before)" 
            side="left"
            isUploading={leftUploading}
          />
          
          <DropZone 
            file={rightFile} 
            savedArchive={rightSavedArchive}
            label="Target Archive (After)" 
            side="right"
            isUploading={rightUploading}
          />
        </div>

        <div className="mt-12 flex flex-col items-center space-y-4">
          <Button 
            size="lg" 
            className="h-14 px-8 text-lg font-medium shadow-lg shadow-primary/20 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
            disabled={!leftArchiveId || !rightArchiveId || isComparing || leftUploading || rightUploading}
            onClick={handleCompare}
            data-testid="button-generate-diff"
          >
            {isComparing ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Comparing Archives...
              </>
            ) : (
              <>
                Compare Archives
                <ArrowRight className="ml-2 h-5 w-5" />
              </>
            )}
          </Button>
          <p className="text-sm text-muted-foreground">
            Archives are processed server-side. No data leaves your environment.
          </p>
        </div>

      </div>
    </AppLayout>
  );
}
