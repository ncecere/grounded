import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, useTestSuiteAnalytics } from "../lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { DateRangeInput } from "@/components/ui/date-range-input";
import { QueryChart } from "@/components/ui/query-chart";
import { MessageSquare, MessagesSquare, Clock, BarChart3 } from "lucide-react";
import { TestRunDetailPanel } from "@/components/test-suites";
import {
  TestSuiteAnalyticsSection,
} from "@/components/analytics/TestSuiteAnalyticsSection";

export const buildTestSuiteAnalyticsQuery = (range: {
  startDate?: string;
  endDate?: string;
}) => {
  const searchParams = new URLSearchParams();

  if (range.startDate) {
    searchParams.set("startDate", range.startDate);
  }

  if (range.endDate) {
    searchParams.set("endDate", range.endDate);
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
};

export function Analytics() {
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: analytics, isLoading } = useQuery({
    queryKey: ["analytics", dateRange],
    queryFn: () => api.getAnalytics(dateRange),
  });

  const { data: testSuiteAnalytics, isLoading: isTestSuiteAnalyticsLoading } =
    useTestSuiteAnalytics(dateRange);

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="stats" count={4} />
        <div className="mt-6">
          <LoadingSkeleton variant="card" count={1} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Analytics"
        description="Monitor usage and performance metrics"
        actions={
          <DateRangeInput dateRange={dateRange} onChange={setDateRange} />
        }
      />

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          label="Total Queries"
          value={analytics?.totalQueries ?? 0}
          icon={MessageSquare}
          iconColor="primary"
        />
        <StatCard
          label="Conversations"
          value={analytics?.totalConversations ?? 0}
          icon={MessagesSquare}
          iconColor="green"
        />
        <StatCard
          label="Avg Response Time"
          value={analytics?.avgResponseTime ? `${(analytics.avgResponseTime / 1000).toFixed(1)}s` : "N/A"}
          icon={Clock}
          iconColor="purple"
        />
        <StatCard
          label="Queries/Day"
          value={
            analytics?.queriesByDay?.length
              ? Math.round(
                  analytics.queriesByDay.reduce((sum, d) => sum + d.count, 0) /
                    analytics.queriesByDay.length
                )
              : 0
          }
          icon={BarChart3}
          iconColor="orange"
        />
      </div>

      {/* Queries Over Time */}
      <div className="bg-card rounded-lg border border-border p-5">
        <h3 className="text-lg font-semibold text-foreground mb-4">Queries Over Time</h3>
        <QueryChart
          data={analytics?.queriesByDay ?? []}
          maxDays={30}
          emptyMessage="No data available for this period"
        />
      </div>

      <div className="mt-10">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-foreground">Agent Test Health</h2>
          <p className="text-sm text-muted-foreground">
            Track test suite coverage, pass rates, and recent regressions across your agents.
          </p>
        </div>
        <TestSuiteAnalyticsSection
          data={testSuiteAnalytics}
          isLoading={isTestSuiteAnalyticsLoading}
          onSelectRegression={(regression) => setSelectedRunId(regression.runId)}
        />
      </div>

      <TestRunDetailPanel
        runId={selectedRunId}
        open={!!selectedRunId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRunId(null);
          }
        }}
      />
    </div>
  );
}
