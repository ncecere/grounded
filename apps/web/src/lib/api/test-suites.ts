import { API_BASE, request, getToken, getCurrentTenantId } from "./client";
import type {
  CreateTestCaseDto,
  CreateTestSuiteDto,
  TestCase,
  TestRunWithResults,
  TestSuite,
  TestSuiteAnalytics,
  TestSuiteRun,
  UpdateTestCaseDto,
  UpdateTestSuiteDto,
} from "./types";

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
    request<{ id: string; status: "started" | "queued" | "error"; message: string }>(
      `/test-suites/${suiteId}/runs`,
      {
        method: "POST",
      }
    ),

  getTestSuiteAnalytics: (suiteId: string, params?: { days?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.days !== undefined) searchParams.set("days", String(params.days));
    const query = searchParams.toString();
    return request<TestSuiteAnalytics>(`/test-suites/${suiteId}/analytics${query ? `?${query}` : ""}`);
  },

  getTestRun: async (runId: string) => {
    const res = await request<{ testRun: TestRunWithResults }>(`/test-runs/${runId}`);
    return res.testRun;
  },

  deleteTestRun: (runId: string) =>
    request<{ message: string }>(`/test-runs/${runId}`, { method: "DELETE" }),
};
