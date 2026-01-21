import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Play,
  Plus,
  X,
  XCircle,
} from "lucide-react";
import { api, type TestSuite } from "../../../lib/api";
import {
  testRunKeys,
  testSuiteKeys,
  useDeleteTestSuite,
  useTestRuns,
  useTestSuiteRunAnalytics,
  useTestSuites,
} from "../../../lib/api/test-suites.hooks";
import { Button } from "../../ui/button";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { EmptyState } from "../../ui/empty-state";
import { LoadingSkeleton } from "../../ui/loading-skeleton";
import { StatCard } from "../../ui/stat-card";
import {
  PassRateChart,
  TestRunCard,
  TestRunDetailPanel,
  TestSuiteDetailPanel,
  TestSuiteList,
} from "../../test-suites";

type NotificationType = "success" | "error" | "info";

interface NotificationMessage {
  type: NotificationType;
  message: string;
}

interface TestSuitesTabProps {
  agentId: string;
  agentName?: string;
  showHeader?: boolean;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const notificationStyles: Record<NotificationType, string> = {
  success: "bg-green-500/15 text-green-800 dark:text-green-300 border border-green-500/30",
  error: "bg-red-500/15 text-red-800 dark:text-red-300 border border-red-500/30",
  info: "bg-blue-500/15 text-blue-800 dark:text-blue-300 border border-blue-500/30",
};

export function TestSuitesTab({ agentId, agentName, showHeader = true }: TestSuitesTabProps) {
  const queryClient = useQueryClient();
  const { data: suites, isLoading, error } = useTestSuites(agentId);
  const [selectedSuite, setSelectedSuite] = useState<TestSuite | null>(null);
  const [panelSuite, setPanelSuite] = useState<TestSuite | null>(null);
  const [suitePanelOpen, setSuitePanelOpen] = useState(false);
  const [suitePanelCreateMode, setSuitePanelCreateMode] = useState(false);
  const [suiteToDelete, setSuiteToDelete] = useState<TestSuite | null>(null);
  const [runDetailId, setRunDetailId] = useState<string | null>(null);
  const [notification, setNotification] = useState<NotificationMessage | null>(null);
  const [pollingSuiteId, setPollingSuiteId] = useState<string | null>(null);

  const runListParams = useMemo(() => ({ limit: 6, offset: 0 }), []);
  const suiteId = selectedSuite?.id ?? pollingSuiteId ?? "";
  const {
    data: runsData,
    isLoading: runsLoading,
    error: runsError,
  } = useTestRuns(suiteId, runListParams);
  const {
    data: analytics,
    isLoading: analyticsLoading,
    error: analyticsError,
  } = useTestSuiteRunAnalytics(suiteId, { days: 30 });

  const deleteSuiteMutation = useDeleteTestSuite(agentId);
  const startRunMutation = useMutation({
    mutationFn: (targetSuiteId: string) => api.startTestRun(targetSuiteId),
    onSuccess: (_response, targetSuiteId) => {
      queryClient.invalidateQueries({ queryKey: testRunKeys.list(targetSuiteId, runListParams) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(targetSuiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.analytics(targetSuiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.list(agentId) });
    },
  });

  const latestRunStatus = runsData?.runs?.[0]?.status;
  const lastRunStatusRef = useRef<string | null>(null);
  const activeSuiteId = useMemo(
    () => suites?.find((suite) => suite.lastRun?.status === "pending" || suite.lastRun?.status === "running")?.id ?? null,
    [suites]
  );

  useEffect(() => {
    if (!latestRunStatus || latestRunStatus === lastRunStatusRef.current) return;
    lastRunStatusRef.current = latestRunStatus;
    queryClient.invalidateQueries({ queryKey: testSuiteKeys.list(agentId) });
  }, [agentId, latestRunStatus, queryClient]);

  useEffect(() => {
    if (activeSuiteId && activeSuiteId !== pollingSuiteId) {
      setPollingSuiteId(activeSuiteId);
      return;
    }

    if (!activeSuiteId && pollingSuiteId) {
      setPollingSuiteId(null);
    }
  }, [activeSuiteId, pollingSuiteId]);

  useEffect(() => {
    if (!pollingSuiteId) return;
    const interval = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.list(agentId) });
      queryClient.invalidateQueries({ queryKey: testRunKeys.list(pollingSuiteId, runListParams) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.analytics(pollingSuiteId) });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [agentId, pollingSuiteId, queryClient, runListParams]);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), notification.type === "info" ? 6000 : 4000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    if (!suites || suites.length === 0) {
      setSelectedSuite(null);
      return;
    }

    if (!selectedSuite) {
      setSelectedSuite(suites[0]);
      return;
    }

    const stillExists = suites.find((suite) => suite.id === selectedSuite.id);
    if (!stillExists) {
      setSelectedSuite(suites[0]);
    }
  }, [suites, selectedSuite]);

  const recentRuns = useMemo(() => runsData?.runs ?? [], [runsData]);

  const openCreatePanel = () => {
    setPanelSuite(null);
    setSuitePanelCreateMode(true);
    setSuitePanelOpen(true);
  };

  const openSuitePanel = (suite: TestSuite, create = false) => {
    setPanelSuite(suite);
    setSuitePanelCreateMode(create);
    setSuitePanelOpen(true);
    setSelectedSuite(suite);
  };

  const handleDeleteSuite = () => {
    if (!suiteToDelete) return;

    deleteSuiteMutation.mutate(suiteToDelete.id, {
      onSuccess: () => {
        setNotification({ type: "success", message: `Deleted \"${suiteToDelete.name}\".` });
        setSuiteToDelete(null);
      },
      onError: (deleteError) => {
        setNotification({
          type: "error",
          message: getErrorMessage(deleteError, "Failed to delete the test suite."),
        });
      },
    });
  };

  const handleRunSuite = (suite: TestSuite) => {
    setSelectedSuite(suite);
    startRunMutation.mutate(suite.id, {
      onSuccess: (response) => {
        const statusLabel = response.status === "queued" ? "queued" : "started";
        setPollingSuiteId(suite.id);
        setNotification({
          type: "success",
          message: response.message || `Run ${statusLabel} for \"${suite.name}\".`,
        });
      },
      onError: (runError) => {
        setNotification({
          type: "error",
          message: getErrorMessage(runError, "Failed to start the test run."),
        });
      },
    });
  };

  const handleSuiteSaved = (suite: TestSuite, action: "created" | "updated") => {
    setNotification({
      type: "success",
      message: action === "created" ? `Created \"${suite.name}\".` : `Saved changes to \"${suite.name}\".`,
    });
    setSelectedSuite(suite);
  };

  const suitesErrorMessage = error
    ? getErrorMessage(error, "Failed to load test suites.")
    : null;
  const runsErrorMessage = runsError ? getErrorMessage(runsError, "Failed to load recent runs.") : null;
  const analyticsErrorMessage = analyticsError
    ? getErrorMessage(analyticsError, "Failed to load suite analytics.")
    : null;

  return (
    <div className="space-y-6">
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 transition-all ${notificationStyles[notification.type]}`}
        >
          {notification.type === "success" && <CheckCircle2 className="w-5 h-5" />}
          {notification.type === "error" && <XCircle className="w-5 h-5" />}
          {notification.type === "info" && <Loader2 className="w-5 h-5 animate-spin" />}
          <span className="text-sm font-medium">{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div
        className={`flex flex-wrap items-start gap-3 ${showHeader ? "justify-between" : "justify-end"}`}
      >
        {showHeader && (
          <div>
            <p className="text-sm font-medium">Test Suites</p>
            <p className="text-xs text-muted-foreground">
              {agentName ? `Track ${agentName} response quality over time.` : "Track response quality over time."}
            </p>
          </div>
        )}
        <Button size="sm" className="gap-2" onClick={openCreatePanel}>
          <Plus className="w-4 h-4" />
          Create Suite
        </Button>
      </div>

      {suitesErrorMessage && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {suitesErrorMessage}
          </div>
        </div>
      )}

      <TestSuiteList
        suites={suites}
        isLoading={isLoading}
        onOpen={(suite) => openSuitePanel(suite)}
        onEdit={(suite) => openSuitePanel(suite)}
        onRun={handleRunSuite}
        onDelete={setSuiteToDelete}
        emptyStateAction={{ label: "Create suite", onClick: openCreatePanel }}
      />

      {selectedSuite && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Suite Health</p>
              <p className="text-xs text-muted-foreground">{selectedSuite.name}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => openSuitePanel(selectedSuite)}
            >
              <FlaskConical className="w-4 h-4" />
              Manage Suite
            </Button>
          </div>

          {analyticsErrorMessage && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {analyticsErrorMessage}
              </div>
            </div>
          )}

          {analyticsLoading ? (
            <LoadingSkeleton variant="stats" count={3} />
          ) : analytics ? (
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                label="Average pass rate"
                value={`${Math.round(analytics.averagePassRate)}%`}
                icon={CheckCircle2}
                iconColor="success"
              />
              <StatCard label="Total runs" value={analytics.totalRuns} icon={Play} iconColor="blue" />
              <StatCard
                label="Regressions"
                value={analytics.regressions}
                icon={AlertTriangle}
                iconColor="warning"
              />
            </div>
          ) : (
            <EmptyState
              icon={FlaskConical}
              title="No analytics yet"
              description="Run the suite to generate pass rate trends."
            />
          )}

          <div className="rounded-lg border border-border bg-card p-4">
            <PassRateChart runs={analytics?.runs ?? []} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Recent Runs</p>
              <p className="text-xs text-muted-foreground">
                {recentRuns.length} run{recentRuns.length === 1 ? "" : "s"} in the last 30 days.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => handleRunSuite(selectedSuite)}
              disabled={startRunMutation.isPending}
            >
              {startRunMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Run suite
            </Button>
          </div>

          {runsErrorMessage && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {runsErrorMessage}
              </div>
            </div>
          )}

          {runsLoading ? (
            <LoadingSkeleton variant="card" count={3} />
          ) : recentRuns.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
              title="No runs yet"
              description="Run the suite to see test outcomes."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {recentRuns.map((run) => (
                <TestRunCard key={run.id} run={run} onOpen={(selected) => setRunDetailId(selected.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      <TestSuiteDetailPanel
        suite={panelSuite}
        agentId={agentId}
        open={suitePanelOpen}
        onOpenChange={setSuitePanelOpen}
        isCreateMode={suitePanelCreateMode}
        onSuiteSaved={handleSuiteSaved}
      />

      <TestRunDetailPanel runId={runDetailId} open={!!runDetailId} onOpenChange={(open) => !open && setRunDetailId(null)} />

      <ConfirmDialog
        open={!!suiteToDelete}
        onOpenChange={(open) => {
          if (!open) setSuiteToDelete(null);
        }}
        title="Delete test suite"
        description={`Delete \"${suiteToDelete?.name}\"? This removes all test cases and run history.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDeleteSuite}
        isLoading={deleteSuiteMutation.isPending}
      />
    </div>
  );
}
