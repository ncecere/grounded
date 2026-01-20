import { describe, it, expect } from "bun:test";
import type {
  CheckResult,
  CreateTestCaseDto,
  CreateTestSuiteDto,
  ExpectedBehavior,
  TestCase,
  TestCaseResult,
  TestRunWithResults,
  TestSuite,
  TestSuiteAnalytics,
  TestSuiteRun,
  TestSuiteRunSummary,
  UpdateTestCaseDto,
  UpdateTestSuiteDto,
} from "./types";

describe("test suite api types", () => {
  it("should support core test suite type shapes", () => {
    const expectedBehavior = {
      checks: [
        { type: "contains_phrases", phrases: ["hello"], caseSensitive: false },
        { type: "semantic_similarity", expectedAnswer: "world", threshold: 0.8 },
        { type: "llm_judge", expectedAnswer: "answer", criteria: "be concise" },
      ],
      mode: "all",
    } satisfies ExpectedBehavior;

    const runSummary = {
      id: "run-1",
      status: "completed",
      passRate: 92,
      completedAt: "2026-01-20T10:00:00Z",
    } satisfies TestSuiteRunSummary;

    const testSuite = {
      id: "suite-1",
      agentId: "agent-1",
      name: "Onboarding Suite",
      description: "Checks onboarding prompts",
      scheduleType: "daily",
      scheduleTime: "09:00",
      scheduleDayOfWeek: 1,
      llmJudgeModelConfigId: "model-1",
      alertOnRegression: true,
      alertThresholdPercent: 10,
      isEnabled: true,
      testCaseCount: 3,
      lastRun: runSummary,
      createdAt: "2026-01-20T09:00:00Z",
      updatedAt: "2026-01-20T09:30:00Z",
    } satisfies TestSuite;

    const testCase = {
      id: "case-1",
      suiteId: testSuite.id,
      name: "Greeting",
      description: null,
      question: "Say hello",
      expectedBehavior,
      sortOrder: 1,
      isEnabled: true,
      lastResult: {
        status: "passed",
        runId: runSummary.id,
        createdAt: "2026-01-20T10:00:00Z",
      },
      createdAt: "2026-01-20T09:10:00Z",
      updatedAt: "2026-01-20T09:20:00Z",
    } satisfies TestCase;

    const checkResults: CheckResult[] = [
      {
        checkIndex: 0,
        checkType: "contains_phrases",
        passed: true,
        details: {
          matchedPhrases: ["hello"],
        },
      },
    ];

    const testRun = {
      id: runSummary.id,
      suiteId: testSuite.id,
      suiteName: testSuite.name,
      status: "completed",
      triggeredBy: "manual",
      triggeredByUser: { id: "user-1", name: "Alex" },
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      skippedCases: 0,
      passRate: 100,
      startedAt: "2026-01-20T09:55:00Z",
      completedAt: "2026-01-20T10:00:00Z",
      durationMs: 1500,
      errorMessage: null,
      createdAt: "2026-01-20T09:55:00Z",
    } satisfies TestSuiteRun;

    const testCaseResult = {
      id: "result-1",
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      question: testCase.question,
      status: "passed",
      actualResponse: "Hello!",
      checkResults,
      durationMs: 500,
      errorMessage: null,
    } satisfies TestCaseResult;

    const runWithResults = {
      ...testRun,
      results: [testCaseResult],
    } satisfies TestRunWithResults;

    const analytics = {
      runs: [{ date: "2026-01-20", passRate: 90, totalRuns: 2 }],
      averagePassRate: 90,
      totalRuns: 2,
      regressions: 0,
    } satisfies TestSuiteAnalytics;

    const createSuite = {
      name: testSuite.name,
      description: testSuite.description ?? undefined,
      scheduleType: testSuite.scheduleType,
      scheduleTime: testSuite.scheduleTime ?? undefined,
      scheduleDayOfWeek: testSuite.scheduleDayOfWeek ?? undefined,
      llmJudgeModelConfigId: testSuite.llmJudgeModelConfigId ?? undefined,
      alertOnRegression: testSuite.alertOnRegression,
      alertThresholdPercent: testSuite.alertThresholdPercent,
    } satisfies CreateTestSuiteDto;

    const updateSuite = {
      name: "Updated Suite",
      isEnabled: false,
    } satisfies UpdateTestSuiteDto;

    const createCase = {
      name: testCase.name,
      description: "Checks greeting",
      question: testCase.question,
      expectedBehavior,
      sortOrder: 1,
    } satisfies CreateTestCaseDto;

    const updateCase = {
      name: "Updated Greeting",
      isEnabled: false,
    } satisfies UpdateTestCaseDto;

    expect(testSuite.name).toBe("Onboarding Suite");
    expect(testCase.expectedBehavior.checks.length).toBe(3);
    expect(testRun.status).toBe("completed");
    expect(runWithResults.results[0].checkResults[0].passed).toBe(true);
    expect(analytics.totalRuns).toBe(2);
    expect(createSuite.name).toBe(testSuite.name);
    expect(updateSuite.isEnabled).toBe(false);
    expect(createCase.question).toBe(testCase.question);
    expect(updateCase.name).toBe("Updated Greeting");
  });
});
