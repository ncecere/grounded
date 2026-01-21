# Phase 1: Database Schema

## Overview

Define the database tables for agent test suites, test cases, test runs, and test results.

## Tables

### 1. `agent_test_suites`

Main entity for a collection of test cases belonging to an agent.

```typescript
{
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid().notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentId: uuid().notNull().references(() => agents.id, { onDelete: "cascade" }),
  name: text().notNull(),
  description: text(),
  
  // Scheduling
  scheduleType: text().$type<"manual" | "hourly" | "daily" | "weekly">().default("manual").notNull(),
  scheduleTime: text(), // HH:MM format for daily/weekly
  scheduleDayOfWeek: integer(), // 0-6 for weekly (0 = Sunday)
  
  // LLM Judge configuration
  llmJudgeModelConfigId: uuid().references(() => modelConfigurations.id, { onDelete: "set null" }),
  
  // Alert settings
  alertOnRegression: boolean().default(true).notNull(),
  alertThresholdPercent: integer().default(10).notNull(), // Alert if pass rate drops by this %
  
  isEnabled: boolean().default(true).notNull(),
  createdBy: uuid().notNull().references(() => users.id),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp({ withTimezone: true }),
}
```

**Indexes:**
- `agent_test_suites_tenant_idx` on `tenantId`
- `agent_test_suites_agent_idx` on `agentId`
- Unique constraint on `(agentId, name)` where `deletedAt IS NULL`

### 2. `test_cases`

Individual Q&A test cases within a suite.

```typescript
{
  id: uuid().primaryKey().defaultRandom(),
  suiteId: uuid().notNull().references(() => agentTestSuites.id, { onDelete: "cascade" }),
  // Denormalized for RLS and tenant-scoped queries
  tenantId: uuid().notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text().notNull(),
  description: text(),
  
  // The question to ask the agent
  question: text().notNull(),
  
  // Expected behavior (JSONB)
  expectedBehavior: jsonb().$type<ExpectedBehavior>().notNull(),
  
  // Ordering within suite
  sortOrder: integer().default(0).notNull(),
  
  isEnabled: boolean().default(true).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp({ withTimezone: true }),
}
```

**ExpectedBehavior Type:**
```typescript
type ExpectedBehavior = {
  checks: Array<
    | { type: "contains_phrases"; phrases: string[]; caseSensitive?: boolean }
    | { type: "semantic_similarity"; expectedAnswer: string; threshold: number }
    | { type: "llm_judge"; expectedAnswer: string; criteria?: string }
  >;
  mode: "all" | "any"; // All checks must pass, or any check can pass
};
```

**Indexes:**
- `test_cases_suite_idx` on `suiteId`
- `test_cases_tenant_idx` on `tenantId`

### 3. `test_suite_runs`

Records of test suite executions.

```typescript
{
  id: uuid().primaryKey().defaultRandom(),
  suiteId: uuid().notNull().references(() => agentTestSuites.id, { onDelete: "cascade" }),
  // Denormalized for RLS and tenant-scoped queries
  tenantId: uuid().notNull().references(() => tenants.id, { onDelete: "cascade" }),
  
  // Run metadata
  status: text().$type<"pending" | "running" | "completed" | "failed" | "cancelled">().default("pending").notNull(),
  triggeredBy: text().$type<"manual" | "schedule">().notNull(),
  triggeredByUserId: uuid().references(() => users.id), // null if triggered by schedule
  
  // Results summary
  totalCases: integer().default(0).notNull(),
  passedCases: integer().default(0).notNull(),
  failedCases: integer().default(0).notNull(),
  skippedCases: integer().default(0).notNull(),
  
  // Timing
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  
  // Error info if run failed
  errorMessage: text(),
  
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}
```

**Indexes:**
- `test_suite_runs_suite_idx` on `suiteId`
- `test_suite_runs_tenant_idx` on `tenantId`
- `test_suite_runs_status_idx` on `status`
- `test_suite_runs_created_at_idx` on `createdAt`

### 4. `test_case_results`

Individual test case results within a run.

```typescript
{
  id: uuid().primaryKey().defaultRandom(),
  runId: uuid().notNull().references(() => testSuiteRuns.id, { onDelete: "cascade" }),
  testCaseId: uuid().notNull().references(() => testCases.id, { onDelete: "cascade" }),
  // Denormalized for RLS and tenant-scoped queries
  tenantId: uuid().notNull().references(() => tenants.id, { onDelete: "cascade" }),
  
  // Result
  status: text().$type<"passed" | "failed" | "skipped" | "error">().notNull(),
  
  // What the agent actually said
  actualResponse: text(),
  
  // Detailed check results (JSONB)
  checkResults: jsonb().$type<CheckResult[]>(),
  
  // Timing
  durationMs: integer(),
  
  // Error info if test errored
  errorMessage: text(),
  
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}
```

**CheckResult Type:**
```typescript
type CheckResult = {
  checkIndex: number;
  checkType: "contains_phrases" | "semantic_similarity" | "llm_judge";
  passed: boolean;
  details: {
    // For contains_phrases
    matchedPhrases?: string[];
    missingPhrases?: string[];
    // For semantic_similarity
    similarityScore?: number;
    threshold?: number;
    // For llm_judge
    judgement?: string;
    reasoning?: string;
  };
};
```

**Indexes:**
- `test_case_results_run_idx` on `runId`
- `test_case_results_test_case_idx` on `testCaseId`
- `test_case_results_tenant_idx` on `tenantId`

## File Location

Create schema in: `packages/db/src/schema/test-suites.ts`

Export from: `packages/db/src/schema/index.ts`

## Migration

After creating the schema:
```bash
bun run db:generate
bun run db:migrate
```

## RLS Considerations

All tables should include `tenantId` for direct RLS policies and tenant-scoped queries. RLS policies should:
- Allow tenants to manage their own test suites
- Allow reading test cases, runs, and results by `tenantId`
- Enforce `tenantId` consistency with the parent suite on insert/update

## Data Retention and Size

`actualResponse` and `checkResults` can grow quickly for large suites or long responses. Define a retention policy early:
- Retain runs from the last 30 days and ensure at least the most recent 30 runs per suite are kept (whichever is larger)
- Consider truncating `actualResponse` beyond a max length (e.g., 20k chars)
- Add a nightly cleanup job to enforce retention, scheduled at a configurable time (Admin UI setting with env fallback)

Settings (system settings keys with env fallback):
- `test_suites.retention_cleanup_time` (default `02:00`, env `TEST_SUITES_RETENTION_CLEANUP_TIME`)
- `test_suites.retention_days` (default `30`, env `TEST_SUITES_RETENTION_DAYS`)
- `test_suites.retention_runs` (default `30`, env `TEST_SUITES_RETENTION_RUNS`)
