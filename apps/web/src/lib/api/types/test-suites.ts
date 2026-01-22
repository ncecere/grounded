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

export interface TestSuiteRunSummary {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  passRate: number;
  completedAt: string | null;
}

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
  promptAnalysisEnabled: boolean;
  abTestingEnabled: boolean;
  analysisModelConfigId: string | null;
  manualCandidatePrompt: string | null;
  isEnabled: boolean;
  testCaseCount: number;
  lastRun: TestSuiteRunSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestCaseResultSummary {
  status: "passed" | "failed" | "skipped" | "error";
  runId: string;
  createdAt: string;
}

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
  systemPrompt?: string | null;
  promptVariant?: "baseline" | "candidate" | null;
  experimentId?: string | null;
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

export interface TestSuiteRunAnalytics {
  runs: Array<{
    date: string;
    passRate: number;
    totalRuns: number;
  }>;
  averagePassRate: number;
  totalRuns: number;
  regressions: number;
}

export interface TestSuiteAnalyticsSummary {
  totalSuites: number;
  totalCases: number;
  totalRuns: number;
  overallPassRate: number;
}

export interface TestSuiteAnalyticsAgent {
  agentId: string;
  agentName: string;
  suiteCount: number;
  caseCount: number;
  runCount: number;
  passRate: number;
  previousPassRate: number | null;
  passRateChange: number | null;
  trend?: "up" | "down" | "stable" | "unknown";
  lastRunAt?: string | null;
  lastRunStatus?: "pending" | "running" | "completed" | "failed" | "cancelled";
}

export interface TestSuiteAnalyticsRegression {
  runId: string;
  suiteId: string;
  suiteName: string;
  agentId: string | null;
  agentName: string;
  completedAt: string;
  previousPassRate: number;
  currentPassRate: number;
  passRateDrop: number;
}

export interface TestSuiteAnalytics {
  summary: TestSuiteAnalyticsSummary;
  passRateOverTime: Array<{
    date: string;
    passRate: number;
    totalRuns: number;
  }>;
  agents: TestSuiteAnalyticsAgent[];
  recentRegressions: TestSuiteAnalyticsRegression[];
}

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
  promptAnalysisEnabled?: boolean;
  abTestingEnabled?: boolean;
  analysisModelConfigId?: string | null;
  manualCandidatePrompt?: string | null;
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

export interface FailureCluster {
  category: string;
  description: string;
  affectedCases: string[];
  suggestedFix: string;
}

export interface PromptAnalysis {
  id: string;
  suiteId: string;
  runId: string;
  experimentId: string | null;
  modelConfigId: string | null;
  summary: string | null;
  failureClusters: FailureCluster[] | null;
  suggestedPrompt: string | null;
  rationale: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export type ExperimentStatus =
  | "pending"
  | "baseline_running"
  | "analyzing"
  | "candidate_running"
  | "completed"
  | "failed";

export interface Experiment {
  id: string;
  suiteId: string;
  baselineRunId: string | null;
  candidateRunId: string | null;
  status: ExperimentStatus;
  candidateSource: "analysis" | "manual" | null;
  candidatePrompt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ExperimentRunStats {
  runId: string;
  passRate: number;
  passedCases: number;
  failedCases: number;
  totalCases: number;
  systemPrompt: string | null;
}

export interface ExperimentComparison {
  experiment: Experiment;
  baseline: ExperimentRunStats | null;
  candidate: ExperimentRunStats | null;
  delta: {
    passRate: number;
    passedCases: number;
    failedCases: number;
  } | null;
}

export interface StartRunResponse {
  id: string;
  experimentId?: string;
  status: "started" | "queued";
  message: string;
  isExperiment: boolean;
}
