import { AlertTriangle, Check, ChevronRight, Clock, Sparkles } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { PromptAnalysis } from "../../lib/api";

interface PromptAnalysisCardProps {
  analysis: PromptAnalysis;
  onOpen: (analysis: PromptAnalysis) => void;
}

export function PromptAnalysisCard({ analysis, onOpen }: PromptAnalysisCardProps) {
  const clusterCount = analysis.failureClusters?.length ?? 0;
  const hasSuggestion = !!analysis.suggestedPrompt;
  const isApplied = !!analysis.appliedAt;

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-sm cursor-pointer"
      onClick={() => onOpen(analysis)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500 shrink-0" />
            <p className="text-sm font-semibold text-foreground line-clamp-2">
              {analysis.summary || "Analysis complete"}
            </p>
          </div>
        </div>
        {isApplied ? (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-200 bg-green-50 shrink-0">
            <Check className="h-3 w-3" />
            Applied
          </Badge>
        ) : hasSuggestion ? (
          <Badge variant="secondary" className="shrink-0">
            Has suggestion
          </Badge>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <p className="text-muted-foreground">Failure patterns</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">{clusterCount}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <p className="text-muted-foreground">Suggested fix</p>
          <p className="text-sm font-semibold text-foreground">{hasSuggestion ? "Yes" : "No"}</p>
        </div>
      </div>

      {clusterCount > 0 && analysis.failureClusters && (
        <div className="mt-3 flex flex-wrap gap-1">
          {analysis.failureClusters.slice(0, 3).map((cluster, i) => (
            <Badge key={i} variant="outline" className="text-xs font-mono">
              {cluster.category}
            </Badge>
          ))}
          {clusterCount > 3 && (
            <Badge variant="outline" className="text-xs">
              +{clusterCount - 3} more
            </Badge>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {new Date(analysis.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        {clusterCount > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {clusterCount} issue{clusterCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(analysis);
          }}
        >
          View details
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
