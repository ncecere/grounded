import { useState, useMemo } from "react";
import { FileText, Sparkles } from "lucide-react";
import { useAnalyses } from "../../lib/api/test-suites.hooks";
import type { PromptAnalysis, TestSuite } from "../../lib/api/types/test-suites";
import { EmptyState } from "../ui/empty-state";
import { LoadingSkeleton } from "../ui/loading-skeleton";
import { PromptAnalysisCard } from "./PromptAnalysisCard";
import { PromptAnalysisDetailPanel } from "./PromptAnalysisDetailPanel";

interface PromptAnalysisPanelProps {
  suite: TestSuite;
  onApplyPrompt?: (runId: string) => void;
}

export function PromptAnalysisPanel({ suite, onApplyPrompt }: PromptAnalysisPanelProps) {
  const [selectedAnalysis, setSelectedAnalysis] = useState<PromptAnalysis | null>(null);
  
  const params = useMemo(() => ({ limit: 10, offset: 0 }), []);
  const { data, isLoading } = useAnalyses(suite.id, params);

  if (!suite.promptAnalysisEnabled && !suite.abTestingEnabled) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Prompt analysis is disabled"
        description="Enable prompt analysis in the Evaluation tab to automatically analyze test failures and get suggested prompt improvements."
      />
    );
  }

  if (isLoading) {
    return <LoadingSkeleton variant="card" count={3} />;
  }

  const analyses = data?.analyses ?? [];

  if (analyses.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No analyses yet"
        description="Run the test suite to generate a prompt analysis. Analysis runs automatically after each test run when enabled."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {analyses.length} analysis record{analyses.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {analyses.map((analysis) => (
          <PromptAnalysisCard
            key={analysis.id}
            analysis={analysis}
            onOpen={setSelectedAnalysis}
          />
        ))}
      </div>

      <PromptAnalysisDetailPanel
        analysis={selectedAnalysis}
        open={!!selectedAnalysis}
        onOpenChange={(open) => !open && setSelectedAnalysis(null)}
        onApplyPrompt={onApplyPrompt}
      />
    </div>
  );
}
