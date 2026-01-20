import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, useTestSuiteAnalytics } from "../lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { MessageSquare, MessagesSquare, Clock, BarChart3 } from "lucide-react";
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
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:ring-primary"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:ring-primary"
            />
          </div>
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
        {analytics?.queriesByDay && analytics.queriesByDay.length > 0 ? (
          (() => {
            const maxCount = Math.max(...analytics.queriesByDay.map((d) => d.count));
            const yMax = Math.max(maxCount, 1);
            const yLabels = [yMax, Math.round(yMax * 0.75), Math.round(yMax * 0.5), Math.round(yMax * 0.25), 0];

            return (
              <div className="h-72">
                {/* Y-axis labels and chart area */}
                <div className="flex h-56">
                  {/* Y-axis */}
                  <div className="flex flex-col justify-between text-xs text-muted-foreground pr-2 py-1 w-8">
                    {yLabels.map((val, i) => (
                      <span key={i} className="text-right">{val}</span>
                    ))}
                  </div>
                  {/* Chart area with bars */}
                  <div className="flex-1 border-l border-b border-border relative">
                    {/* Grid lines */}
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                      {yLabels.map((_, i) => (
                        <div key={i} className="border-t border-border/50 w-full" />
                      ))}
                    </div>
                    {/* Bars container */}
                    <div className="absolute inset-0 flex items-end justify-around px-2 pb-1">
                      {analytics.queriesByDay.map((day, i) => {
                        const heightPercent = yMax > 0 ? (day.count / yMax) * 100 : 0;
                        return (
                          <div
                            key={i}
                            className="flex-1 flex justify-center max-w-[60px] h-full items-end"
                          >
                            <div
                              className="w-8 bg-primary rounded-t hover:bg-primary/80 transition-colors relative group cursor-pointer"
                              style={{ height: `${Math.max(heightPercent, 2)}%` }}
                            >
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 border border-border">
                                {day.count} queries
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {/* X-axis labels */}
                <div className="flex ml-8 mt-2 justify-around px-2">
                  {analytics.queriesByDay.map((day, i) => (
                    <div key={i} className="flex-1 max-w-[60px] text-center">
                      <span className="text-xs text-muted-foreground">
                        {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()
        ) : (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            No data available for this period
          </div>
        )}
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
        />
      </div>
    </div>
  );
}
