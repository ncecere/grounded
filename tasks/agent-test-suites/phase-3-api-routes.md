# Phase 3: API Routes

## Overview

REST endpoints for managing test suites, test cases, runs, and importing test cases.

## File Location

`apps/api/src/routes/test-suites.ts`

## Endpoints

### Test Suites

#### `GET /api/v1/agents/:agentId/test-suites`

List all test suites for an agent.

```typescript
// Response
{
  suites: Array<{
    id: string;
    name: string;
    description: string | null;
    scheduleType: "manual" | "hourly" | "daily" | "weekly";
    isEnabled: boolean;
    testCaseCount: number;
    lastRun: {
      id: string;
      status: string;
      passRate: number;
      completedAt: string;
    } | null;
    createdAt: string;
  }>;
}
```

#### `POST /api/v1/agents/:agentId/test-suites`

Create a new test suite.

```typescript
// Request
{
  name: string;
  description?: string;
  scheduleType?: "manual" | "hourly" | "daily" | "weekly";
  scheduleTime?: string; // HH:MM
  scheduleDayOfWeek?: number; // 0-6
  llmJudgeModelConfigId?: string;
  alertOnRegression?: boolean;
  alertThresholdPercent?: number;
}

// Response
{
  id: string;
  name: string;
  // ... full suite object
}
```

#### `GET /api/v1/test-suites/:suiteId`

Get a single test suite with details.

```typescript
// Response
{
  id: string;
  name: string;
  description: string | null;
  agentId: string;
  agentName: string;
  scheduleType: string;
  scheduleTime: string | null;
  scheduleDayOfWeek: number | null;
  llmJudgeModelConfigId: string | null;
  alertOnRegression: boolean;
  alertThresholdPercent: number;
  isEnabled: boolean;
  testCaseCount: number;
  createdAt: string;
  updatedAt: string;
}
```

#### `PATCH /api/v1/test-suites/:suiteId`

Update a test suite.

```typescript
// Request (all fields optional)
{
  name?: string;
  description?: string;
  scheduleType?: "manual" | "hourly" | "daily" | "weekly";
  scheduleTime?: string;
  scheduleDayOfWeek?: number;
  llmJudgeModelConfigId?: string | null;
  alertOnRegression?: boolean;
  alertThresholdPercent?: number;
  isEnabled?: boolean;
}
```

#### `DELETE /api/v1/test-suites/:suiteId`

Soft delete a test suite.

### Test Cases

#### `GET /api/v1/test-suites/:suiteId/cases`

List all test cases in a suite.

```typescript
// Response
{
  cases: Array<{
    id: string;
    name: string;
    description: string | null;
    question: string;
    expectedBehavior: ExpectedBehavior;
    sortOrder: number;
    isEnabled: boolean;
    lastResult: {
      status: "passed" | "failed" | "skipped" | "error";
      runId: string;
      createdAt: string;
    } | null;
  }>;
}
```

#### `POST /api/v1/test-suites/:suiteId/cases`

Create a new test case.

```typescript
// Request
{
  name: string;
  description?: string;
  question: string;
  expectedBehavior: ExpectedBehavior;
  sortOrder?: number;
}
```

#### `GET /api/v1/test-cases/:caseId`

Get a single test case.

#### `PATCH /api/v1/test-cases/:caseId`

Update a test case.

#### `DELETE /api/v1/test-cases/:caseId`

Soft delete a test case.

#### `POST /api/v1/test-suites/:suiteId/cases/reorder`

Reorder test cases.

```typescript
// Request
{
  caseIds: string[]; // Ordered list of case IDs
}
```

### Import/Export

#### `POST /api/v1/test-suites/:suiteId/import`

Import test cases from JSONL file.

```typescript
// Request: multipart/form-data with "file" field
// File format: JSONL where each line is:
// {"name": "...", "question": "...", "expectedBehavior": {...}}

// Response
{
  imported: number;
  skipped: number;
  errors: Array<{ line: number; error: string }>;
}
```

#### `GET /api/v1/test-suites/:suiteId/export`

Export test cases as JSONL.

```typescript
// Response: application/jsonl file download
```

### Test Runs

#### `GET /api/v1/test-suites/:suiteId/runs`

List runs for a suite.

```typescript
// Query params
?limit=20&offset=0

// Response
{
  runs: Array<{
    id: string;
    status: string;
    triggeredBy: "manual" | "schedule";
    totalCases: number;
    passedCases: number;
    failedCases: number;
    skippedCases: number;
    passRate: number; // Calculated: passed / (total - skipped)
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
  }>;
  total: number;
}
```

#### `POST /api/v1/test-suites/:suiteId/runs`

Start a new test run.

```typescript
// Response
{
  id: string;
  status: "started" | "queued";
  message: string;
}
```

#### `GET /api/v1/test-runs/:runId`

Get run details with results.

```typescript
// Response
{
  id: string;
  suiteId: string;
  suiteName: string;
  status: string;
  triggeredBy: string;
  triggeredByUser: { id: string; name: string } | null;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  skippedCases: number;
  passRate: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  results: Array<{
    id: string;
    testCaseId: string;
    testCaseName: string;
    question: string;
    status: "passed" | "failed" | "skipped" | "error";
    actualResponse: string | null;
    checkResults: CheckResult[];
    durationMs: number | null;
    errorMessage: string | null;
  }>;
}
```

#### `DELETE /api/v1/test-runs/:runId`

Cancel a running test (if still in progress) or delete a completed run.

## Run Status and Pass Rate Semantics

Use a consistent lifecycle across API and UI:

- `pending`: run is queued (created but not started)
- `running`: run is actively executing cases
- `completed`: run finished normally
- `failed`: run aborted due to system-level failure
- `cancelled`: run was cancelled by user/admin

`POST /test-suites/:suiteId/runs` returns `status: "started"` when it can transition immediately to `running`, and `status: "queued"` when another run is already in progress.

Pass rate should be computed as:

```
passRate = passedCases / max(totalCases - skippedCases, 1)
```

Treat `error` cases as failed in counts. If all cases are skipped, return `100` to avoid divide-by-zero.

## Result Payload Size

`GET /test-runs/:runId` can return large payloads for large suites. If this becomes an issue, add a query flag such as `?includeResults=false` or implement pagination for results.

### Per-Suite Analytics

#### `GET /api/v1/test-suites/:suiteId/analytics`

Get pass rate trends over time for a specific suite.

```typescript
// Query params
?days=30

// Response
{
  runs: Array<{
    date: string;
    passRate: number;
    totalRuns: number;
  }>;
  averagePassRate: number;
  totalRuns: number;
  regressions: number; // Count of runs where pass rate dropped
}
```

### Tenant-Wide Analytics (for Workspace Analytics page)

See `phase-8-workspace-analytics.md` for full details.

#### `GET /api/v1/analytics/test-suites`

Aggregate test suite analytics for the entire tenant. Added to existing analytics routes.

```typescript
// Query params
?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD

// Response
{
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
```

## Route Registration

In `apps/api/src/routes/index.ts`:

```typescript
import { testSuitesRoutes } from "./test-suites";

// Add to router
app.route("/api/v1", testSuitesRoutes);
```

## Authentication & Authorization

All endpoints require:
- Valid session (authenticated user)
- User must be member of the tenant that owns the agent
- Suite/case/run must belong to an agent in user's tenant

## Validation

Use Zod schemas for request validation:

```typescript
const createSuiteSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  scheduleType: z.enum(["manual", "hourly", "daily", "weekly"]).optional(),
  scheduleTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  scheduleDayOfWeek: z.number().min(0).max(6).optional(),
  llmJudgeModelConfigId: z.string().uuid().optional(),
  alertOnRegression: z.boolean().optional(),
  alertThresholdPercent: z.number().min(1).max(100).optional(),
});

const expectedBehaviorSchema = z.object({
  checks: z.array(z.discriminatedUnion("type", [
    z.object({
      type: z.literal("contains_phrases"),
      phrases: z.array(z.string()).min(1),
      caseSensitive: z.boolean().optional(),
    }),
    z.object({
      type: z.literal("semantic_similarity"),
      expectedAnswer: z.string().min(1),
      threshold: z.number().min(0).max(1),
    }),
    z.object({
      type: z.literal("llm_judge"),
      expectedAnswer: z.string().min(1),
      criteria: z.string().optional(),
    }),
  ])).min(1),
  mode: z.enum(["all", "any"]),
});
```
