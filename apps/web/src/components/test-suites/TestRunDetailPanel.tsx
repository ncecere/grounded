import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Lightbulb,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  UserCircle,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { 
  useTestRun, 
  useExperiment, 
  useApplyExperiment,
  useRunAnalysis,
  useRunPromptAnalysis,
  useApplyAnalysisToAgent,
} from "../../lib/api/test-suites.hooks";
import type { Experiment, TestCaseResult, TestRunWithResults } from "../../lib/api";
import { Button } from "../ui/button";
import { ApplyPromptDialog } from "./ApplyPromptDialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { EmptyState } from "../ui/empty-state";
import { LoadingSkeleton } from "../ui/loading-skeleton";
import { Badge } from "../ui/badge";
import { StatusBadge, type StatusType } from "../ui/status-badge";
import { StatCard } from "../ui/stat-card";
import { Progress } from "../ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { CheckResultDisplay } from "./CheckResultDisplay";
import { cn } from "@/lib/utils";
import {
  formatRunDuration,
  formatRunTimingLabel,
  formatRunTriggerLabel,
  getRunStatusBadge,
} from "./TestRunCard";

type ResultFilter = "all" | "passed" | "failed" | "error";

const getCaseResultBadge = (status: TestCaseResult["status"]): { status: StatusType; label: string } => {
  switch (status) {
    case "passed":
      return { status: "success", label: "Passed" };
    case "failed":
      return { status: "error", label: "Failed" };
    case "skipped":
      return { status: "warning", label: "Skipped" };
    case "error":
      return { status: "error", label: "Error" };
    default:
      return { status: "default", label: "Unknown" };
  }
};

const formatRunTimestamp = (timestamp: string | null) => {
  if (!timestamp) {
    return "-";
  }
  return new Date(timestamp).toLocaleString("en-US");
};

const getFilteredResults = (run: TestRunWithResults | undefined, filter: ResultFilter) => {
  if (!run?.results) {
    return [] as TestCaseResult[];
  }
  if (filter === "all") {
    return run.results;
  }
  return run.results.filter((result) => result.status === filter);
};

interface TestRunDetailPanelProps {
  runId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TestRunDetailPanel({ runId, open, onOpenChange }: TestRunDetailPanelProps) {
  const [filter, setFilter] = useState<ResultFilter>("all");
  const { data: run, isLoading } = useTestRun(runId ?? "");

  const filteredResults = useMemo(() => getFilteredResults(run, filter), [run, filter]);
  const statusBadge: { status: StatusType; label: string } = run
    ? getRunStatusBadge(run)
    : { status: "default", label: "Run" };
  const durationLabel = formatRunDuration(run?.durationMs ?? null);
  const timingLabel = run ? formatRunTimingLabel(run) : "-";
  const triggerLabel = run ? formatRunTriggerLabel(run) : "";
  const totalCounted = run ? Math.max(0, run.totalCases - run.skippedCases) : 0;
  const hasCases = totalCounted > 0;
  const passRate = run && hasCases ? Math.min(100, Math.max(0, Math.round(run.passRate))) : 0;
  const passRateLabel = run ? (hasCases ? `${passRate}%` : "No cases") : "-";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl md:max-w-3xl lg:max-w-4xl p-0 flex flex-col"
      >
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="text-lg">{run?.suiteName ?? "Test Run"}</SheetTitle>
          <SheetDescription className="text-sm flex flex-wrap items-center gap-3">
            <StatusBadge status={statusBadge.status} label={statusBadge.label} />
            {triggerLabel && (
              <span className="inline-flex items-center gap-1">
                <UserCircle className="h-4 w-4" />
                {triggerLabel}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {isLoading ? (
            <LoadingSkeleton variant="stats" count={4} />
          ) : !run ? (
            <EmptyState
              title="Run not available"
              description="Select a test run to see its results."
            />
          ) : (
            <>
              {run.errorMessage && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {run.errorMessage}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Pass rate</span>
                  <span className={cn("font-medium", hasCases ? "text-foreground" : "text-muted-foreground")}>
                    {passRateLabel}
                  </span>
                </div>
                <Progress value={passRate} className={cn("h-2", !hasCases && "opacity-40")} />
              </div>

              {run.totalCases === 0 && (
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  This run completed with no enabled test cases.
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Total cases"
                  value={run.totalCases}
                  icon={ListChecks}
                  iconColor="muted"
                />
                <StatCard
                  label="Passed"
                  value={run.passedCases}
                  icon={CheckCircle2}
                  iconColor="success"
                />
                <StatCard
                  label="Failed"
                  value={run.failedCases}
                  icon={XCircle}
                  iconColor="destructive"
                />
                <StatCard
                  label="Skipped"
                  value={run.skippedCases}
                  icon={MinusCircle}
                  iconColor="warning"
                />
              </div>

              {/* A/B Experiment Section - right after stats */}
              {run.experimentId && (
                <ExperimentSection 
                  experimentId={run.experimentId} 
                  currentRunId={run.id}
                />
              )}

              {/* Prompt Analysis Section - for non-experiment runs with failures */}
              {!run.experimentId && run.failedCases > 0 && (
                <PromptAnalysisSection 
                  runId={run.id}
                  suiteId={run.suiteId}
                  currentPrompt={run.systemPrompt ?? ""}
                />
              )}

              <div className="grid gap-3 rounded-lg border border-border bg-muted/10 p-4 text-xs text-muted-foreground sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>{timingLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Timer className="h-4 w-4" />
                  <span>Duration {durationLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>Started {formatRunTimestamp(run.startedAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>Completed {formatRunTimestamp(run.completedAt)}</span>
                </div>
              </div>

              {run.systemPrompt && (
                <Collapsible defaultOpen={false} className="rounded-lg border border-border bg-muted/10">
                  <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 p-4 text-left">
                    <div>
                      <p className="text-sm font-medium text-foreground">System prompt</p>
                      <p className="text-xs text-muted-foreground">Prompt used for this run</p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-4 pb-4">
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {run.systemPrompt}
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Test Case Results</p>
                  <p className="text-xs text-muted-foreground">
                    Showing {filteredResults.length} of {run.results.length} results
                  </p>
                </div>
                <Tabs value={filter} onValueChange={(value) => setFilter(value as ResultFilter)}>
                  <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="passed">Passed</TabsTrigger>
                    <TabsTrigger value="failed">Failed</TabsTrigger>
                    <TabsTrigger value="error">Error</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {filteredResults.length === 0 ? (
                <EmptyState
                  title="No results for this filter"
                  description="Try another status filter to see additional test cases."
                />
              ) : (
                <div className="space-y-4">
                  {filteredResults.map((result) => {
                    const badge = getCaseResultBadge(result.status);
                    return (
                      <div key={result.id} className="rounded-lg border border-border bg-card p-4 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{result.testCaseName}</p>
                            <p className="text-xs text-muted-foreground mt-1">{result.question}</p>
                          </div>
                          <div className="text-right space-y-2">
                            <StatusBadge status={badge.status} label={badge.label} />
                            <p className="text-xs text-muted-foreground">
                              {formatRunDuration(result.durationMs)}
                            </p>
                          </div>
                        </div>

                        {result.actualResponse && (
                          <Collapsible defaultOpen={false} className="rounded-md border border-border bg-muted/20">
                            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 p-3 text-left">
                              <div>
                                <p className="text-xs uppercase text-muted-foreground">Actual response</p>
                                <p className="text-xs text-muted-foreground">Click to expand</p>
                              </div>
                              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                            </CollapsibleTrigger>
                            <CollapsibleContent className="px-3 pb-3">
                              <p className="text-sm text-foreground whitespace-pre-wrap">
                                {result.actualResponse}
                              </p>
                            </CollapsibleContent>
                          </Collapsible>
                        )}

                        {result.errorMessage && (
                          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                            {result.errorMessage}
                          </div>
                        )}

                        <div className="space-y-2">
                          {result.checkResults.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No check results recorded.</p>
                          ) : (
                            result.checkResults.map((check) => (
                              <CheckResultDisplay key={check.checkIndex} check={check} />
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Prompt Analysis Section (for non-experiment runs)
// ============================================================================

interface PromptAnalysisSectionProps {
  runId: string;
  suiteId: string;
  currentPrompt: string;
}

function PromptAnalysisSection({ runId, suiteId, currentPrompt }: PromptAnalysisSectionProps) {
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: analysis, isLoading: analysisLoading } = useRunAnalysis(runId);
  const runAnalysisMutation = useRunPromptAnalysis(suiteId);
  const applyMutation = useApplyAnalysisToAgent();

  const handleRunAnalysis = () => {
    runAnalysisMutation.mutate(runId);
  };

  const handleApplyPrompt = () => {
    applyMutation.mutate(runId, {
      onSuccess: () => {
        setShowApplyDialog(false);
      },
    });
  };

  // No analysis yet - show button to generate one
  if (!analysis && !analysisLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            <div>
              <h3 className="text-sm font-medium">Prompt Analysis</h3>
              <p className="text-xs text-muted-foreground">
                Analyze failures and get AI-suggested prompt improvements
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunAnalysis}
            disabled={runAnalysisMutation.isPending}
            className="gap-2"
          >
            {runAnalysisMutation.isPending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                Analyze Failures
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // Loading state
  if (analysisLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading analysis...</span>
        </div>
      </div>
    );
  }

  // Have analysis - show it
  if (!analysis) return null;

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            <h3 className="text-sm font-medium">Prompt Analysis</h3>
          </div>
          {analysis.appliedAt && (
            <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-500/30">
              <Check className="h-3 w-3" />
              Applied
            </Badge>
          )}
        </div>

        {/* Summary */}
        <p className="text-sm text-muted-foreground">{analysis.summary}</p>

        {/* Failure Clusters */}
        {analysis.failureClusters && analysis.failureClusters.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase">Failure Patterns</p>
            <div className="space-y-2">
              {analysis.failureClusters.slice(0, 3).map((cluster, idx) => (
                <div key={idx} className="text-sm p-2 rounded-md bg-muted/50 border border-border">
                  <p className="font-medium">{cluster.category}</p>
                  <p className="text-xs text-muted-foreground mt-1">{cluster.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {cluster.affectedCases.length} case{cluster.affectedCases.length !== 1 ? "s" : ""} affected
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Prompt */}
        {analysis.suggestedPrompt && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 p-3 text-left rounded-lg border border-border bg-muted/10 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-yellow-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">Suggested Prompt</p>
                  <p className="text-xs text-muted-foreground">
                    AI-generated prompt improvement based on failure analysis
                  </p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                {analysis.suggestedPrompt}
              </pre>

              {/* Rationale */}
              {analysis.rationale && (
                <div className="mt-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">Rationale</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">{analysis.rationale}</p>
                </div>
              )}

              {/* Apply Button */}
              {!analysis.appliedAt && currentPrompt && (
                <div className="mt-3 flex items-center justify-end">
                  <Button
                    size="sm"
                    onClick={() => setShowApplyDialog(true)}
                    className="gap-2"
                  >
                    <ArrowRight className="h-3 w-3" />
                    Apply to Agent
                  </Button>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Apply Prompt Dialog */}
      {analysis.suggestedPrompt && currentPrompt && (
        <ApplyPromptDialog
          open={showApplyDialog}
          onOpenChange={setShowApplyDialog}
          currentPrompt={currentPrompt}
          suggestedPrompt={analysis.suggestedPrompt}
          onConfirm={handleApplyPrompt}
          isLoading={applyMutation.isPending}
        />
      )}
    </>
  );
}

// ============================================================================
// A/B Experiment Section
// ============================================================================

interface ExperimentSectionProps {
  experimentId: string;
  currentRunId: string;
}

function ExperimentSection({ experimentId, currentRunId }: ExperimentSectionProps) {
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const { data: comparison, isLoading } = useExperiment(experimentId);
  const applyExperimentMutation = useApplyExperiment();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
          <h3 className="text-sm font-medium">A/B Experiment</h3>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading experiment data...
        </div>
      </div>
    );
  }

  if (!comparison) {
    return null;
  }

  const { experiment, baseline, candidate, delta } = comparison;
  const isInProgress = [
    "pending",
    "baseline_running",
    "analyzing",
    "candidate_running",
  ].includes(experiment.status);

  // Determine which variant this run represents
  const isBaseline = experiment.baselineRunId === currentRunId;
  const isCandidate = experiment.candidateRunId === currentRunId;
  
  // Check if candidate performed better and experiment is completed
  const candidateWon = delta && delta.passRate > 0 && experiment.status === "completed";
  const candidatePrompt = experiment.candidatePrompt || candidate?.systemPrompt;

  const handleApplyPrompt = () => {
    applyExperimentMutation.mutate(experimentId, {
      onSuccess: () => {
        setShowApplyDialog(false);
      },
    });
  };

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <RefreshCw className={cn("h-4 w-4", isInProgress && "animate-spin text-blue-500")} />
            <h3 className="text-sm font-medium">A/B Experiment</h3>
          </div>
          <div className="flex items-center gap-2">
            {isBaseline && (
              <Badge variant="outline" className="text-xs">Baseline Run</Badge>
            )}
            {isCandidate && (
              <Badge variant="secondary" className="text-xs">Candidate Run</Badge>
            )}
            <ExperimentStatusBadge status={experiment.status} />
          </div>
        </div>

        {isInProgress ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {getExperimentStatusLabel(experiment.status)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {/* Baseline */}
            <div className={cn("text-center p-3 rounded-lg", isBaseline && "bg-muted/50 ring-1 ring-primary/20")}>
              <p className="text-xs text-muted-foreground mb-1">Baseline</p>
              <p className="text-2xl font-semibold">
                {baseline ? `${Math.round(baseline.passRate)}%` : "-"}
              </p>
              <p className="text-xs text-muted-foreground">
                {baseline ? `${baseline.passedCases}/${baseline.totalCases}` : ""}
              </p>
            </div>

            {/* Delta */}
            <div className="text-center flex flex-col items-center justify-center">
              {delta ? (
                <>
                  <div
                    className={cn(
                      "flex items-center gap-1 text-lg font-semibold",
                      delta.passRate > 0 && "text-green-600",
                      delta.passRate < 0 && "text-red-600",
                      delta.passRate === 0 && "text-muted-foreground"
                    )}
                  >
                    {delta.passRate > 0 ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : delta.passRate < 0 ? (
                      <TrendingDown className="h-4 w-4" />
                    ) : null}
                    {delta.passRate > 0 ? "+" : ""}
                    {Math.round(delta.passRate)}%
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {delta.passedCases > 0 ? "+" : ""}
                    {delta.passedCases} passed
                  </p>
                </>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </div>

            {/* Candidate */}
            <div className={cn("text-center p-3 rounded-lg", isCandidate && "bg-muted/50 ring-1 ring-primary/20")}>
              <p className="text-xs text-muted-foreground mb-1">
                {experiment.candidateSource === "manual" ? "Manual" : "Suggested"}
              </p>
              <p className="text-2xl font-semibold">
                {candidate ? `${Math.round(candidate.passRate)}%` : "-"}
              </p>
              <p className="text-xs text-muted-foreground">
                {candidate ? `${candidate.passedCases}/${candidate.totalCases}` : ""}
              </p>
            </div>
          </div>
        )}

        {/* Candidate Prompt Section */}
        {!isInProgress && candidatePrompt && (
          <Collapsible open={isPromptExpanded} onOpenChange={setIsPromptExpanded}>
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 p-3 text-left rounded-lg border border-border bg-muted/10 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-yellow-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {experiment.candidateSource === "manual" ? "Manual Candidate Prompt" : "Suggested Prompt"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {candidateWon ? "This prompt improved results" : "Click to view the candidate prompt"}
                  </p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="relative">
                <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                  {candidatePrompt}
                </pre>
              </div>
              
              {/* Apply Button - always show when experiment is completed */}
              {experiment.status === "completed" && baseline?.systemPrompt && (
                <div className={cn(
                  "mt-3 flex items-center justify-between p-3 rounded-lg border",
                  candidateWon 
                    ? "border-green-500/20 bg-green-500/10" 
                    : "border-border bg-muted/30"
                )}>
                  <div className="flex items-center gap-2 text-sm">
                    {candidateWon ? (
                      <>
                        <Check className="h-4 w-4 text-green-600" />
                        <span className="text-green-700 dark:text-green-300">
                          Candidate performed better (+{Math.round(delta?.passRate ?? 0)}%)
                        </span>
                      </>
                    ) : delta && delta.passRate < 0 ? (
                      <>
                        <TrendingDown className="h-4 w-4 text-red-500" />
                        <span className="text-muted-foreground">
                          Candidate performed worse ({Math.round(delta.passRate)}%)
                        </span>
                      </>
                    ) : (
                      <>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          No improvement (same pass rate)
                        </span>
                      </>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={candidateWon ? "default" : "outline"}
                    onClick={() => setShowApplyDialog(true)}
                    className="gap-2"
                  >
                    <ArrowRight className="h-3 w-3" />
                    {candidateWon ? "Apply to Agent" : "Apply Anyway"}
                  </Button>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Apply Prompt Dialog */}
      {candidatePrompt && baseline?.systemPrompt && (
        <ApplyPromptDialog
          open={showApplyDialog}
          onOpenChange={setShowApplyDialog}
          currentPrompt={baseline.systemPrompt}
          suggestedPrompt={candidatePrompt}
          onConfirm={handleApplyPrompt}
          isLoading={applyExperimentMutation.isPending}
        />
      )}
    </>
  );
}

function ExperimentStatusBadge({ status }: { status: Experiment["status"] }) {
  const config: Record<
    Experiment["status"],
    { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
  > = {
    pending: { label: "Pending", variant: "secondary" },
    baseline_running: { label: "Baseline", variant: "default" },
    analyzing: { label: "Analyzing", variant: "default" },
    candidate_running: { label: "Candidate", variant: "default" },
    completed: { label: "Completed", variant: "outline" },
    failed: { label: "Failed", variant: "destructive" },
  };

  const { label, variant } = config[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function getExperimentStatusLabel(status: Experiment["status"]): string {
  const labels: Record<Experiment["status"], string> = {
    pending: "Starting experiment...",
    baseline_running: "Running baseline test...",
    analyzing: "Analyzing results...",
    candidate_running: "Running candidate test...",
    completed: "Experiment completed",
    failed: "Experiment failed",
  };
  return labels[status];
}
