import { API_BASE, request, getToken, getCurrentTenantId } from "./client";
import type {
  CreateTestCaseDto,
  CreateTestSuiteDto,
  Experiment,
  ExperimentComparison,
  PromptAnalysis,
  StartRunResponse,
  TestCase,
  TestRunWithResults,
  TestSuite,
  TestSuiteRun,
  TestSuiteRunAnalytics,
  UpdateTestCaseDto,
  UpdateTestSuiteDto,
} from "./types/test-suites";

export const testSuitesApi = {
  listTestSuites: async (agentId: string) => {
    const res = await request<{ testSuites: TestSuite[] }>(`/agents/${agentId}/test-suites`);
    return res.testSuites;
  },

  createTestSuite: async (agentId: string, data: CreateTestSuiteDto) => {
    const res = await request<{ testSuite: TestSuite }>(`/agents/${agentId}/test-suites`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.testSuite;
  },

  getTestSuite: async (suiteId: string) => {
    const res = await request<{ testSuite: TestSuite }>(`/test-suites/${suiteId}`);
    return res.testSuite;
  },

  updateTestSuite: async (suiteId: string, data: UpdateTestSuiteDto) => {
    const res = await request<{ testSuite: TestSuite }>(`/test-suites/${suiteId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.testSuite;
  },

  deleteTestSuite: (suiteId: string) =>
    request<{ message: string }>(`/test-suites/${suiteId}`, { method: "DELETE" }),

  listTestCases: async (suiteId: string) => {
    const res = await request<{ cases: TestCase[] }>(`/test-suites/${suiteId}/cases`);
    return res.cases;
  },

  createTestCase: async (suiteId: string, data: CreateTestCaseDto) => {
    const res = await request<{ testCase: TestCase }>(`/test-suites/${suiteId}/cases`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.testCase;
  },

  reorderTestCases: (suiteId: string, caseIds: string[]) =>
    request<{ message: string }>(`/test-suites/${suiteId}/cases/reorder`, {
      method: "POST",
      body: JSON.stringify({ caseIds }),
    }),

  getTestCase: async (caseId: string) => {
    const res = await request<{ testCase: TestCase }>(`/test-cases/${caseId}`);
    return res.testCase;
  },

  updateTestCase: async (caseId: string, data: UpdateTestCaseDto) => {
    const res = await request<{ testCase: TestCase }>(`/test-cases/${caseId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.testCase;
  },

  deleteTestCase: (caseId: string) =>
    request<{ message: string }>(`/test-cases/${caseId}`, { method: "DELETE" }),

  importTestCases: async (suiteId: string, file: File) => {
    const token = getToken();
    const tenantId = getCurrentTenantId();
    const headers: Record<string, string> = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) {
      headers["X-Tenant-ID"] = tenantId;
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/test-suites/${suiteId}/import`, {
      method: "POST",
      body: formData,
      headers,
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Import failed" }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<{
      imported: number;
      skipped: number;
      errors: Array<{ line: number; message: string }>;
    }>;
  },

  exportTestCases: (suiteId: string) => {
    const token = getToken();
    const tenantId = getCurrentTenantId();
    const headers: Record<string, string> = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) {
      headers["X-Tenant-ID"] = tenantId;
    }

    return fetch(`${API_BASE}/test-suites/${suiteId}/export`, {
      headers,
      credentials: "include",
    });
  },

  listTestRuns: async (suiteId: string, params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
    if (params?.offset !== undefined) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    const res = await request<{ runs: TestSuiteRun[]; total: number }>(
      `/test-suites/${suiteId}/runs${query ? `?${query}` : ""}`
    );
    return res;
  },

  startTestRun: (suiteId: string) =>
    request<StartRunResponse>(`/test-suites/${suiteId}/runs`, {
      method: "POST",
    }),

  startExperimentWithPrompt: (suiteId: string, candidatePrompt: string) =>
    request<StartRunResponse>(`/test-suites/${suiteId}/experiment`, {
      method: "POST",
      body: JSON.stringify({ candidatePrompt }),
    }),

  getTestSuiteAnalytics: (suiteId: string, params?: { days?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.days !== undefined) searchParams.set("days", String(params.days));
    const query = searchParams.toString();
    return request<TestSuiteRunAnalytics>(`/test-suites/${suiteId}/analytics${query ? `?${query}` : ""}`);
  },

  getTestRun: async (runId: string) => {
    const res = await request<{ testRun: TestRunWithResults }>(`/test-runs/${runId}`);
    return res.testRun;
  },

  deleteTestRun: (runId: string) =>
    request<{ message: string }>(`/test-runs/${runId}`, { method: "DELETE" }),

  // =====================================================================
  // Prompt Analysis
  // =====================================================================

  getRunAnalysis: async (runId: string) => {
    const res = await request<{ analysis: PromptAnalysis | null }>(`/test-runs/${runId}/analysis`);
    return res.analysis;
  },

  getLatestAnalysis: async (suiteId: string) => {
    const res = await request<{ analysis: PromptAnalysis | null }>(
      `/test-suites/${suiteId}/latest-analysis`
    );
    return res.analysis;
  },

  listAnalyses: async (suiteId: string, params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
    if (params?.offset !== undefined) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    const res = await request<{ analyses: PromptAnalysis[]; total: number }>(
      `/test-suites/${suiteId}/analyses${query ? `?${query}` : ""}`
    );
    return res;
  },

  runPromptAnalysis: async (runId: string) => {
    const res = await request<{
      analysisId: string;
      summary: string;
      failureClusters: PromptAnalysis["failureClusters"];
      suggestedPrompt: string;
      rationale: string;
    }>(`/test-runs/${runId}/analysis`, { method: "POST" });
    return res;
  },

  applyAnalysis: (runId: string) =>
    request<{ message: string }>(`/test-runs/${runId}/analysis/apply`, { method: "POST" }),

  applyAnalysisToAgent: (runId: string) =>
    request<{ message: string }>(`/test-runs/${runId}/analysis/apply-to-agent`, { method: "POST" }),

  // =====================================================================
  // Experiments
  // =====================================================================

  listExperiments: async (suiteId: string, params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
    if (params?.offset !== undefined) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    const res = await request<{ experiments: Experiment[]; total: number }>(
      `/test-suites/${suiteId}/experiments${query ? `?${query}` : ""}`
    );
    return res;
  },

  getExperiment: async (experimentId: string) => {
    const res = await request<{ comparison: ExperimentComparison }>(
      `/experiments/${experimentId}`
    );
    return res.comparison;
  },

  applyExperiment: (experimentId: string) =>
    request<{ message: string }>(`/experiments/${experimentId}/apply`, { method: "POST" }),
};
