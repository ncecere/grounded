import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { testSuitesApi } from "./test-suites";
import type {
  CreateTestCaseDto,
  CreateTestSuiteDto,
  Experiment,
  ExperimentComparison,
  PromptAnalysis,
  TestCase,
  TestRunWithResults,
  TestSuite,
  TestSuiteRun,
  TestSuiteRunAnalytics,
  UpdateTestCaseDto,
  UpdateTestSuiteDto,
} from "./types/test-suites";

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
  analysis: (runId: string) => ["test-run-analysis", runId] as const,
};

export const experimentKeys = {
  all: ["experiments"] as const,
  list: (suiteId: string, params?: { limit?: number; offset?: number }) =>
    ["experiments", suiteId, params?.limit ?? null, params?.offset ?? null] as const,
  detail: (experimentId: string) => ["experiment", experimentId] as const,
};

export const analysisKeys = {
  all: ["analyses"] as const,
  latest: (suiteId: string) => ["analysis-latest", suiteId] as const,
  forRun: (runId: string) => ["analysis-run", runId] as const,
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

export const useTestSuiteRunAnalytics = (suiteId: string, params?: { days?: number }) =>
  useQuery<TestSuiteRunAnalytics>({
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

// =============================================================================
// Prompt Analysis Hooks
// =============================================================================

export const useRunAnalysis = (runId: string) =>
  useQuery<PromptAnalysis | null>({
    queryKey: analysisKeys.forRun(runId),
    queryFn: () => testSuitesApi.getRunAnalysis(runId),
    enabled: !!runId,
  });

export const useLatestAnalysis = (suiteId: string) =>
  useQuery<PromptAnalysis | null>({
    queryKey: analysisKeys.latest(suiteId),
    queryFn: () => testSuitesApi.getLatestAnalysis(suiteId),
    enabled: !!suiteId,
  });

type AnalysisListResponse = { analyses: PromptAnalysis[]; total: number };

export const useAnalyses = (suiteId: string, params?: { limit?: number; offset?: number }) =>
  useQuery<AnalysisListResponse>({
    queryKey: ["analyses", suiteId, params?.limit ?? null, params?.offset ?? null],
    queryFn: () => testSuitesApi.listAnalyses(suiteId, params),
    enabled: !!suiteId,
  });

export const useRunPromptAnalysis = (suiteId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => testSuitesApi.runPromptAnalysis(runId),
    onSuccess: (_analysis, runId) => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.forRun(runId) });
      queryClient.invalidateQueries({ queryKey: analysisKeys.latest(suiteId) });
    },
  });
};

export const useApplyAnalysis = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => testSuitesApi.applyAnalysis(runId),
    onSuccess: (_response, runId) => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.forRun(runId) });
      queryClient.invalidateQueries({ queryKey: analysisKeys.all });
    },
  });
};

export const useApplyAnalysisToAgent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => testSuitesApi.applyAnalysisToAgent(runId),
    onSuccess: (_response, runId) => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.forRun(runId) });
      queryClient.invalidateQueries({ queryKey: analysisKeys.all });
    },
  });
};

// =============================================================================
// Experiment Hooks
// =============================================================================

type ExperimentListResponse = { experiments: Experiment[]; total: number };

export const useExperiments = (suiteId: string, params?: { limit?: number; offset?: number }) =>
  useQuery<ExperimentListResponse>({
    queryKey: experimentKeys.list(suiteId, params),
    queryFn: () => testSuitesApi.listExperiments(suiteId, params),
    enabled: !!suiteId,
    refetchInterval: (query) => {
      const data = query.state.data as ExperimentListResponse | undefined;
      // Auto-refresh while any experiment is in progress
      if (
        data?.experiments?.some(
          (e) =>
            e.status === "pending" ||
            e.status === "baseline_running" ||
            e.status === "analyzing" ||
            e.status === "candidate_running"
        )
      ) {
        return 3000;
      }
      return false;
    },
  });

export const useExperiment = (experimentId: string) =>
  useQuery<ExperimentComparison>({
    queryKey: experimentKeys.detail(experimentId),
    queryFn: () => testSuitesApi.getExperiment(experimentId),
    enabled: !!experimentId,
    refetchInterval: (query) => {
      const data = query.state.data as ExperimentComparison | undefined;
      // Auto-refresh while experiment is in progress
      if (
        data?.experiment?.status &&
        ["pending", "baseline_running", "analyzing", "candidate_running"].includes(
          data.experiment.status
        )
      ) {
        return 3000;
      }
      return false;
    },
  });

export const useApplyExperiment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (experimentId: string) => testSuitesApi.applyExperiment(experimentId),
    onSuccess: (_data, experimentId) => {
      queryClient.invalidateQueries({ queryKey: experimentKeys.detail(experimentId) });
      // Also invalidate agents list and any agent details to refresh the updated system prompt
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["agent"] });
    },
  });
};

export const useStartExperimentWithPrompt = (suiteId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (candidatePrompt: string) =>
      testSuitesApi.startExperimentWithPrompt(suiteId, candidatePrompt),
    onSuccess: () => {
      // Use partial key match to invalidate all runs for this suite regardless of pagination params
      queryClient.invalidateQueries({ queryKey: ["test-runs", suiteId] });
      queryClient.invalidateQueries({ queryKey: ["experiments", suiteId] });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.detail(suiteId) });
      queryClient.invalidateQueries({ queryKey: testSuiteKeys.analytics(suiteId) });
    },
  });
};
