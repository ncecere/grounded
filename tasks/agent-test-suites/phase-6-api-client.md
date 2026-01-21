# Phase 6: API Client

## Overview

Frontend API methods and TypeScript types for interacting with test suite endpoints.

## File Location

Add to existing `apps/web/src/lib/api.ts`

## TypeScript Types

Add to `apps/web/src/lib/api.ts` or create `apps/web/src/types/test-suites.ts`:

```typescript
// Expected behavior types
export interface ContainsPhrasesCheck {
  type: "contains_phrases";
  phrases: string[];
  caseSensitive?: boolean;
}

export interface SemanticSimilarityCheck {
  type: "semantic_similarity";
  expectedAnswer: string;
  threshold: number;
}

export interface LlmJudgeCheck {
  type: "llm_judge";
  expectedAnswer: string;
  criteria?: string;
}

export type ExpectedCheck = ContainsPhrasesCheck | SemanticSimilarityCheck | LlmJudgeCheck;

export interface ExpectedBehavior {
  checks: ExpectedCheck[];
  mode: "all" | "any";
}

export interface CheckResult {
  checkIndex: number;
  checkType: "contains_phrases" | "semantic_similarity" | "llm_judge";
  passed: boolean;
  details: {
    matchedPhrases?: string[];
    missingPhrases?: string[];
    similarityScore?: number;
    threshold?: number;
    judgement?: string;
    reasoning?: string;
  };
}

// Test Suite
export interface TestSuite {
  id: string;
  agentId: string;
  name: string;
  description: string | null;
  scheduleType: "manual" | "hourly" | "daily" | "weekly";
  scheduleTime: string | null;
  scheduleDayOfWeek: number | null;
  llmJudgeModelConfigId: string | null;
  alertOnRegression: boolean;
  alertThresholdPercent: number;
  isEnabled: boolean;
  testCaseCount: number;
  lastRun: TestSuiteRunSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestSuiteRunSummary {
  id: string;
  status: string;
  passRate: number;
  completedAt: string | null;
}

// Test Case
export interface TestCase {
  id: string;
  suiteId: string;
  name: string;
  description: string | null;
  question: string;
  expectedBehavior: ExpectedBehavior;
  sortOrder: number;
  isEnabled: boolean;
  lastResult: TestCaseResultSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestCaseResultSummary {
  status: "passed" | "failed" | "skipped" | "error";
  runId: string;
  createdAt: string;
}

// Test Run
export interface TestSuiteRun {
  id: string;
  suiteId: string;
  suiteName: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  triggeredBy: "manual" | "schedule";
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
  createdAt: string;
}

export interface TestCaseResult {
  id: string;
  testCaseId: string;
  testCaseName: string;
  question: string;
  status: "passed" | "failed" | "skipped" | "error";
  actualResponse: string | null;
  checkResults: CheckResult[];
  durationMs: number | null;
  errorMessage: string | null;
}

export interface TestRunWithResults extends TestSuiteRun {
  results: TestCaseResult[];
}

// Analytics
export interface TestSuiteAnalytics {
  runs: Array<{
    date: string;
    passRate: number;
    totalRuns: number;
  }>;
  averagePassRate: number;
  totalRuns: number;
  regressions: number;
}

// Create/Update DTOs
export interface CreateTestSuiteDto {
  name: string;
  description?: string;
  scheduleType?: "manual" | "hourly" | "daily" | "weekly";
  scheduleTime?: string;
  scheduleDayOfWeek?: number;
  llmJudgeModelConfigId?: string;
  alertOnRegression?: boolean;
  alertThresholdPercent?: number;
}

export interface UpdateTestSuiteDto extends Partial<CreateTestSuiteDto> {
  isEnabled?: boolean;
}

export interface CreateTestCaseDto {
  name: string;
  description?: string;
  question: string;
  expectedBehavior: ExpectedBehavior;
  sortOrder?: number;
}

export interface UpdateTestCaseDto extends Partial<CreateTestCaseDto> {
  isEnabled?: boolean;
}
```

## API Methods

```typescript
// ============================================================================
// Test Suites
// ============================================================================

export async function getTestSuites(agentId: string): Promise<TestSuite[]> {
  const res = await fetch(`${API_URL}/agents/${agentId}/test-suites`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  const data = await res.json();
  return data.suites;
}

export async function getTestSuite(suiteId: string): Promise<TestSuite> {
  const res = await fetch(`${API_URL}/test-suites/${suiteId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function createTestSuite(
  agentId: string,
  data: CreateTestSuiteDto
): Promise<TestSuite> {
  const res = await fetch(`${API_URL}/agents/${agentId}/test-suites`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function updateTestSuite(
  suiteId: string,
  data: UpdateTestSuiteDto
): Promise<TestSuite> {
  const res = await fetch(`${API_URL}/test-suites/${suiteId}`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function deleteTestSuite(suiteId: string): Promise<void> {
  const res = await fetch(`${API_URL}/test-suites/${suiteId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
}

// ============================================================================
// Test Cases
// ============================================================================

export async function getTestCases(suiteId: string): Promise<TestCase[]> {
  const res = await fetch(`${API_URL}/test-suites/${suiteId}/cases`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  const data = await res.json();
  return data.cases;
}

export async function getTestCase(caseId: string): Promise<TestCase> {
  const res = await fetch(`${API_URL}/test-cases/${caseId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function createTestCase(
  suiteId: string,
  data: CreateTestCaseDto
): Promise<TestCase> {
  const res = await fetch(`${API_URL}/test-suites/${suiteId}/cases`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function updateTestCase(
  caseId: string,
  data: UpdateTestCaseDto
): Promise<TestCase> {
  const res = await fetch(`${API_URL}/test-cases/${caseId}`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function deleteTestCase(caseId: string): Promise<void> {
  const res = await fetch(`${API_URL}/test-cases/${caseId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
}

export async function reorderTestCases(
  suiteId: string,
  caseIds: string[]
): Promise<void> {
  const res = await fetch(`${API_URL}/test-suites/${suiteId}/cases/reorder`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ caseIds }),
  });
  if (!res.ok) throw new ApiError(res);
}

// ============================================================================
// Import/Export
// ============================================================================

export async function importTestCases(
  suiteId: string,
  file: File
): Promise<{ imported: number; skipped: number; errors: Array<{ line: number; error: string }> }> {
  const formData = new FormData();
  formData.append("file", file);
  
  const res = await fetch(`${API_URL}/test-suites/${suiteId}/import`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(), // Don't include Content-Type for FormData
    },
    body: formData,
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function exportTestCases(suiteId: string): Promise<Blob> {
  const res = await fetch(`${API_URL}/test-suites/${suiteId}/export`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  return res.blob();
}

// ============================================================================
// Test Runs
// ============================================================================

export async function getTestRuns(
  suiteId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ runs: TestSuiteRun[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  
  const res = await fetch(`${API_URL}/test-suites/${suiteId}/runs?${params}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function startTestRun(
  suiteId: string
): Promise<{ id: string; status: "started" | "queued"; message: string }> {
  const res = await fetch(`${API_URL}/test-suites/${suiteId}/runs`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function getTestRun(runId: string): Promise<TestRunWithResults> {
  const res = await fetch(`${API_URL}/test-runs/${runId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

export async function cancelTestRun(runId: string): Promise<void> {
  const res = await fetch(`${API_URL}/test-runs/${runId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
}

// ============================================================================
// Per-Suite Analytics
// ============================================================================

export async function getTestSuiteAnalytics(
  suiteId: string,
  days: number = 30
): Promise<TestSuiteAnalytics> {
  const res = await fetch(`${API_URL}/test-suites/${suiteId}/analytics?days=${days}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new ApiError(res);
  return res.json();
}

// ============================================================================
// Tenant-Wide Test Analytics (for Workspace Analytics page)
// See phase-8-workspace-analytics.md for full details
// ============================================================================

export interface TenantTestSuiteAnalytics {
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

export async function getTenantTestSuiteAnalytics(
  dateRange?: { startDate?: string; endDate?: string }
): Promise<TenantTestSuiteAnalytics> {
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

## TanStack Query Hooks

Create `apps/web/src/hooks/use-test-suites.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";

export function useTestSuites(agentId: string) {
  return useQuery({
    queryKey: ["test-suites", agentId],
    queryFn: () => api.getTestSuites(agentId),
    enabled: !!agentId,
  });
}

export function useTestSuite(suiteId: string) {
  return useQuery({
    queryKey: ["test-suite", suiteId],
    queryFn: () => api.getTestSuite(suiteId),
    enabled: !!suiteId,
  });
}

export function useCreateTestSuite(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: api.CreateTestSuiteDto) => api.createTestSuite(agentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-suites", agentId] });
    },
  });
}

export function useUpdateTestSuite(suiteId: string, agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: api.UpdateTestSuiteDto) => api.updateTestSuite(suiteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-suite", suiteId] });
      queryClient.invalidateQueries({ queryKey: ["test-suites", agentId] });
    },
  });
}

export function useDeleteTestSuite(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suiteId: string) => api.deleteTestSuite(suiteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-suites", agentId] });
    },
  });
}

// Similar hooks for test cases and runs...
export function useTestCases(suiteId: string) {
  return useQuery({
    queryKey: ["test-cases", suiteId],
    queryFn: () => api.getTestCases(suiteId),
    enabled: !!suiteId,
  });
}

export function useTestRuns(suiteId: string, options?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ["test-runs", suiteId, options],
    queryFn: () => api.getTestRuns(suiteId, options),
    enabled: !!suiteId,
  });
}

export function useTestRun(runId: string) {
  return useQuery({
    queryKey: ["test-run", runId],
    queryFn: () => api.getTestRun(runId),
    enabled: !!runId,
    refetchInterval: (data) => {
      // Poll while run is in progress
      if (data?.status === "pending" || data?.status === "running") {
        return 2000;
      }
      return false;
    },
  });
}

export function useStartTestRun(suiteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.startTestRun(suiteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-runs", suiteId] });
      queryClient.invalidateQueries({ queryKey: ["test-suite", suiteId] });
    },
  });
}

export function useTestSuiteAnalytics(suiteId: string, days: number = 30) {
  return useQuery({
    queryKey: ["test-suite-analytics", suiteId, days],
    queryFn: () => api.getTestSuiteAnalytics(suiteId, days),
    enabled: !!suiteId,
  });
}

// Tenant-wide analytics for workspace Analytics page
// See phase-8-workspace-analytics.md for full details
export function useTenantTestSuiteAnalytics(dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ["tenant-test-suite-analytics", dateRange],
    queryFn: () => api.getTenantTestSuiteAnalytics(dateRange),
  });
}
```
