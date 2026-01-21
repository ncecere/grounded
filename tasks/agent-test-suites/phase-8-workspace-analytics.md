# Phase 8: Workspace Analytics Integration

## Overview

Add test suite analytics to the tenant workspace Analytics page, allowing users to monitor agent testing health across all their agents in one place.

## Goals

1. Show aggregate test suite metrics on the Analytics page
2. Per-agent test health breakdown
3. Pass rate trends over time
4. Quick access to failing tests and regressions

## Analytics Calculations

Use consistent formulas across analytics endpoints:

- Include only `completed` runs in pass rate and trend calculations
- Pass rate formula: `passedCases / max(totalCases - skippedCases, 1)`
- Treat `error` cases as failed in counts
- Date grouping should use `completedAt` (fallback to `createdAt` if missing) and UTC for now
- `passRateTrend` compares the last completed run vs the previous completed run for each agent
- `lastRunStatus` should reflect the most recent run regardless of status, even if still `running`

## API Endpoints

### Add to `apps/api/src/routes/analytics.ts`

#### `GET /api/v1/analytics/test-suites`

Aggregate test suite analytics for the tenant.

```typescript
// Query params
?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD

// Response
{
  summary: {
    totalSuites: number;
    totalTestCases: number;
    totalRuns: number;
    overallPassRate: number; // Average across all runs
    regressionCount: number; // Runs where pass rate dropped
    lastRunAt: string | null;
  };
  
  byAgent: Array<{
    agentId: string;
    agentName: string;
    suiteCount: number;
    testCaseCount: number;
    runCount: number;
    passRate: number; // Latest run pass rate
    passRateTrend: "up" | "down" | "stable"; // Compared to previous run
    lastRunAt: string | null;
    lastRunStatus: "passed" | "failed" | "running" | null;
  }>;
  
  recentRegressions: Array<{
    runId: string;
    suiteId: string;
    suiteName: string;
    agentId: string;
    agentName: string;
    previousPassRate: number;
    currentPassRate: number;
    failedAt: string;
  }>;
  
  passRateOverTime: Array<{
    date: string;
    passRate: number;
    totalRuns: number;
  }>;
}
```

### Add to `apps/api/src/routes/admin/analytics.ts`

#### `GET /api/v1/admin/analytics/test-suites`

System-wide test suite analytics (for admin dashboard).

```typescript
// Response
{
  systemSummary: {
    totalSuites: number;
    totalTestCases: number;
    totalRuns: number;
    overallPassRate: number;
    activeScheduledSuites: number;
  };
  
  byTenant: Array<{
    tenantId: string;
    tenantName: string;
    suiteCount: number;
    testCaseCount: number;
    passRate: number;
    lastRunAt: string | null;
  }>;
}
```

## Frontend Components

### 1. TestSuiteAnalyticsSection

Add to the Analytics page as a new section.

```tsx
// apps/web/src/components/analytics/TestSuiteAnalyticsSection.tsx

interface TestSuiteAnalyticsSectionProps {
  dateRange: { startDate: string; endDate: string };
}

export function TestSuiteAnalyticsSection({ dateRange }: TestSuiteAnalyticsSectionProps) {
  const { data, isLoading } = useTestSuiteAnalytics(dateRange);
  
  if (isLoading) return <LoadingSkeleton variant="stats" count={4} />;
  
  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Test Suites"
          value={data.summary.totalSuites}
          icon={FlaskConical}
          iconColor="purple"
        />
        <StatCard
          label="Test Cases"
          value={data.summary.totalTestCases}
          icon={ListChecks}
          iconColor="blue"
        />
        <StatCard
          label="Overall Pass Rate"
          value={`${data.summary.overallPassRate.toFixed(1)}%`}
          icon={CheckCircle}
          iconColor={data.summary.overallPassRate >= 80 ? "green" : "warning"}
        />
        <StatCard
          label="Regressions"
          value={data.summary.regressionCount}
          icon={TrendingDown}
          iconColor={data.summary.regressionCount > 0 ? "destructive" : "success"}
        />
      </div>
      
      {/* Pass Rate Over Time Chart */}
      <div className="bg-card rounded-lg border border-border p-5">
        <h3 className="text-lg font-semibold mb-4">Test Pass Rate Over Time</h3>
        <PassRateLineChart data={data.passRateOverTime} />
      </div>
      
      {/* Per-Agent Breakdown */}
      <div className="bg-card rounded-lg border border-border p-5">
        <h3 className="text-lg font-semibold mb-4">Test Health by Agent</h3>
        <AgentTestHealthTable agents={data.byAgent} />
      </div>
      
      {/* Recent Regressions */}
      {data.recentRegressions.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-5">
          <h3 className="text-lg font-semibold mb-4 text-destructive">Recent Regressions</h3>
          <RecentRegressionsTable regressions={data.recentRegressions} />
        </div>
      )}
    </div>
  );
}
```

### 2. PassRateLineChart

Line chart showing pass rate trends.

```tsx
// apps/web/src/components/analytics/PassRateLineChart.tsx

interface PassRateLineChartProps {
  data: Array<{ date: string; passRate: number; totalRuns: number }>;
}

export function PassRateLineChart({ data }: PassRateLineChartProps) {
  // Similar structure to QueryChart but with:
  // - Y-axis: 0-100%
  // - Line instead of bars (or area chart)
  // - Green/yellow/red zones (100-80 green, 80-60 yellow, <60 red)
  // - Tooltip showing pass rate and run count
}
```

### 3. AgentTestHealthTable

Table showing per-agent test health.

```tsx
// apps/web/src/components/analytics/AgentTestHealthTable.tsx

interface AgentTestHealthTableProps {
  agents: Array<{
    agentId: string;
    agentName: string;
    suiteCount: number;
    testCaseCount: number;
    passRate: number;
    passRateTrend: "up" | "down" | "stable";
    lastRunAt: string | null;
    lastRunStatus: string | null;
  }>;
}

// Columns:
// - Agent name (link to agent)
// - Suites / Cases count
// - Pass Rate with trend indicator (arrow up/down/dash)
// - Last Run (time ago + status badge)
// - Actions: View Tests button
```

### 4. RecentRegressionsTable

Table showing recent test failures/regressions.

```tsx
// apps/web/src/components/analytics/RecentRegressionsTable.tsx

interface RecentRegressionsTableProps {
  regressions: Array<{
    runId: string;
    suiteId: string;
    suiteName: string;
    agentId: string;
    agentName: string;
    previousPassRate: number;
    currentPassRate: number;
    failedAt: string;
  }>;
}

// Columns:
// - Agent / Suite name
// - Pass Rate Change (e.g., "85% → 60%" with red styling)
// - When (relative time)
// - Action: View Run button
```

## Analytics Page Integration

Update `apps/web/src/pages/Analytics.tsx`:

```tsx
import { TestSuiteAnalyticsSection } from "@/components/analytics/TestSuiteAnalyticsSection";

export function Analytics() {
  // ... existing code ...
  
  return (
    <div className="p-6">
      <PageHeader ... />
      
      {/* Existing Query Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        {/* ... existing stat cards ... */}
      </div>
      
      {/* Existing Queries Over Time */}
      <div className="bg-card rounded-lg border border-border p-5 mb-6">
        {/* ... existing chart ... */}
      </div>
      
      {/* NEW: Test Suite Analytics Section */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Agent Test Health</h2>
        <TestSuiteAnalyticsSection dateRange={dateRange} />
      </div>
    </div>
  );
}
```

## Alternative: Tabbed Layout

If the page gets too long, use tabs:

```tsx
<Tabs defaultValue="usage">
  <TabsList>
    <TabsTrigger value="usage">Usage Analytics</TabsTrigger>
    <TabsTrigger value="testing">Test Analytics</TabsTrigger>
  </TabsList>
  
  <TabsContent value="usage">
    {/* Existing analytics */}
  </TabsContent>
  
  <TabsContent value="testing">
    <TestSuiteAnalyticsSection dateRange={dateRange} />
  </TabsContent>
</Tabs>
```

## API Client Additions

Add to `apps/web/src/lib/api.ts`:

```typescript
// Types
export interface TestSuiteAnalytics {
  summary: {
    totalSuites: number;
    totalTestCases: number;
    totalRuns: number;
    overallPassRate: number;
    regressionCount: number;
    lastRunAt: string | null;
  };
  byAgent: Array<{
    agentId: string;
    agentName: string;
    suiteCount: number;
    testCaseCount: number;
    runCount: number;
    passRate: number;
    passRateTrend: "up" | "down" | "stable";
    lastRunAt: string | null;
    lastRunStatus: "passed" | "failed" | "running" | null;
  }>;
  recentRegressions: Array<{
    runId: string;
    suiteId: string;
    suiteName: string;
    agentId: string;
    agentName: string;
    previousPassRate: number;
    currentPassRate: number;
    failedAt: string;
  }>;
  passRateOverTime: Array<{
    date: string;
    passRate: number;
    totalRuns: number;
  }>;
}

// API Method
export async function getTestSuiteAnalytics(
  dateRange?: { startDate?: string; endDate?: string }
): Promise<TestSuiteAnalytics> {
  const params = new URLSearchParams();
  if (dateRange?.startDate) params.set("startDate", dateRange.startDate);
  if (dateRange?.endDate) params.set("endDate", dateRange.endDate);
  
  const res = await fetch(`${API_URL}/analytics/test-suites?${params}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}
```

## TanStack Query Hook

Add to `apps/web/src/hooks/use-test-suites.ts`:

```typescript
export function useTestSuiteAnalytics(dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ["test-suite-analytics", dateRange],
    queryFn: () => api.getTestSuiteAnalytics(dateRange),
  });
}
```

## Admin Analytics Integration

Optionally add test suite metrics to the Admin Analytics page:

1. Add "Test Suites" section to the Overview tab
2. Show per-tenant test health in the Tenants tab
3. Include test metrics in CSV exports

## Empty State

When no test suites exist yet:

```tsx
<div className="bg-card rounded-lg border border-border p-8 text-center">
  <FlaskConical className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
  <h3 className="text-lg font-semibold mb-2">No Test Suites Yet</h3>
  <p className="text-muted-foreground mb-4">
    Create test suites to monitor your agents' response quality over time.
  </p>
  <Button onClick={() => navigateToAgents()}>
    Go to Agents
  </Button>
</div>
```

## Chart Library

Use the existing chart patterns in the codebase, or consider:
- Recharts (if already installed)
- Custom SVG (like existing QueryChart)
- Chart.js

For consistency, follow the QueryChart pattern but adapt for line/area charts.
