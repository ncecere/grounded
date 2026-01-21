import { generateText } from "ai";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@grounded/db";
import {
  agentTestSuites,
  testCases,
  testSuiteRuns,
  testCaseResults,
  agents,
  tenants,
  agentKbs,
  knowledgeBases,
  tenantAlertSettings,
  tenantMemberships,
  users,
  type ExpectedBehavior,
  type CheckResult,
} from "@grounded/db/schema";
import { getAIRegistry } from "@grounded/ai-providers";
import { cosineSimilarity, generateEmbedding } from "@grounded/embeddings";
import { log } from "@grounded/logger";
import { redis } from "@grounded/queue";
import { getEnv } from "@grounded/shared";
import { SimpleRAGService } from "./simple-rag";
import { emailService, getAlertSettings } from "./email";
import { parseAdditionalEmails, resolveAlertSettings } from "./tenant-alert-helpers";

// ============================================================================
// Types
// =========================================================================

type TestSuite = InferSelectModel<typeof agentTestSuites>;
type TestSuiteRun = InferSelectModel<typeof testSuiteRuns>;
type TestCase = InferSelectModel<typeof testCases>;
type Agent = InferSelectModel<typeof agents>;
type RedisClient = typeof redis;
type LlmModel = Awaited<
  ReturnType<ReturnType<typeof getAIRegistry>["getLanguageModel"]>
>;

export interface RunTestSuiteResult {
  runId: string;
  status: "started" | "queued" | "error";
  error?: string;
}

export interface TestRunnerStore {
  getSuite: (suiteId: string) => Promise<TestSuite | null>;
  getRun: (runId: string) => Promise<TestSuiteRun | null>;
  getRunStatus: (runId: string) => Promise<TestSuiteRun["status"] | null>;
  getPreviousCompletedRun: (suiteId: string, beforeDate: Date) => Promise<TestSuiteRun | null>;
  createRun: (values: {
    suiteId: string;
    tenantId: string;
    triggeredBy: "manual" | "schedule";
    triggeredByUserId?: string | null;
  }) => Promise<{ id: string }>;
  updateRun: (runId: string, values: Partial<TestSuiteRun>) => Promise<void>;
  getAgent: (agentId: string) => Promise<Agent | null>;
  getEnabledTestCases: (suiteId: string) => Promise<TestCase[]>;
  insertTestCaseResult: (values: {
    runId: string;
    testCaseId: string;
    tenantId: string;
    status: "passed" | "failed" | "skipped" | "error";
    actualResponse?: string | null;
    checkResults?: CheckResult[] | null;
    durationMs?: number | null;
    errorMessage?: string | null;
  }) => Promise<void>;
  findPendingRun: (suiteId: string) => Promise<TestSuiteRun | null>;
  getEmbeddingModelIdForAgent: (agentId: string) => Promise<string | null>;
  getTestCaseResultsForRun: (
    runId: string,
    options?: { includeTestCase?: boolean }
  ) => Promise<
    Array<{
      testCaseId: string;
      status: "passed" | "failed" | "skipped" | "error";
      testCase?: { name: string; question: string } | null;
    }>
  >;
}

export interface RunLockState {
  isValid: () => boolean;
  stop: () => void;
}

export interface RunLockHandle {
  acquired: boolean;
  startRenewal: () => RunLockState;
  release: () => Promise<void>;
}

export interface RunLockManager {
  acquire: (suiteId: string, runId: string) => Promise<RunLockHandle>;
}

export interface RegressionInfo {
  isRegression: boolean;
  previousPassRate: number;
  currentPassRate: number;
  passRateDrop: number;
  newlyFailingCases: Array<{
    testCaseId: string;
    testCaseName: string;
    question: string;
  }>;
}

export interface TestRunnerDependencies {
  store: TestRunnerStore;
  lockManager: RunLockManager;
  now: () => Date;
  caseTimeoutMs: number;
  evaluationTimeoutMs: number;
}

// ============================================================================
// Constants
// =========================================================================

const RUN_LOCK_TTL_MS = 45 * 60 * 1000;
const RUN_LOCK_RENEW_MS = 5 * 60 * 1000;
const DEFAULT_CASE_TIMEOUT_MS = 60 * 1000;
const DEFAULT_EVALUATION_TIMEOUT_MS = 45 * 1000;
const DEFAULT_APP_URL = "http://localhost:8088";

const RENEW_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end return 0";
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

// ============================================================================
// Store
// =========================================================================

function createDefaultStore(): TestRunnerStore {
  return {
    async getSuite(suiteId) {
      const suite = await db.query.agentTestSuites.findFirst({
        where: and(eq(agentTestSuites.id, suiteId), isNull(agentTestSuites.deletedAt)),
      });
      return suite ?? null;
    },
    async getRun(runId) {
      const run = await db.query.testSuiteRuns.findFirst({
        where: eq(testSuiteRuns.id, runId),
      });
      return run ?? null;
    },
    async getRunStatus(runId) {
      const run = await db.query.testSuiteRuns.findFirst({
        columns: { status: true },
        where: eq(testSuiteRuns.id, runId),
      });
      return run?.status ?? null;
    },
    async getPreviousCompletedRun(suiteId, beforeDate) {
      const run = await db.query.testSuiteRuns.findFirst({
        where: and(
          eq(testSuiteRuns.suiteId, suiteId),
          eq(testSuiteRuns.status, "completed"),
          lt(testSuiteRuns.createdAt, beforeDate)
        ),
        orderBy: [desc(testSuiteRuns.createdAt)],
      });
      return run ?? null;
    },
    async createRun(values) {
      const rows = await db
        .insert(testSuiteRuns)
        .values({
          suiteId: values.suiteId,
          tenantId: values.tenantId,
          triggeredBy: values.triggeredBy,
          triggeredByUserId: values.triggeredByUserId || null,
        })
        .returning({ id: testSuiteRuns.id });

      return { id: rows[0].id };
    },
    async updateRun(runId, values) {
      await db.update(testSuiteRuns).set(values).where(eq(testSuiteRuns.id, runId));
    },
    async getAgent(agentId) {
      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, agentId), isNull(agents.deletedAt)),
      });
      return agent ?? null;
    },
    async getEnabledTestCases(suiteId) {
      return db.query.testCases.findMany({
        where: and(
          eq(testCases.suiteId, suiteId),
          eq(testCases.isEnabled, true),
          isNull(testCases.deletedAt)
        ),
        orderBy: [asc(testCases.sortOrder), asc(testCases.createdAt)],
      });
    },
    async insertTestCaseResult(values) {
      await db.insert(testCaseResults).values({
        runId: values.runId,
        testCaseId: values.testCaseId,
        tenantId: values.tenantId,
        status: values.status,
        actualResponse: values.actualResponse ?? null,
        checkResults: values.checkResults ?? null,
        durationMs: values.durationMs ?? null,
        errorMessage: values.errorMessage ?? null,
      });
    },
    async findPendingRun(suiteId) {
      const run = await db.query.testSuiteRuns.findFirst({
        where: and(
          eq(testSuiteRuns.suiteId, suiteId),
          eq(testSuiteRuns.status, "pending")
        ),
        orderBy: [asc(testSuiteRuns.createdAt)],
      });
      return run ?? null;
    },
    async getEmbeddingModelIdForAgent(agentId) {
      const kbLinks = await db.query.agentKbs.findMany({
        where: and(eq(agentKbs.agentId, agentId), isNull(agentKbs.deletedAt)),
        orderBy: [asc(agentKbs.createdAt)],
      });

      if (kbLinks.length === 0) return null;

      const kb = await db.query.knowledgeBases.findFirst({
        columns: { embeddingModelId: true },
        where: and(eq(knowledgeBases.id, kbLinks[0].kbId), isNull(knowledgeBases.deletedAt)),
      });

      return kb?.embeddingModelId ?? null;
    },
    async getTestCaseResultsForRun(runId, options) {
      return db.query.testCaseResults.findMany({
        where: eq(testCaseResults.runId, runId),
        with: options?.includeTestCase ? { testCase: true } : undefined,
      });
    },
  };
}

// ============================================================================
// Lock Manager
// =========================================================================

function createRedisLockManager(client: RedisClient): RunLockManager {
  return {
    async acquire(suiteId, runId) {
      const lockKey = `test-suite:run-lock:${suiteId}`;
      const acquired = await client.set(lockKey, runId, "PX", RUN_LOCK_TTL_MS, "NX");

      if (!acquired) {
        return {
          acquired: false,
          startRenewal: () => ({ isValid: () => false, stop: () => {} }),
          release: async () => {},
        };
      }

      return {
        acquired: true,
        startRenewal: () => {
          let valid = true;
          const interval = setInterval(async () => {
            try {
              const result = await client.eval(
                RENEW_LOCK_SCRIPT,
                1,
                lockKey,
                runId,
                RUN_LOCK_TTL_MS
              );
              if (!result) {
                valid = false;
                clearInterval(interval);
              }
            } catch (error) {
              valid = false;
              clearInterval(interval);
              log.error("api", "Test runner lock renewal failed", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }, RUN_LOCK_RENEW_MS);

          return {
            isValid: () => valid,
            stop: () => clearInterval(interval),
          };
        },
        release: async () => {
          await client.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, runId);
        },
      };
    },
  };
}

// ============================================================================
// Runner
// =========================================================================

export function createTestRunner(deps?: Partial<TestRunnerDependencies>) {
  const dependencies: TestRunnerDependencies = {
    store: deps?.store ?? createDefaultStore(),
    lockManager: deps?.lockManager ?? createRedisLockManager(redis),
    now: deps?.now ?? (() => new Date()),
    caseTimeoutMs: deps?.caseTimeoutMs ?? DEFAULT_CASE_TIMEOUT_MS,
    evaluationTimeoutMs: deps?.evaluationTimeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS,
  };

  const runTestSuite = async (
    suiteId: string,
    triggeredBy: "manual" | "schedule",
    userId?: string
  ): Promise<RunTestSuiteResult> => {
    try {
      const suite = await dependencies.store.getSuite(suiteId);
      if (!suite) {
        return { runId: "", status: "error", error: "Test suite not found" };
      }

      if (!suite.isEnabled) {
        return { runId: "", status: "error", error: "Test suite is disabled" };
      }

      const run = await dependencies.store.createRun({
        suiteId: suite.id,
        tenantId: suite.tenantId,
        triggeredBy,
        triggeredByUserId: userId,
      });

      const lockHandle = await dependencies.lockManager.acquire(suite.id, run.id);
      if (!lockHandle.acquired) {
        return { runId: run.id, status: "queued" };
      }

      void executeTestRun(run.id, lockHandle);

      return { runId: run.id, status: "started" };
    } catch (error) {
      log.error("api", "Test suite run failed to start", {
        error: error instanceof Error ? error.message : String(error),
        suiteId,
      });

      return {
        runId: "",
        status: "error",
        error: error instanceof Error ? error.message : "Failed to start test suite",
      };
    }
  };

  const executeTestRun = async (runId: string, lockHandle?: RunLockHandle): Promise<void> => {
    const lockState = lockHandle?.startRenewal();
    const run = await dependencies.store.getRun(runId);

    if (!run) {
      lockState?.stop();
      if (lockHandle) await lockHandle.release();
      log.error("api", "Test suite run not found", { runId });
      return;
    }

    let suite: TestSuite | null = null;

    try {
      suite = await dependencies.store.getSuite(run.suiteId);

      if (!suite) {
        await dependencies.store.updateRun(runId, {
          status: "failed",
          completedAt: dependencies.now(),
          errorMessage: "Test suite not found",
        });
        return;
      }

      const agent = await dependencies.store.getAgent(suite.agentId);

      if (!agent) {
        await dependencies.store.updateRun(runId, {
          status: "failed",
          completedAt: dependencies.now(),
          errorMessage: "Agent not found",
        });
        return;
      }

      const enabledCases = await dependencies.store.getEnabledTestCases(suite.id);

      // Check for prompt override (used in A/B testing candidate runs)
      // If the run already has a systemPrompt set, use that (candidate run)
      // Otherwise use the agent's system prompt (baseline run)
      const existingRun = await dependencies.store.getRun(runId);
      const systemPromptToUse =
        existingRun?.systemPrompt ||
        agent.systemPrompt ||
        "You are a helpful assistant.";

      await dependencies.store.updateRun(runId, {
        status: "running",
        startedAt: dependencies.now(),
        totalCases: enabledCases.length,
        passedCases: 0,
        failedCases: 0,
        skippedCases: 0,
        systemPrompt: systemPromptToUse,
      });

      if (enabledCases.length === 0) {
        await dependencies.store.updateRun(runId, {
          status: "completed",
          completedAt: dependencies.now(),
          totalCases: 0,
          passedCases: 0,
          failedCases: 0,
          skippedCases: 0,
        });
        return;
      }

      const hasSemanticChecks = enabledCases.some((testCase) =>
        testCase.expectedBehavior.checks.some((check) => check.type === "semantic_similarity")
      );
      const hasLlmJudgeChecks = enabledCases.some((testCase) =>
        testCase.expectedBehavior.checks.some((check) => check.type === "llm_judge")
      );

      const embeddingModelId = hasSemanticChecks
        ? await dependencies.store.getEmbeddingModelIdForAgent(agent.id)
        : null;

      const llmModel = hasLlmJudgeChecks
        ? await getAIRegistry().getLanguageModel(suite.llmJudgeModelConfigId ?? undefined)
        : null;

      let passedCases = 0;
      let failedCases = 0;
      let skippedCases = 0;

      for (const testCase of enabledCases) {
        if (lockState && !lockState.isValid()) {
          await dependencies.store.updateRun(runId, {
            status: "failed",
            completedAt: dependencies.now(),
            errorMessage: "Run lock lost while executing test suite",
            passedCases,
            failedCases,
            skippedCases,
          });
          return;
        }

        const status = await dependencies.store.getRunStatus(runId);
        if (status === "cancelled") {
          await dependencies.store.updateRun(runId, {
            completedAt: dependencies.now(),
            passedCases,
            failedCases,
            skippedCases,
          });
          return;
        }

        const caseStart = Date.now();
        try {
          const missingModel = getMissingModelError(testCase.expectedBehavior, {
            embeddingModelId,
            llmModel,
          });

          if (missingModel) {
            await dependencies.store.insertTestCaseResult({
              runId,
              testCaseId: testCase.id,
              tenantId: run.tenantId,
              status: "error",
              errorMessage: missingModel,
              durationMs: Date.now() - caseStart,
            });
            failedCases += 1;
          } else {
            const response = await withTimeout(
              getCaseResponse(run.tenantId, agent.id, testCase.question),
              dependencies.caseTimeoutMs,
              "Test case timed out"
            );

            const evaluation = await withTimeout(
              evaluateResponse(testCase.question, response, testCase.expectedBehavior, {
                embeddingModelId,
                llmModel,
              }),
              dependencies.evaluationTimeoutMs,
              "Evaluation timed out"
            );

            const resultStatus = evaluation.passed ? "passed" : "failed";

            await dependencies.store.insertTestCaseResult({
              runId,
              testCaseId: testCase.id,
              tenantId: run.tenantId,
              status: resultStatus,
              actualResponse: response,
              checkResults: evaluation.checkResults,
              durationMs: Date.now() - caseStart,
            });

            if (resultStatus === "passed") {
              passedCases += 1;
            } else {
              failedCases += 1;
            }
          }
        } catch (error) {
          await dependencies.store.insertTestCaseResult({
            runId,
            testCaseId: testCase.id,
            tenantId: run.tenantId,
            status: "error",
            errorMessage: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - caseStart,
          });
          failedCases += 1;
        }

        await dependencies.store.updateRun(runId, {
          passedCases,
          failedCases,
          skippedCases,
        });
      }

      await dependencies.store.updateRun(runId, {
        status: "completed",
        completedAt: dependencies.now(),
        passedCases,
        failedCases,
        skippedCases,
      });

      try {
        const regression = await checkForRegression(run.suiteId, runId, dependencies.store);
        if (regression.isRegression) {
          log.info("api", "TestRunner: Regression detected", {
            suiteId: run.suiteId,
            runId,
            passRateDrop: regression.passRateDrop,
            newlyFailingCount: regression.newlyFailingCases.length,
          });
          await sendRegressionAlert(run.suiteId, runId, regression);
        }
      } catch (error) {
        log.error("api", "TestRunner: Regression handling failed", {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      log.error("api", "Test suite execution failed", {
        error: error instanceof Error ? error.message : String(error),
        runId,
      });

      await dependencies.store.updateRun(runId, {
        status: "failed",
        completedAt: dependencies.now(),
        errorMessage: error instanceof Error ? error.message : "Execution failed",
      });
    } finally {
      lockState?.stop();
      if (lockHandle) {
        await lockHandle.release();
      }

      if (suite) {
        void startNextQueuedRun(suite.id);
      }
    }
  };

  const startNextQueuedRun = async (suiteId: string): Promise<void> => {
    const nextRun = await dependencies.store.findPendingRun(suiteId);
    if (!nextRun) return;

    const lockHandle = await dependencies.lockManager.acquire(suiteId, nextRun.id);
    if (!lockHandle.acquired) return;

    void executeTestRun(nextRun.id, lockHandle);
  };

  return { runTestSuite, executeTestRun };
}

export const { runTestSuite, executeTestRun } = createTestRunner();

// =========================================================================
// Regression detection
// =========================================================================

export async function checkForRegression(
  suiteId: string,
  currentRunId: string,
  store: TestRunnerStore
): Promise<RegressionInfo> {
  const emptyResult: RegressionInfo = {
    isRegression: false,
    previousPassRate: 0,
    currentPassRate: 0,
    passRateDrop: 0,
    newlyFailingCases: [],
  };

  const currentRun = await store.getRun(currentRunId);
  if (!currentRun || currentRun.status !== "completed") {
    return emptyResult;
  }

  const totalCounted = (currentRun.totalCases ?? 0) - (currentRun.skippedCases ?? 0);
  if (totalCounted <= 0) {
    return emptyResult;
  }

  const previousRun = await store.getPreviousCompletedRun(suiteId, currentRun.createdAt);
  if (!previousRun) {
    return emptyResult;
  }

  const currentPassRate = calculatePassRate(currentRun);
  const previousPassRate = calculatePassRate(previousRun);
  const passRateDrop = previousPassRate - currentPassRate;

  const suite = await store.getSuite(suiteId);
  if (!suite?.alertOnRegression) {
    return {
      ...emptyResult,
      previousPassRate,
      currentPassRate,
      passRateDrop,
    };
  }

  const newlyFailingCases = await findNewlyFailingCases(
    currentRunId,
    previousRun.id,
    store
  );
  const thresholdExceeded = passRateDrop >= suite.alertThresholdPercent;
  const isRegression = thresholdExceeded || newlyFailingCases.length > 0;

  return {
    isRegression,
    previousPassRate,
    currentPassRate,
    passRateDrop,
    newlyFailingCases,
  };
}

async function sendRegressionAlert(
  suiteId: string,
  runId: string,
  regression: RegressionInfo
): Promise<void> {
  const suiteRows = await db
    .select({
      suiteId: agentTestSuites.id,
      suiteName: agentTestSuites.name,
      agentId: agents.id,
      agentName: agents.name,
      tenantId: tenants.id,
      tenantName: tenants.name,
    })
    .from(agentTestSuites)
    .innerJoin(agents, eq(agents.id, agentTestSuites.agentId))
    .innerJoin(tenants, eq(tenants.id, agentTestSuites.tenantId))
    .where(and(eq(agentTestSuites.id, suiteId), isNull(agentTestSuites.deletedAt)))
    .limit(1);

  const suite = suiteRows[0];
  if (!suite) {
    log.debug("api", "TestRunner: Regression alert skipped (suite not found)", { suiteId, runId });
    return;
  }

  const recipients = await getRegressionAlertRecipients(suite.tenantId);
  if (recipients.length === 0) {
    log.debug("api", "TestRunner: Regression alert skipped (no recipients)", { suiteId, runId });
    return;
  }

  const runUrl = buildRunUrl(suite.agentId, suite.suiteId, runId);
  const result = await emailService.sendTestRegressionAlert(recipients, {
    tenantName: suite.tenantName,
    agentName: suite.agentName,
    suiteName: suite.suiteName,
    runId,
    previousPassRate: regression.previousPassRate,
    currentPassRate: regression.currentPassRate,
    passRateDrop: regression.passRateDrop,
    newlyFailingCases: regression.newlyFailingCases,
    runUrl,
  });

  if (result.success) {
    log.info("api", "TestRunner: Sent regression alert", {
      suiteId,
      runId,
      recipientCount: recipients.length,
    });
  } else {
    log.error("api", "TestRunner: Regression alert failed", {
      suiteId,
      runId,
      error: result.error,
    });
  }
}

async function getRegressionAlertRecipients(tenantId: string): Promise<string[]> {
  const systemSettings = await getAlertSettings();
  if (!systemSettings.enabled) {
    return [];
  }

  const tenantSettings = await db.query.tenantAlertSettings.findFirst({
    where: eq(tenantAlertSettings.tenantId, tenantId),
  });
  const resolved = resolveAlertSettings(tenantSettings ?? null, {
    errorRateThreshold: systemSettings.errorRateThreshold,
    quotaWarningThreshold: systemSettings.quotaWarningThreshold,
    inactivityDays: systemSettings.inactivityDays,
  });

  if (!resolved.enabled) {
    return [];
  }

  const memberships = await db
    .select({
      role: tenantMemberships.role,
      email: users.primaryEmail,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        inArray(tenantMemberships.role, ["owner", "admin"]),
        isNull(tenantMemberships.deletedAt)
      )
    );

  const recipients: string[] = [];
  if (resolved.notifyOwners) {
    recipients.push(
      ...memberships
        .filter((member) => member.role === "owner" && member.email)
        .map((member) => member.email as string)
    );
  }

  if (resolved.notifyAdmins) {
    recipients.push(
      ...memberships
        .filter((member) => member.role === "admin" && member.email)
        .map((member) => member.email as string)
    );
  }

  recipients.push(...parseAdditionalEmails(resolved.additionalEmails));

  return [...new Set(recipients.filter(Boolean))];
}

function buildRunUrl(agentId: string, suiteId: string, runId: string): string {
  const baseUrl = getAppBaseUrl();
  return `${baseUrl}/agents/${agentId}/test-suites/${suiteId}/runs/${runId}`;
}

function getAppBaseUrl(): string {
  const appUrl = getEnv("APP_URL", "").trim();
  if (appUrl) {
    return appUrl.replace(/\/+$/, "");
  }

  const corsOrigin = getEnv("CORS_ORIGINS", "")
    .split(",")
    .map((origin) => origin.trim())
    .find((origin) => origin && origin !== "*");

  if (corsOrigin) {
    return corsOrigin.replace(/\/+$/, "");
  }

  return DEFAULT_APP_URL;
}

function calculatePassRate(run: TestSuiteRun): number {
  const totalCounted = (run.totalCases ?? 0) - (run.skippedCases ?? 0);
  if (totalCounted <= 0) return 100;
  return (run.passedCases / totalCounted) * 100;
}

async function findNewlyFailingCases(
  currentRunId: string,
  previousRunId: string,
  store: TestRunnerStore
): Promise<
  Array<{
    testCaseId: string;
    testCaseName: string;
    question: string;
  }>
> {
  const [currentResults, previousResults] = await Promise.all([
    store.getTestCaseResultsForRun(currentRunId, { includeTestCase: true }),
    store.getTestCaseResultsForRun(previousRunId),
  ]);

  const previousStatusMap = new Map(
    previousResults.map((result) => [result.testCaseId, result.status])
  );

  return currentResults
    .filter((result) => {
      const previousStatus = previousStatusMap.get(result.testCaseId);
      return previousStatus === "passed" && result.status === "failed";
    })
    .map((result) => ({
      testCaseId: result.testCaseId,
      testCaseName: result.testCase?.name ?? "",
      question: result.testCase?.question ?? "",
    }));
}

// ============================================================================
// Evaluation helpers
// =========================================================================

interface EvaluationContext {
  embeddingModelId: string | null;
  llmModel: LlmModel | null;
}

function getMissingModelError(
  expectedBehavior: ExpectedBehavior,
  context: EvaluationContext
): string | null {
  const needsEmbedding = expectedBehavior.checks.some(
    (check) => check.type === "semantic_similarity"
  );
  if (needsEmbedding && !context.embeddingModelId) {
    return "Embedding model not configured for agent knowledge base";
  }

  const needsJudge = expectedBehavior.checks.some((check) => check.type === "llm_judge");
  if (needsJudge && !context.llmModel) {
    return "LLM judge model not configured for test suite";
  }

  return null;
}

export async function evaluateContainsPhrases(
  response: string,
  check: { type: "contains_phrases"; phrases: string[]; caseSensitive?: boolean }
): Promise<CheckResult> {
  const normalizedResponse = check.caseSensitive ? response : response.toLowerCase();
  const matchedPhrases: string[] = [];
  const missingPhrases: string[] = [];

  for (const phrase of check.phrases) {
    const normalizedPhrase = check.caseSensitive ? phrase : phrase.toLowerCase();
    if (normalizedResponse.includes(normalizedPhrase)) {
      matchedPhrases.push(phrase);
    } else {
      missingPhrases.push(phrase);
    }
  }

  return {
    checkIndex: 0,
    checkType: "contains_phrases",
    passed: missingPhrases.length === 0,
    details: { matchedPhrases, missingPhrases },
  };
}

export async function evaluateSemanticSimilarity(
  response: string,
  check: { type: "semantic_similarity"; expectedAnswer: string; threshold: number },
  embeddingModelId: string
): Promise<CheckResult> {
  const [responseEmbedding, expectedEmbedding] = await Promise.all([
    generateEmbedding(response, embeddingModelId),
    generateEmbedding(check.expectedAnswer, embeddingModelId),
  ]);

  const similarity = cosineSimilarity(responseEmbedding.embedding, expectedEmbedding.embedding);

  return {
    checkIndex: 0,
    checkType: "semantic_similarity",
    passed: similarity >= check.threshold,
    details: { similarityScore: similarity, threshold: check.threshold },
  };
}

export async function evaluateLlmJudge(
  question: string,
  response: string,
  check: { type: "llm_judge"; expectedAnswer: string; criteria?: string },
  model: NonNullable<LlmModel>
): Promise<CheckResult> {
  const systemPrompt =
    "You are a strict evaluator. Respond with ONLY a valid JSON object. No markdown, no code fences, no extra text.";
  const prompt = `You are evaluating an AI assistant's response.

Question asked: ${question}

Expected answer (or key points): ${check.expectedAnswer}

${check.criteria ? `Evaluation criteria: ${check.criteria}` : ""}

Actual response: ${response}

Does the actual response adequately address the question and align with the expected answer?

Respond with JSON:
{
  "passed": true/false,
  "reasoning": "Brief explanation of your judgement"
}`;

  const parseJudgeResponse = (text: string) => {
    const parsed = safeParseJson(text);
    if (!parsed || parsed.passed === undefined) return null;
    const passedValue = typeof parsed.passed === "string" ? parsed.passed.toLowerCase() : parsed.passed;
    if (passedValue !== true && passedValue !== false) return null;
    return {
      passed: passedValue === true,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  };

  const runJudge = async (overridePrompt?: string) =>
    generateText({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: overridePrompt ?? prompt },
      ],
      maxOutputTokens: 256,
      temperature: 0,
    });

  const result = await runJudge();
  let parsed = parseJudgeResponse(result.text);

  if (!parsed) {
    const retryPrompt = `${prompt}\n\nReturn ONLY JSON. Example: {"passed": true, "reasoning": "..."}`;
    const retryResult = await runJudge(retryPrompt);
    parsed = parseJudgeResponse(retryResult.text);
  }

  if (!parsed) {
    return {
      checkIndex: 0,
      checkType: "llm_judge",
      passed: false,
      details: { judgement: "error", reasoning: "Invalid JSON response from judge model" },
    };
  }

  return {
    checkIndex: 0,
    checkType: "llm_judge",
    passed: parsed.passed,
    details: {
      judgement: parsed.passed ? "pass" : "fail",
      reasoning: parsed.reasoning,
    },
  };
}

export async function evaluateResponse(
  question: string,
  response: string,
  expectedBehavior: ExpectedBehavior,
  context: EvaluationContext
): Promise<{ passed: boolean; checkResults: CheckResult[] }> {
  const checkResults: CheckResult[] = [];

  for (let i = 0; i < expectedBehavior.checks.length; i += 1) {
    const check = expectedBehavior.checks[i];
    let result: CheckResult;

    switch (check.type) {
      case "contains_phrases":
        result = await evaluateContainsPhrases(response, check);
        break;
      case "semantic_similarity":
        if (!context.embeddingModelId) {
          throw new Error("Embedding model required");
        }
        result = await evaluateSemanticSimilarity(response, check, context.embeddingModelId);
        break;
      case "llm_judge":
        if (!context.llmModel) {
          throw new Error("LLM judge model required");
        }
        result = await evaluateLlmJudge(question, response, check, context.llmModel);
        break;
    }

    result.checkIndex = i;
    checkResults.push(result);
  }

  const passed =
    expectedBehavior.mode === "all"
      ? checkResults.every((result) => result.passed)
      : checkResults.some((result) => result.passed);

  return { passed, checkResults };
}

async function getCaseResponse(
  tenantId: string,
  agentId: string,
  question: string
): Promise<string> {
  const service = new SimpleRAGService(tenantId, agentId);
  let response = "";

  for await (const event of service.chat(question)) {
    if (event.type === "text") {
      response += event.content;
    }
    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  return response;
}

export function safeParseJson(value: string): any | null {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) {
    const passedMatch = value.match(/passed\s*[:=]\s*(true|false)/i);
    if (!passedMatch) return null;
    const reasoningMatch = value.match(/reasoning\s*[:=]\s*"?([^\n"}]+)"?/i);
    return {
      passed: passedMatch[1].toLowerCase() === "true",
      reasoning: reasoningMatch ? reasoningMatch[1].trim() : "",
    };
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}
