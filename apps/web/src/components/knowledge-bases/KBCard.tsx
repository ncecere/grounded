import { Share2, FileText, Database, FolderOpen, Settings, Trash2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import type { KnowledgeBase } from "../../lib/api";

interface KBCardProps {
  kb: KnowledgeBase;
  onOpen: (kb: KnowledgeBase) => void;
  onConfigure: (kb: KnowledgeBase) => void;
  onDelete: (kb: KnowledgeBase) => void;
}

export function KBCard({ kb, onOpen, onConfigure, onDelete }: KBCardProps) {
  const isShared = kb.isShared;
  const isReindexing = kb.reindexStatus === "pending" || kb.reindexStatus === "in_progress";

  return (
    <div
      className={`group relative bg-card rounded-lg border p-5 transition-all cursor-pointer flex flex-col min-h-[180px] ${
        isShared
          ? "border-purple-500/30 hover:border-purple-500/50 hover:shadow-md"
          : "border-border hover:border-primary/50 hover:shadow-md"
      }`}
      onClick={() => onOpen(kb)}
    >
      {/* Shared badge - upper right corner */}
      {isShared && (
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-purple-500/15 text-purple-600 dark:text-purple-400 rounded-full">
          <Share2 className="w-3 h-3" />
          Shared
        </span>
      )}

      {/* Main content */}
      <div className="flex-1">
        <h3 className={`text-lg font-semibold text-foreground truncate ${isShared ? "pr-20" : ""}`}>
          {kb.name}
        </h3>
        {kb.description && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {kb.description}
          </p>
        )}
      </div>

      {/* Footer - always at bottom */}
      <div className="mt-auto pt-4">
        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <FileText className="w-4 h-4" />
            {kb.sourceCount ?? 0} sources
          </span>
          <span className="inline-flex items-center gap-1">
            <Database className="w-4 h-4" />
            {kb.chunkCount ?? 0} chunks
          </span>
        </div>

        {/* Created date and status row */}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground/60">
            Created {new Date(kb.createdAt).toLocaleDateString()}
          </span>
          <div className="flex items-center gap-2">
            {isShared && (
              <span className="text-xs text-purple-500 dark:text-purple-400 italic">Read-only</span>
            )}
            {kb.reindexStatus === "failed" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-destructive/15 text-destructive rounded-full">
                <AlertCircle className="w-3 h-3" />
                Reindex Failed
              </span>
            )}
            {isReindexing && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded-full">
                <Loader2 className="w-3 h-3 animate-spin" />
                Reindexing{kb.reindexProgress != null ? ` ${kb.reindexProgress}%` : "..."}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Hover overlay with actions - only for non-shared KBs */}
      {!isShared && (
        <div
          className="absolute inset-0 rounded-lg bg-background/95 backdrop-blur-sm flex items-center justify-center gap-2 transition-opacity opacity-0 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="default"
            size="sm"
            onClick={() => onOpen(kb)}
            className="gap-1.5"
          >
            <FolderOpen className="w-4 h-4" />
            Open
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onConfigure(kb)}
            className="gap-1.5"
          >
            <Settings className="w-4 h-4" />
            Configure
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(kb)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* For shared KBs, show simpler hover */}
      {isShared && (
        <div
          className="absolute inset-0 rounded-lg bg-background/95 backdrop-blur-sm flex items-center justify-center gap-2 transition-opacity opacity-0 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="default"
            size="sm"
            onClick={() => onOpen(kb)}
            className="gap-1.5"
          >
            <FolderOpen className="w-4 h-4" />
            View
          </Button>
        </div>
      )}
    </div>
  );
}
