import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  History,
  Loader2,
  Play,
  Settings,
  Sparkles,
  TestTube2,
  X,
  XCircle,
} from "lucide-react";
import { api } from "../lib/api";
import {
  testRunKeys,
  testSuiteKeys,
  useTestRuns,
  useTestSuite,
  useTestSuiteRunAnalytics,
  useApplyAnalysisToAgent,
  useStartExperimentWithPrompt,
} from "../lib/api/test-suites.hooks";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import {
  PassRateChart,
  PromptAnalysisPanel,
  TestRunCard,
  TestRunDetailPanel,
  TestSuiteDetailPanel,
  TestPromptDialog,
} from "@/components/test-suites";

type NotificationType = "success" | "error" | "info";
type SuiteTab = "health" | "runs" | "analysis";

interface NotificationMessage {
  type: NotificationType;
  message: string;
}

interface AgentTestSuiteDetailProps {
  suiteId: string;
  agentId: string;
  onBack: () => void;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const notificationStyles: Record<NotificationType, string> = {
  success: "bg-green-500/15 text-green-800 dark:text-green-300 border border-green-500/30",
  error: "bg-red-500/15 text-red-800 dark:text-red-300 border border-red-500/30",
  info: "bg-blue-500/15 text-blue-800 dark:text-blue-300 border border-blue-500/30",
};

export function AgentTestSuiteDetail({ suiteId, agentId, onBack }: AgentTestSuiteDetailProps) {
  const queryClient = useQueryClient();
  const { data: suite, isLoading: suiteLoading, error: suiteError } = useTestSuite(suiteId);

  const [activeTab, setActiveTab] = useState<SuiteTab>("health");
  const [notification, setNotification] = useState<NotificationMessage | null>(null);
  const [runDetailId, setRunDetailId] = useState<string | null>(null);
  const [suitePanelOpen, setSuitePanelOpen] = useState(false);
  const [pollingSuiteId, setPollingSuiteId] = useState<string | null>(null);
  const [testPromptDialogOpen, setTestPromptDialogOpen] = useState(false);

  // Fetch agent to get current system prompt for A/B testing
  const { data: agent } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => api.getAgent(agentId),
    enabled: !!agentId,
  });

  const runListParams = useMemo(() => ({ limit: 10, offset: 0 }), []);
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

  const startRunMutation = useMutation({
    mutationFn: (targetSuiteId: string) => api.startTestRun(targetSuiteId),
    onSuccess: (_response, targetSuiteId) => {
      queryClient.invalidateQueries({ queryKey: testRunKeys.list(targetSuiteId, runListParams) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(targetSuiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.analytics(targetSuiteId) });
    },
  });

  const latestRunStatus = runsData?.runs?.[0]?.status;
  const lastRunStatusRef = useRef<string | null>(null);

  // Detect when a running test completes
  useEffect(() => {
    if (!latestRunStatus || latestRunStatus === lastRunStatusRef.current) return;
    lastRunStatusRef.current = latestRunStatus;
    queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(suiteId) });
  }, [suiteId, latestRunStatus, queryClient]);

  // Handle polling for active runs or experiments
  // Keep polling if any run is pending/running, OR if there's an experiment with only a baseline
  // (candidate run will be created after baseline completes)
  useEffect(() => {
    const runs = runsData?.runs ?? [];
    const hasActiveRun = runs.some(
      (run) => run.status === "pending" || run.status === "running"
    );
    // Check if there's a completed baseline without a matching candidate yet
    // This happens when the baseline just finished and candidate is about to start
    const hasIncompleteExperiment = runs.some((run) => {
      if (!run.experimentId || run.promptVariant !== "baseline") return false;
      // Check if there's a candidate for this experiment
      const hasCandidate = runs.some(
        (r) => r.experimentId === run.experimentId && r.promptVariant === "candidate"
      );
      return !hasCandidate;
    });

    const shouldPoll = hasActiveRun || hasIncompleteExperiment;

    if (shouldPoll && !pollingSuiteId) {
      setPollingSuiteId(suiteId);
    } else if (!shouldPoll && pollingSuiteId) {
      setPollingSuiteId(null);
    }
  }, [runsData?.runs, suiteId, pollingSuiteId]);

  useEffect(() => {
    if (!pollingSuiteId) return;
    const interval = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: testRunKeys.list(pollingSuiteId, runListParams) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.analytics(pollingSuiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(pollingSuiteId) });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [pollingSuiteId, queryClient, runListParams]);

  // Clear notification after timeout
  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(
      () => setNotification(null),
      notification.type === "info" ? 6000 : 4000
    );
    return () => window.clearTimeout(timer);
  }, [notification]);

  const handleRunSuite = () => {
    if (!suite) return;
    startRunMutation.mutate(suite.id, {
      onSuccess: (response) => {
        const statusLabel = response.status === "queued" ? "queued" : "started";
        setPollingSuiteId(suite.id);
        setNotification({
          type: "success",
          message: response.message || `Run ${statusLabel} for "${suite.name}".`,
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

  const handleSuiteSaved = () => {
    if (!suite) return;
    setNotification({
      type: "success",
      message: `Saved changes to "${suite.name}".`,
    });
    queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(suiteId) });
  };

  const applyAnalysisMutation = useApplyAnalysisToAgent();
  const startExperimentMutation = useStartExperimentWithPrompt(suiteId);

  // Called from PromptAnalysisPanel -> PromptAnalysisDetailPanel
  // The signature includes runId (from analysis.runId)
  const handleApplyPromptFromAnalysis = (runId: string) => {
    applyAnalysisMutation.mutate(runId, {
      onSuccess: () => {
        setNotification({
          type: "success",
          message: "Suggested prompt applied to agent.",
        });
        queryClient.invalidateQueries({ queryKey: ["analyses", suiteId] });
      },
      onError: (error) => {
        setNotification({
          type: "error",
          message: getErrorMessage(error, "Failed to apply prompt."),
        });
      },
    });
  };

  const handleStartExperiment = (candidatePrompt: string) => {
    startExperimentMutation.mutate(candidatePrompt, {
      onSuccess: (response) => {
        setTestPromptDialogOpen(false);
        setPollingSuiteId(suiteId);
        setNotification({
          type: "success",
          message: response.message || "A/B experiment started. Running baseline and candidate tests...",
        });
      },
      onError: (error) => {
        setNotification({
          type: "error",
          message: getErrorMessage(error, "Failed to start A/B experiment."),
        });
      },
    });
  };

  const recentRuns = useMemo(() => runsData?.runs ?? [], [runsData]);

  const suiteErrorMessage = suiteError
    ? getErrorMessage(suiteError, "Failed to load test suite.")
    : null;
  const runsErrorMessage = runsError
    ? getErrorMessage(runsError, "Failed to load recent runs.")
    : null;
  const analyticsErrorMessage = analyticsError
    ? getErrorMessage(analyticsError, "Failed to load suite analytics.")
    : null;

  if (suiteLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="card" count={1} />
      </div>
    );
  }

  if (suiteErrorMessage || !suite) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Test Suites
        </Button>
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {suiteErrorMessage || "Test suite not found."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Notification Toast */}
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

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{suite.name}</h1>
            {suite.description && (
              <p className="text-sm text-muted-foreground mt-1">{suite.description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            className="gap-2"
            onClick={handleRunSuite}
            disabled={startRunMutation.isPending}
          >
            {startRunMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Run Suite
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setTestPromptDialogOpen(true)}
          >
            <TestTube2 className="w-4 h-4" />
            Test Prompt
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setSuitePanelOpen(true)}
          >
            <Settings className="w-4 h-4" />
            Manage Suite
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SuiteTab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="health" className="gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Health
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-2">
            <History className="w-4 h-4" />
            Runs
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-2">
            <Sparkles className="w-4 h-4" />
            Prompt Analysis
          </TabsTrigger>
        </TabsList>

        {/* Health Tab */}
        <TabsContent value="health" className="space-y-6 mt-0">
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
        </TabsContent>

        {/* Runs Tab */}
        <TabsContent value="runs" className="space-y-4 mt-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {recentRuns.length} run{recentRuns.length === 1 ? "" : "s"} in the last 30 days
            </p>
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
        </TabsContent>

        {/* Prompt Analysis Tab */}
        <TabsContent value="analysis" className="mt-0">
          <PromptAnalysisPanel suite={suite} onApplyPrompt={handleApplyPromptFromAnalysis} />
        </TabsContent>
      </Tabs>

      {/* Panels */}
      <TestSuiteDetailPanel
        suite={suite}
        agentId={agentId}
        open={suitePanelOpen}
        onOpenChange={setSuitePanelOpen}
        isCreateMode={false}
        onSuiteSaved={handleSuiteSaved}
      />

      <TestRunDetailPanel
        runId={runDetailId}
        open={!!runDetailId}
        onOpenChange={(open) => !open && setRunDetailId(null)}
      />

      <TestPromptDialog
        open={testPromptDialogOpen}
        onOpenChange={setTestPromptDialogOpen}
        currentAgentPrompt={agent?.systemPrompt ?? ""}
        onStartTest={handleStartExperiment}
        isLoading={startExperimentMutation.isPending}
      />
    </div>
  );
}
