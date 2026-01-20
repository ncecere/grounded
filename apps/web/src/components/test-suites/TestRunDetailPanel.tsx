import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ListChecks,
  Timer,
  UserCircle,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { useTestRun } from "../../lib/api/test-suites.hooks";
import type { TestCaseResult, TestRunWithResults } from "../../lib/api";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { EmptyState } from "../ui/empty-state";
import { LoadingSkeleton } from "../ui/loading-skeleton";
import { StatusBadge, type StatusType } from "../ui/status-badge";
import { StatCard } from "../ui/stat-card";
import { Progress } from "../ui/progress";
import { CheckResultDisplay } from "./CheckResultDisplay";
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
  const passRate = run ? Math.min(100, Math.max(0, Math.round(run.passRate))) : 0;

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
                  <span className="font-medium text-foreground">{passRate}%</span>
                </div>
                <Progress value={passRate} className="h-2" />
              </div>

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
                          <div className="rounded-md border border-border bg-muted/20 p-3">
                            <p className="text-xs uppercase text-muted-foreground">Actual response</p>
                            <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">
                              {result.actualResponse}
                            </p>
                          </div>
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
