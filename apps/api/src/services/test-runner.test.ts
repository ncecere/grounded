import { describe, expect, it, mock } from "bun:test";
import {
  createTestRunner,
  type TestRunnerStore,
  type RunLockManager,
} from "./test-runner";

const buildSuite = () => ({
  id: "suite-1",
  tenantId: "tenant-1",
  agentId: "agent-1",
  name: "Suite",
  description: null,
  scheduleType: "manual" as const,
  scheduleTime: null,
  scheduleDayOfWeek: null,
  llmJudgeModelConfigId: null,
  alertOnRegression: true,
  alertThresholdPercent: 10,
  isEnabled: true,
  createdBy: "user-1",
  createdAt: new Date("2026-01-19T00:00:00Z"),
  updatedAt: new Date("2026-01-19T00:00:00Z"),
  deletedAt: null,
});

const buildAgent = () => ({
  id: "agent-1",
  tenantId: "tenant-1",
  name: "Agent",
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
  createdAt: new Date("2026-01-19T00:00:00Z"),
  deletedAt: null,
});

const buildRun = () => ({
  id: "run-1",
  suiteId: "suite-1",
  tenantId: "tenant-1",
  status: "pending" as const,
  triggeredBy: "manual" as const,
  triggeredByUserId: null,
  totalCases: 0,
  passedCases: 0,
  failedCases: 0,
  skippedCases: 0,
  startedAt: null,
  completedAt: null,
  errorMessage: null,
  createdAt: new Date("2026-01-19T00:00:00Z"),
});

const createStore = (overrides: Partial<TestRunnerStore>): TestRunnerStore => ({
  getSuite: mock(async () => buildSuite()),
  getRun: mock(async () => buildRun()),
  getRunStatus: mock(async () => "running" as const) as TestRunnerStore["getRunStatus"],
  createRun: mock(async () => ({ id: "run-1" })),
  updateRun: mock(async () => {}),
  getAgent: mock(async () => buildAgent()),
  getEnabledTestCases: mock(async () => []),
  insertTestCaseResult: mock(async () => {}),
  findPendingRun: mock(async () => null),
  getEmbeddingModelIdForAgent: mock(async () => null),
  ...overrides,
});

const createLockManager = (acquired: boolean): RunLockManager => ({
  acquire: mock(async () => ({
    acquired,
    startRenewal: () => ({ isValid: () => true, stop: () => {} }),
    release: async () => {},
  })),
});

describe("test-runner", () => {
  it("returns an error when suite is missing", async () => {
    const store = createStore({ getSuite: mock(async () => null) });
    const runner = createTestRunner({ store, lockManager: createLockManager(false) });

    const result = await runner.runTestSuite("missing", "manual");

    expect(result.status).toBe("error");
    expect(result.error).toBe("Test suite not found");
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it("queues run when lock is unavailable", async () => {
    const store = createStore({
      getSuite: mock(async () => buildSuite()),
      createRun: mock(async () => ({ id: "run-queued" })),
    });
    const lockManager = createLockManager(false);
    const runner = createTestRunner({ store, lockManager });

    const result = await runner.runTestSuite("suite-1", "manual");

    expect(result).toEqual({ runId: "run-queued", status: "queued" });
    expect(lockManager.acquire).toHaveBeenCalled();
  });

  it("completes runs with no enabled test cases", async () => {
    const updateCalls: Array<{ runId: string; values: any }> = [];
    const store = createStore({
      getSuite: mock(async () => buildSuite()),
      getRun: mock(async () => buildRun()),
      getAgent: mock(async () => buildAgent()),
      getEnabledTestCases: mock(async () => []),
      updateRun: mock(async (runId: string, values: any) => {
        updateCalls.push({ runId, values });
      }),
    });
    const now = new Date("2026-01-19T12:00:00Z");
    const runner = createTestRunner({
      store,
      lockManager: createLockManager(true),
      now: () => now,
    });

    await runner.executeTestRun("run-1");

    expect(updateCalls[0].values.status).toBe("running");
    const finalUpdate = updateCalls[updateCalls.length - 1].values;
    expect(finalUpdate.status).toBe("completed");
    expect(finalUpdate.totalCases).toBe(0);
    expect(finalUpdate.passedCases).toBe(0);
    expect(finalUpdate.failedCases).toBe(0);
    expect(finalUpdate.completedAt).toEqual(now);
    expect(store.insertTestCaseResult).not.toHaveBeenCalled();
  });
});
