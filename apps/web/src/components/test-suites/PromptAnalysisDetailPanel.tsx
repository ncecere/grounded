import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import type { FailureCluster, PromptAnalysis } from "@/lib/api/types/test-suites";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

import { cn } from "@/lib/utils";

interface PromptAnalysisDetailPanelProps {
  analysis: PromptAnalysis | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyPrompt?: (runId: string) => void;
}

export function PromptAnalysisDetailPanel({
  analysis,
  open,
  onOpenChange,
  onApplyPrompt,
}: PromptAnalysisDetailPanelProps) {
  if (!analysis) {
    return null;
  }

  const clusterCount = analysis.failureClusters?.length ?? 0;
  const isApplied = !!analysis.appliedAt;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl md:max-w-3xl p-0 flex flex-col"
      >
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Prompt Analysis
          </SheetTitle>
          <SheetDescription className="text-sm flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {new Date(analysis.createdAt).toLocaleString("en-US")}
            </span>
            {isApplied ? (
              <Badge variant="outline" className="gap-1 text-green-600 border-green-200 bg-green-50">
                <Check className="h-3 w-3" />
                Applied
              </Badge>
            ) : (
              <Badge variant="secondary">Not applied</Badge>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Summary */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium mb-2">Summary</h3>
            <p className="text-sm text-muted-foreground">
              {analysis.summary || "No summary available."}
            </p>
          </div>

          {/* Failure Patterns */}
          {analysis.failureClusters && analysis.failureClusters.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-medium">
                  Failure Patterns ({clusterCount})
                </h3>
              </div>
              <FailureClusters clusters={analysis.failureClusters} />
            </div>
          )}

          {/* Suggested Prompt */}
          {analysis.suggestedPrompt && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  <h3 className="text-sm font-medium">Suggested Prompt</h3>
                </div>
                {isApplied ? (
                  <Badge variant="outline" className="gap-1 text-green-600 border-green-200 bg-green-50">
                    <Check className="h-3 w-3" />
                    Applied
                  </Badge>
                ) : (
                  onApplyPrompt && (
                    <Button
                      size="sm"
                      onClick={() => onApplyPrompt(analysis.runId)}
                      className="gap-2"
                    >
                      <ArrowRight className="h-3 w-3" />
                      Apply to Agent
                    </Button>
                  )
                )}
              </div>

              {analysis.rationale && (
                <p className="text-sm text-muted-foreground mb-4">{analysis.rationale}</p>
              )}

              <SuggestedPromptContent prompt={analysis.suggestedPrompt} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FailureClusters({ clusters }: { clusters: FailureCluster[] }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {clusters.map((cluster, index) => {
        const isExpanded = expandedIndex === index;
        return (
          <div
            key={index}
            className="border border-border rounded-lg overflow-hidden"
          >
            <button
              className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
              onClick={() => setExpandedIndex(isExpanded ? null : index)}
            >
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <Badge variant="outline" className="font-mono text-xs">
                  {cluster.category}
                </Badge>
                <span className="text-sm">{cluster.description}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {cluster.affectedCases.length} case{cluster.affectedCases.length !== 1 ? "s" : ""}
              </span>
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 pt-0 border-t border-border bg-muted/30">
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Suggested Fix
                    </p>
                    <p className="text-sm">{cluster.suggestedFix}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Affected Cases
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {cluster.affectedCases.map((caseSnippet, i) => (
                        <span
                          key={i}
                          className="text-xs bg-muted px-2 py-1 rounded truncate max-w-[200px]"
                          title={caseSnippet}
                        >
                          {caseSnippet}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SuggestedPromptContent({ prompt }: { prompt: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <>
      <div className="relative">
        <pre
          className={cn(
            "text-xs bg-muted p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono",
            !isExpanded && "max-h-32 overflow-hidden"
          )}
        >
          {prompt}
        </pre>
        {!isExpanded && prompt.length > 400 && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-muted to-transparent pointer-events-none" />
        )}
      </div>

      {prompt.length > 400 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full mt-2"
        >
          {isExpanded ? "Show less" : "Show full prompt"}
        </Button>
      )}
    </>
  );
}
