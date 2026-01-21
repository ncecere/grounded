import { describe, expect, it, mock } from "bun:test";

const responseMap = new Map<string, string>();

class MockSimpleRAGService {
  constructor(
    private tenantId: string,
    private agentId: string
  ) {}

  async *chat(message: string) {
    const response = responseMap.get(message) ?? "";
    if (response) {
      yield { type: "text", content: response };
    }
    yield { type: "done", conversationId: "conv-1" };
  }
}

mock.module("./simple-rag", () => ({
  SimpleRAGService: MockSimpleRAGService,
}));

const { parseTestCaseJsonl, serializeTestCasesJsonl } = await import("./test-suite-import");
const { buildRegressionEntries } = await import("./test-suite-analytics");
const { createTestRunner } = await import("./test-runner");

describe("test suites end-to-end", () => {
  it("imports cases, runs a suite, and builds regression analytics", async () => {
    const jsonl = [
      JSON.stringify({
        name: "Greeting",
        question: "What is the greeting?",
        expectedBehavior: {
          mode: "all",
          checks: [{ type: "contains_phrases", phrases: ["hello"] }],
        },
      }),
      JSON.stringify({
        name: "Farewell",
        question: "What is the farewell?",
        expectedBehavior: {
          mode: "all",
          checks: [{ type: "contains_phrases", phrases: ["goodbye"] }],
        },
      }),
    ].join("\n");

    const parsed = parseTestCaseJsonl(jsonl);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.entries).toHaveLength(2);

    responseMap.set("What is the greeting?", "Hello there!");
    responseMap.set("What is the farewell?", "Hello there!");

    const now = new Date("2026-01-20T12:00:00Z");
    const suite = {
      id: "suite-1",
      tenantId: "tenant-1",
      agentId: "agent-1",
      name: "End-to-End Suite",
      description: null,
      scheduleType: "manual" as const,
      scheduleTime: null,
      scheduleDayOfWeek: null,
      llmJudgeModelConfigId: null,
      alertOnRegression: false,
      alertThresholdPercent: 10,
      promptAnalysisEnabled: false,
      abTestingEnabled: false,
      analysisModelConfigId: null,
      manualCandidatePrompt: null,
      isEnabled: true,
      createdBy: "user-1",
      createdAt: new Date("2026-01-20T00:00:00Z"),
      updatedAt: new Date("2026-01-20T00:00:00Z"),
      deletedAt: null,
    };
    const agent = {
      id: "agent-1",
      tenantId: "tenant-1",
      name: "Support Agent",
      description: null,
      systemPrompt: "You are helpful.",
      welcomeMessage: null,
      logoUrl: null,
      rerankerEnabled: true,
      citationsEnabled: true,
      isEnabled: true,
      ragType: "simple" as const,
      showReasoningSteps: true,
      llmModelConfigId: null,
      createdBy: "user-1",
      createdAt: new Date("2026-01-20T00:00:00Z"),
      deletedAt: null,
    };
    const run = {
      id: "run-1",
      suiteId: suite.id,
      tenantId: suite.tenantId,
      status: "pending" as
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled",
      triggeredBy: "manual" as const,
      triggeredByUserId: null,
      totalCases: 0,
      passedCases: 0,
      failedCases: 0,
      skippedCases: 0,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      systemPrompt: null,
      promptVariant: null,
      experimentId: null,
      createdAt: new Date("2026-01-20T11:00:00Z"),
    };
    const previousRun = {
      id: "run-prev",
      suiteId: suite.id,
      tenantId: suite.tenantId,
      status: "completed" as const,
      triggeredBy: "manual" as const,
      triggeredByUserId: null,
      totalCases: 2,
      passedCases: 2,
      failedCases: 0,
      skippedCases: 0,
      startedAt: new Date("2026-01-19T10:00:00Z"),
      completedAt: new Date("2026-01-19T10:05:00Z"),
      errorMessage: null,
      systemPrompt: null,
      promptVariant: null,
      experimentId: null,
      createdAt: new Date("2026-01-19T10:05:00Z"),
    };

    const testCases = parsed.entries.map((entry, index) => ({
      id: `case-${index + 1}`,
      suiteId: suite.id,
      tenantId: suite.tenantId,
      name: entry.name,
      description: entry.description ?? null,
      question: entry.question,
      expectedBehavior: entry.expectedBehavior,
      sortOrder: index,
      isEnabled: entry.isEnabled ?? true,
      createdAt: new Date("2026-01-20T00:00:00Z"),
      updatedAt: new Date("2026-01-20T00:00:00Z"),
      deletedAt: null,
    }));

    const updates: Array<{ runId: string; values: Record<string, unknown> }> = [];
    const results: Array<{ testCaseId: string; status: "passed" | "failed" | "skipped" | "error" }> =
      [];

    const store = {
      getSuite: async () => suite,
      getRun: async () => run,
      getRunStatus: async () => run.status,
      getPreviousCompletedRun: async () => previousRun,
      createRun: async () => ({ id: run.id }),
      updateRun: async (runId: string, values: Record<string, unknown>) => {
        updates.push({ runId, values });
        Object.assign(run, values);
      },
      getAgent: async () => agent,
      getEnabledTestCases: async () => testCases,
      insertTestCaseResult: async (values: {
        runId: string;
        testCaseId: string;
        status: "passed" | "failed" | "skipped" | "error";
      }) => {
        results.push({ testCaseId: values.testCaseId, status: values.status });
      },
      findPendingRun: async () => null,
      getEmbeddingModelIdForAgent: async () => null,
      getTestCaseResultsForRun: async () => results,
    };

    const lockManager = {
      acquire: async () => ({
        acquired: true,
        startRenewal: () => ({ isValid: () => true, stop: () => {} }),
        release: async () => {},
      }),
    };

    const runner = createTestRunner({ store, lockManager, now: () => now });

    await runner.executeTestRun(run.id);

    expect(run.status).toBe("completed");
    expect(run.totalCases).toBe(2);
    expect(run.passedCases).toBe(1);
    expect(run.failedCases).toBe(1);
    expect(results).toEqual([
      { testCaseId: "case-1", status: "passed" },
      { testCaseId: "case-2", status: "failed" },
    ]);
    expect(updates.length).toBeGreaterThan(0);

    const exported = serializeTestCasesJsonl(parsed.entries);
    const roundTrip = parseTestCaseJsonl(exported);
    expect(roundTrip.entries).toHaveLength(2);

    const regressions = buildRegressionEntries(
      [
        {
          runId: previousRun.id,
          suiteId: suite.id,
          completedAt: previousRun.completedAt,
          passedCases: previousRun.passedCases,
          totalCases: previousRun.totalCases,
          skippedCases: previousRun.skippedCases,
        },
        {
          runId: run.id,
          suiteId: suite.id,
          completedAt: run.completedAt ?? now,
          passedCases: run.passedCases,
          totalCases: run.totalCases,
          skippedCases: run.skippedCases,
        },
      ],
      new Date("2026-01-19T12:00:00Z")
    );

    expect(regressions).toHaveLength(1);
    expect(regressions[0]?.passRateDrop).toBe(50);
  });
});
