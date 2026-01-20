import {
  CheckCircle2,
  FlaskConical,
  ListChecks,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { StatCard, type IconColor } from "@/components/ui/stat-card";
import { AgentTestHealthTable, type AgentTestHealthRow } from "./AgentTestHealthTable";
import { PassRateLineChart } from "./PassRateLineChart";
import { RecentRegressionsTable, type RecentRegressionRow } from "./RecentRegressionsTable";
import type {
  TestSuiteAnalytics as ApiTestSuiteAnalytics,
  TestSuiteAnalyticsAgent as ApiTestSuiteAnalyticsAgent,
  TestSuiteAnalyticsRegression as ApiTestSuiteAnalyticsRegression,
  TestSuiteAnalyticsSummary as ApiTestSuiteAnalyticsSummary,
} from "@/lib/api";

export type TestSuiteAnalyticsSummary = ApiTestSuiteAnalyticsSummary;
export type TestSuiteAnalyticsAgent = ApiTestSuiteAnalyticsAgent;
export type TestSuiteAnalyticsRegression = ApiTestSuiteAnalyticsRegression;
export type TestSuiteAnalyticsResponse = ApiTestSuiteAnalytics;

interface TestSuiteAnalyticsSectionProps {
  data?: TestSuiteAnalyticsResponse | null;
  isLoading?: boolean;
  onSelectAgent?: (agentId: string) => void;
  onSelectRegression?: (regression: RecentRegressionRow) => void;
  className?: string;
}

const clampPassRate = (value: number) => Math.max(0, Math.min(100, value));

export const formatOverallPassRate = (value: number) => `${Math.round(clampPassRate(value))}%`;

export const getOverallPassRateColor = (value: number, hasRuns: boolean): IconColor => {
  if (!hasRuns) {
    return "muted";
  }

  if (value >= 80) {
    return "green";
  }

  if (value >= 60) {
    return "warning";
  }

  return "destructive";
};

export const isTestSuiteAnalyticsEmpty = (data?: TestSuiteAnalyticsResponse | null) =>
  !data || data.summary.totalSuites === 0;

export const toAgentTestHealthRows = (agents: TestSuiteAnalyticsAgent[]): AgentTestHealthRow[] =>
  agents.map((agent) => ({
    agentId: agent.agentId,
    agentName: agent.agentName,
    suiteCount: agent.suiteCount,
    caseCount: agent.caseCount,
    passRate: Number.isFinite(agent.passRate) ? agent.passRate : null,
    passRateChange: agent.passRateChange ?? null,
    lastRunAt: agent.lastRunAt ?? null,
    lastRunStatus: agent.lastRunStatus ?? null,
  }));

export const toRecentRegressionRows = (
  regressions: TestSuiteAnalyticsRegression[]
): RecentRegressionRow[] =>
  regressions.map((regression) => ({
    runId: regression.runId,
    suiteId: regression.suiteId,
    suiteName: regression.suiteName,
    agentId: regression.agentId ?? "unknown-agent",
    agentName: regression.agentName,
    previousPassRate: regression.previousPassRate,
    currentPassRate: regression.currentPassRate,
    failedAt: regression.completedAt,
  }));

export function TestSuiteAnalyticsSection({
  data,
  isLoading = false,
  onSelectAgent,
  onSelectRegression,
  className,
}: TestSuiteAnalyticsSectionProps) {
  if (isLoading) {
    return <LoadingSkeleton variant="stats" count={4} className={className} />;
  }

  if (isTestSuiteAnalyticsEmpty(data)) {
    return (
      <div className={cn("rounded-lg border border-border bg-card", className)}>
        <EmptyState
          icon={FlaskConical}
          title="No test suites yet"
          description="Create test suites to track quality and regressions across your agents."
        />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const agentRows = toAgentTestHealthRows(data.agents);
  const regressionRows = toRecentRegressionRows(data.recentRegressions);
  const hasRuns = data.summary.totalRuns > 0;
  const overallPassRateLabel = hasRuns ? formatOverallPassRate(data.summary.overallPassRate) : "—";
  const overallPassRateColor = getOverallPassRateColor(data.summary.overallPassRate, hasRuns);
  const regressionCount = regressionRows.length;

  return (
    <div className={cn("space-y-6", className)}>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Test Suites" value={data.summary.totalSuites} icon={FlaskConical} iconColor="purple" />
        <StatCard label="Test Cases" value={data.summary.totalCases} icon={ListChecks} iconColor="blue" />
        <StatCard
          label="Overall Pass Rate"
          value={overallPassRateLabel}
          icon={CheckCircle2}
          iconColor={overallPassRateColor}
          subtext={hasRuns ? `${data.summary.totalRuns} completed runs` : "No completed runs yet"}
        />
        <StatCard
          label="Regressions"
          value={regressionCount}
          icon={TrendingDown}
          iconColor={regressionCount > 0 ? "destructive" : "success"}
        />
      </div>

      <div className="bg-card rounded-lg border border-border p-5">
        <h3 className="text-lg font-semibold text-foreground mb-4">Test Pass Rate Over Time</h3>
        <PassRateLineChart data={data.passRateOverTime} emptyMessage="No completed runs yet" />
      </div>

      <div className="bg-card rounded-lg border border-border p-5">
        <h3 className="text-lg font-semibold text-foreground mb-4">Test Health by Agent</h3>
        <AgentTestHealthTable data={agentRows} onSelectAgent={onSelectAgent} />
      </div>

      <div className="bg-card rounded-lg border border-border p-5">
        <h3 className="text-lg font-semibold text-foreground mb-4">Recent Regressions</h3>
        <RecentRegressionsTable data={regressionRows} onSelectRun={onSelectRegression} />
      </div>
    </div>
  );
}
