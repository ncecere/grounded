import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { testSuitesApi } from "./test-suites";
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

type TestRunListResponse = { runs: TestSuiteRun[]; total: number };

export const testSuiteKeys = {
  all: ["test-suites"] as const,
  list: (agentId: string) => [...testSuiteKeys.all, agentId] as const,
  detail: (suiteId: string) => ["test-suite", suiteId] as const,
  analytics: (suiteId: string, days?: number) =>
    ["test-suite-analytics", suiteId, days ?? null] as const,
};

export const testCaseKeys = {
  all: ["test-cases"] as const,
  list: (suiteId: string) => [...testCaseKeys.all, suiteId] as const,
  detail: (caseId: string) => ["test-case", caseId] as const,
};

export const testRunKeys = {
  all: ["test-runs"] as const,
  list: (suiteId: string, params?: { limit?: number; offset?: number }) =>
    ["test-runs", suiteId, params?.limit ?? null, params?.offset ?? null] as const,
  detail: (runId: string) => ["test-run", runId] as const,
};

export const useTestSuites = (agentId: string) =>
  useQuery<TestSuite[]>({
    queryKey: testSuiteKeys.list(agentId),
    queryFn: () => testSuitesApi.listTestSuites(agentId),
    enabled: !!agentId,
  });

export const useTestSuite = (suiteId: string) =>
  useQuery<TestSuite>({
    queryKey: testSuiteKeys.detail(suiteId),
    queryFn: () => testSuitesApi.getTestSuite(suiteId),
    enabled: !!suiteId,
  });

export const useTestCases = (suiteId: string) =>
  useQuery<TestCase[]>({
    queryKey: testCaseKeys.list(suiteId),
    queryFn: () => testSuitesApi.listTestCases(suiteId),
    enabled: !!suiteId,
  });

export const useTestCase = (caseId: string) =>
  useQuery<TestCase>({
    queryKey: testCaseKeys.detail(caseId),
    queryFn: () => testSuitesApi.getTestCase(caseId),
    enabled: !!caseId,
  });

export const useTestRuns = (suiteId: string, params?: { limit?: number; offset?: number }) =>
  useQuery<TestRunListResponse>({
    queryKey: testRunKeys.list(suiteId, params),
    queryFn: () => testSuitesApi.listTestRuns(suiteId, params),
    enabled: !!suiteId,
    refetchInterval: (query) => {
      const data = query.state.data as TestRunListResponse | undefined;
      if (data?.runs?.some((run) => run.status === "pending" || run.status === "running")) {
        return 3000;
      }
      return false;
    },
  });

export const useTestRun = (runId: string) =>
  useQuery<TestRunWithResults>({
    queryKey: testRunKeys.detail(runId),
    queryFn: () => testSuitesApi.getTestRun(runId),
    enabled: !!runId,
    refetchInterval: (query) => {
      const data = query.state.data as TestRunWithResults | undefined;
      if (data?.status === "pending" || data?.status === "running") {
        return 3000;
      }
      return false;
    },
  });

export const useTestSuiteAnalytics = (suiteId: string, params?: { days?: number }) =>
  useQuery<TestSuiteAnalytics>({
    queryKey: testSuiteKeys.analytics(suiteId, params?.days),
    queryFn: () => testSuitesApi.getTestSuiteAnalytics(suiteId, params),
    enabled: !!suiteId,
  });

export const useCreateTestSuite = (agentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTestSuiteDto) => testSuitesApi.createTestSuite(agentId, data),
    onSuccess: (suite) => {
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.list(suite.agentId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(suite.id) });
    },
  });
};

export const useUpdateTestSuite = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ suiteId, data }: { suiteId: string; data: UpdateTestSuiteDto }) =>
      testSuitesApi.updateTestSuite(suiteId, data),
    onSuccess: (suite) => {
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(suite.id) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.list(suite.agentId) });
    },
  });
};

export const useDeleteTestSuite = (agentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suiteId: string) => testSuitesApi.deleteTestSuite(suiteId),
    onSuccess: (_response, suiteId) => {
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.list(agentId) });
      queryClient.removeQueries({ queryKey: testSuiteKeys.detail(suiteId) });
      queryClient.invalidateQueries({ queryKey: testCaseKeys.all });
      queryClient.invalidateQueries({ queryKey: testRunKeys.all });
    },
  });
};

export const useCreateTestCase = (suiteId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTestCaseDto) => testSuitesApi.createTestCase(suiteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: testCaseKeys.list(suiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(suiteId) });
    },
  });
};

export const useUpdateTestCase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, data }: { caseId: string; data: UpdateTestCaseDto }) =>
      testSuitesApi.updateTestCase(caseId, data),
    onSuccess: (testCase) => {
      queryClient.invalidateQueries({ queryKey: testCaseKeys.detail(testCase.id) });
      queryClient.invalidateQueries({ queryKey: testCaseKeys.list(testCase.suiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(testCase.suiteId) });
    },
  });
};

export const useDeleteTestCase = (suiteId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => testSuitesApi.deleteTestCase(caseId),
    onSuccess: (_response, caseId) => {
      queryClient.invalidateQueries({ queryKey: testCaseKeys.list(suiteId) });
      queryClient.removeQueries({ queryKey: testCaseKeys.detail(caseId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(suiteId) });
    },
  });
};

export const useReorderTestCases = (suiteId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caseIds: string[]) => testSuitesApi.reorderTestCases(suiteId, caseIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: testCaseKeys.list(suiteId) });
    },
  });
};

export const useImportTestCases = (suiteId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => testSuitesApi.importTestCases(suiteId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: testCaseKeys.list(suiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(suiteId) });
    },
  });
};

export const useStartTestRun = (suiteId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => testSuitesApi.startTestRun(suiteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: testRunKeys.list(suiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(suiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.analytics(suiteId) });
    },
  });
};

export const useDeleteTestRun = (suiteId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => testSuitesApi.deleteTestRun(runId),
    onSuccess: (_response, runId) => {
      queryClient.invalidateQueries({ queryKey: testRunKeys.list(suiteId) });
      queryClient.removeQueries({ queryKey: testRunKeys.detail(runId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.analytics(suiteId) });
    },
  });
};
