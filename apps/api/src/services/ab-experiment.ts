import { and, desc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@grounded/db";
import {
  testRunExperiments,
  testSuiteRuns,
  testRunPromptAnalyses,
  agentTestSuites,
  agents,
} from "@grounded/db/schema";
import { log } from "@grounded/logger";
import { runPromptAnalysis } from "./prompt-analysis";
import { runTestSuite, executeTestRun } from "./test-runner";
import { redis } from "@grounded/queue";

// ============================================================================
// Types
// ============================================================================

type TestRunExperiment = InferSelectModel<typeof testRunExperiments>;
type TestSuite = InferSelectModel<typeof agentTestSuites>;

export interface StartExperimentResult {
  experimentId: string;
  baselineRunId: string;
  status: "started" | "queued" | "error";
  error?: string;
}

export interface ExperimentComparison {
  experiment: TestRunExperiment;
  baseline: {
    runId: string;
    passRate: number;
    passedCases: number;
    failedCases: number;
    totalCases: number;
    systemPrompt: string | null;
  } | null;
  candidate: {
    runId: string;
    passRate: number;
    passedCases: number;
    failedCases: number;
    totalCases: number;
    systemPrompt: string | null;
  } | null;
  delta: {
    passRate: number;
    passedCases: number;
    failedCases: number;
  } | null;
}

// ============================================================================
// Experiment Lifecycle
// ============================================================================

/**
 * Start an experiment with a specific candidate prompt (bypasses manual/suggested lookup)
 */
export async function startExperimentWithPrompt(
  suiteId: string,
  candidatePrompt: string,
  triggeredBy: "manual" | "schedule",
  userId?: string
): Promise<StartExperimentResult> {
  const suite = await db.query.agentTestSuites.findFirst({
    where: eq(agentTestSuites.id, suiteId),
  });

  if (!suite) {
    return { experimentId: "", baselineRunId: "", status: "error", error: "Suite not found" };
  }

  // Create the experiment record with the candidate prompt pre-set
  const [experiment] = await db
    .insert(testRunExperiments)
    .values({
      tenantId: suite.tenantId,
      suiteId: suite.id,
      status: "pending",
      candidateSource: "manual",
      candidatePrompt,
    })
    .returning();

  log.info("api", "Starting A/B experiment with custom prompt", {
    experimentId: experiment.id,
    suiteId,
    promptLength: candidatePrompt.length,
  });

  // Start the baseline run
  const baselineResult = await startBaselineRun(experiment.id, suite, triggeredBy, userId);

  if (baselineResult.status === "error") {
    await db
      .update(testRunExperiments)
      .set({ status: "failed" })
      .where(eq(testRunExperiments.id, experiment.id));

    return {
      experimentId: experiment.id,
      baselineRunId: "",
      status: "error",
      error: baselineResult.error,
    };
  }

  return {
    experimentId: experiment.id,
    baselineRunId: baselineResult.runId,
    status: baselineResult.status,
  };
}

export async function startExperiment(
  suiteId: string,
  triggeredBy: "manual" | "schedule",
  userId?: string
): Promise<StartExperimentResult> {
  const suite = await db.query.agentTestSuites.findFirst({
    where: eq(agentTestSuites.id, suiteId),
  });

  if (!suite) {
    return { experimentId: "", baselineRunId: "", status: "error", error: "Suite not found" };
  }

  if (!suite.abTestingEnabled) {
    return { experimentId: "", baselineRunId: "", status: "error", error: "A/B testing is not enabled for this suite" };
  }

  // Create the experiment record
  const [experiment] = await db
    .insert(testRunExperiments)
    .values({
      tenantId: suite.tenantId,
      suiteId: suite.id,
      status: "pending",
    })
    .returning();

  log.info("api", "Starting A/B experiment", {
    experimentId: experiment.id,
    suiteId,
  });

  // Start the baseline run
  const baselineResult = await startBaselineRun(experiment.id, suite, triggeredBy, userId);

  if (baselineResult.status === "error") {
    await db
      .update(testRunExperiments)
      .set({ status: "failed" })
      .where(eq(testRunExperiments.id, experiment.id));

    return {
      experimentId: experiment.id,
      baselineRunId: "",
      status: "error",
      error: baselineResult.error,
    };
  }

  return {
    experimentId: experiment.id,
    baselineRunId: baselineResult.runId,
    status: baselineResult.status,
  };
}

async function startBaselineRun(
  experimentId: string,
  suite: TestSuite,
  triggeredBy: "manual" | "schedule",
  userId?: string
): Promise<{ runId: string; status: "started" | "queued" | "error"; error?: string }> {
  // Create the baseline run record directly with experiment linkage
  const [baselineRun] = await db
    .insert(testSuiteRuns)
    .values({
      suiteId: suite.id,
      tenantId: suite.tenantId,
      triggeredBy,
      triggeredByUserId: userId ?? null,
      promptVariant: "baseline",
      experimentId,
    })
    .returning();

  // Update experiment with baseline run ID
  await db
    .update(testRunExperiments)
    .set({
      baselineRunId: baselineRun.id,
      status: "baseline_running",
    })
    .where(eq(testRunExperiments.id, experimentId));

  // Try to acquire lock and execute
  const lockKey = `test-suite:run-lock:${suite.id}`;
  const acquired = await redis.set(lockKey, baselineRun.id, "PX", 45 * 60 * 1000, "NX");

  if (!acquired) {
    // Lock not acquired - poll until the run can be executed
    // Start polling in background and continue the experiment when the run completes
    void pollAndContinueExperiment(experimentId, baselineRun.id, suite, lockKey);
    return { runId: baselineRun.id, status: "queued" };
  }

  // Start execution in background
  void executeBaselineAndContinue(experimentId, baselineRun.id, suite);

  return { runId: baselineRun.id, status: "started" };
}

/**
 * Poll for run completion when lock couldn't be acquired immediately.
 * This handles the case where another run was in progress when the experiment started.
 */
async function pollAndContinueExperiment(
  experimentId: string,
  runId: string,
  suite: TestSuite,
  lockKey: string
): Promise<void> {
  const MAX_POLL_TIME_MS = 60 * 60 * 1000; // 1 hour max
  const POLL_INTERVAL_MS = 5000; // Check every 5 seconds
  const startTime = Date.now();

  log.info("api", "Polling for experiment lock", { experimentId, runId, suiteId: suite.id });

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    // Try to acquire lock
    const acquired = await redis.set(lockKey, runId, "PX", 45 * 60 * 1000, "NX");

    if (acquired) {
      log.info("api", "Acquired lock for experiment, continuing", { experimentId, runId });
      await executeBaselineAndContinue(experimentId, runId, suite);
      return;
    }

    // Check if the run was executed by the normal test runner queue
    const run = await db.query.testSuiteRuns.findFirst({
      where: eq(testSuiteRuns.id, runId),
    });

    if (run && run.status !== "pending") {
      // Run already started or completed by another process
      if (run.status === "completed") {
        log.info("api", "Baseline run completed externally, continuing experiment", {
          experimentId,
          runId,
        });
        // Continue with the rest of the experiment (analysis + candidate)
        await continueExperimentAfterBaseline(experimentId, runId, suite);
        return;
      } else if (run.status === "running") {
        // Wait for it to complete
        log.info("api", "Baseline run already running, waiting for completion", {
          experimentId,
          runId,
        });
      } else if (run.status === "failed" || run.status === "cancelled") {
        log.warn("api", "Baseline run failed/cancelled", { experimentId, runId, status: run.status });
        await db
          .update(testRunExperiments)
          .set({ status: "failed" })
          .where(eq(testRunExperiments.id, experimentId));
        return;
      }
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // Timed out waiting for lock
  log.error("api", "Experiment timed out waiting for lock", { experimentId, runId });
  await db
    .update(testRunExperiments)
    .set({ status: "failed" })
    .where(eq(testRunExperiments.id, experimentId));
}

/**
 * Continue experiment after baseline run completed (called when run was executed externally).
 */
async function continueExperimentAfterBaseline(
  experimentId: string,
  baselineRunId: string,
  suite: TestSuite
): Promise<void> {
  try {
    const baselineRun = await db.query.testSuiteRuns.findFirst({
      where: eq(testSuiteRuns.id, baselineRunId),
    });

    if (!baselineRun || baselineRun.status !== "completed") {
      await db
        .update(testRunExperiments)
        .set({ status: "failed" })
        .where(eq(testRunExperiments.id, experimentId));
      return;
    }

    // Fetch the experiment to check for pre-set candidate prompt
    const experiment = await db.query.testRunExperiments.findFirst({
      where: eq(testRunExperiments.id, experimentId),
    });

    if (!experiment) {
      log.error("api", "Experiment not found during continuation", { experimentId });
      return;
    }

    // Update experiment status to analyzing
    await db
      .update(testRunExperiments)
      .set({ status: "analyzing" })
      .where(eq(testRunExperiments.id, experimentId));

    // Always run prompt analysis if enabled (provides valuable failure insights)
    // This runs regardless of whether we already have a candidate prompt
    if (suite.promptAnalysisEnabled) {
      try {
        log.info("api", "Running prompt analysis for experiment continuation", {
          experimentId,
          baselineRunId,
          hasPresetPrompt: !!experiment.candidatePrompt,
        });
        await runPromptAnalysis(baselineRunId, {
          modelConfigId: suite.analysisModelConfigId,
        });
      } catch (error) {
        log.error("api", "Prompt analysis failed during experiment continuation", {
          experimentId,
          baselineRunId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with experiment even if analysis fails
      }
    }

    // Determine candidate prompt source:
    // 1. First check if experiment already has a candidatePrompt (from startExperimentWithPrompt)
    // 2. Then use the analysis suggested prompt if available
    let candidatePrompt: string | null = null;
    let candidateSource: "analysis" | "manual" = "manual";

    if (experiment.candidatePrompt) {
      // Candidate prompt was pre-set (e.g., from "Test Prompt" dialog)
      candidatePrompt = experiment.candidatePrompt;
      candidateSource = experiment.candidateSource ?? "manual";
      log.info("api", "Using pre-set candidate prompt from experiment", {
        experimentId,
        candidateSource,
      });
    } else if (suite.promptAnalysisEnabled) {
      // Try to get the suggested prompt from the analysis we just ran
      const analysis = await db.query.testRunPromptAnalyses.findFirst({
        where: eq(testRunPromptAnalyses.runId, baselineRunId),
        orderBy: [desc(testRunPromptAnalyses.createdAt)],
      });
      if (analysis?.suggestedPrompt) {
        candidatePrompt = analysis.suggestedPrompt;
        candidateSource = "analysis";
      }
    }

    if (!candidatePrompt) {
      log.info("api", "No candidate prompt available, completing experiment", {
        experimentId,
      });
      await db
        .update(testRunExperiments)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(testRunExperiments.id, experimentId));
      return;
    }

    // Update experiment with candidate info (only if not already set)
    if (!experiment.candidatePrompt) {
      await db
        .update(testRunExperiments)
        .set({
          candidateSource,
          candidatePrompt,
          status: "candidate_running",
        })
        .where(eq(testRunExperiments.id, experimentId));
    } else {
      await db
        .update(testRunExperiments)
        .set({ status: "candidate_running" })
        .where(eq(testRunExperiments.id, experimentId));
    }

    // Start candidate run
    await startCandidateRun(experimentId, suite, candidatePrompt, baselineRun.triggeredBy);
  } catch (error) {
    log.error("api", "Experiment continuation failed", {
      experimentId,
      baselineRunId,
      error: error instanceof Error ? error.message : String(error),
    });
    await db
      .update(testRunExperiments)
      .set({ status: "failed" })
      .where(eq(testRunExperiments.id, experimentId));
  }
}

export async function executeBaselineAndContinue(
  experimentId: string,
  baselineRunId: string,
  suite: TestSuite
): Promise<void> {
  try {
    // Execute baseline run
    await executeTestRun(baselineRunId);

    // Check if run completed successfully
    const baselineRun = await db.query.testSuiteRuns.findFirst({
      where: eq(testSuiteRuns.id, baselineRunId),
    });

    if (!baselineRun || baselineRun.status !== "completed") {
      log.warn("api", "Baseline run did not complete successfully", {
        experimentId,
        baselineRunId,
        status: baselineRun?.status,
      });
      await db
        .update(testRunExperiments)
        .set({ status: "failed" })
        .where(eq(testRunExperiments.id, experimentId));
      return;
    }

    // Fetch the experiment to check for pre-set candidate prompt (from startExperimentWithPrompt)
    const experiment = await db.query.testRunExperiments.findFirst({
      where: eq(testRunExperiments.id, experimentId),
    });

    if (!experiment) {
      log.error("api", "Experiment not found during continuation", { experimentId });
      return;
    }

    // Update experiment status to analyzing
    await db
      .update(testRunExperiments)
      .set({ status: "analyzing" })
      .where(eq(testRunExperiments.id, experimentId));

    // Always run prompt analysis if enabled (provides valuable failure insights)
    // This runs regardless of whether we already have a candidate prompt
    if (suite.promptAnalysisEnabled) {
      try {
        log.info("api", "Running prompt analysis for experiment", {
          experimentId,
          baselineRunId,
          hasPresetPrompt: !!experiment.candidatePrompt,
        });
        await runPromptAnalysis(baselineRunId, {
          modelConfigId: suite.analysisModelConfigId,
        });
      } catch (error) {
        log.error("api", "Prompt analysis failed during experiment", {
          experimentId,
          baselineRunId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with experiment even if analysis fails
      }
    }

    // Determine candidate prompt source:
    // 1. First check if experiment already has a candidatePrompt (from startExperimentWithPrompt)
    // 2. Then use the analysis suggested prompt if available
    let candidatePrompt: string | null = null;
    let candidateSource: "analysis" | "manual" = "manual";

    if (experiment.candidatePrompt) {
      // Candidate prompt was pre-set (e.g., from "Test Prompt" dialog)
      candidatePrompt = experiment.candidatePrompt;
      candidateSource = experiment.candidateSource ?? "manual";
      log.info("api", "Using pre-set candidate prompt from experiment", {
        experimentId,
        candidateSource,
      });
    } else if (suite.promptAnalysisEnabled) {
      // Try to get the suggested prompt from the analysis we just ran
      const analysis = await db.query.testRunPromptAnalyses.findFirst({
        where: eq(testRunPromptAnalyses.runId, baselineRunId),
        orderBy: [desc(testRunPromptAnalyses.createdAt)],
      });
      if (analysis?.suggestedPrompt) {
        candidatePrompt = analysis.suggestedPrompt;
        candidateSource = "analysis";
      }
    }

    if (!candidatePrompt) {
      log.info("api", "No candidate prompt available, completing experiment", {
        experimentId,
      });
      await db
        .update(testRunExperiments)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(testRunExperiments.id, experimentId));
      return;
    }

    // Update experiment with candidate info (only if not already set)
    if (!experiment.candidatePrompt) {
      await db
        .update(testRunExperiments)
        .set({
          candidateSource,
          candidatePrompt,
          status: "candidate_running",
        })
        .where(eq(testRunExperiments.id, experimentId));
    } else {
      await db
        .update(testRunExperiments)
        .set({ status: "candidate_running" })
        .where(eq(testRunExperiments.id, experimentId));
    }

    // Start candidate run with the candidate prompt
    await startCandidateRun(experimentId, suite, candidatePrompt, baselineRun.triggeredBy);
  } catch (error) {
    log.error("api", "Experiment execution failed", {
      experimentId,
      baselineRunId,
      error: error instanceof Error ? error.message : String(error),
    });
    await db
      .update(testRunExperiments)
      .set({ status: "failed" })
      .where(eq(testRunExperiments.id, experimentId));
  }
}

async function startCandidateRun(
  experimentId: string,
  suite: TestSuite,
  candidatePrompt: string,
  triggeredBy: "manual" | "schedule"
): Promise<void> {
  // Create the candidate run record
  const [candidateRun] = await db
    .insert(testSuiteRuns)
    .values({
      suiteId: suite.id,
      tenantId: suite.tenantId,
      triggeredBy,
      promptVariant: "candidate",
      experimentId,
      systemPrompt: candidatePrompt, // Pre-set the system prompt override
    })
    .returning();

  // Update experiment with candidate run ID
  await db
    .update(testRunExperiments)
    .set({ candidateRunId: candidateRun.id })
    .where(eq(testRunExperiments.id, experimentId));

  // Execute the candidate run
  // Note: The test runner will use the pre-set systemPrompt from the run record
  await executeTestRunWithPromptOverride(candidateRun.id, candidatePrompt, suite);

  // Mark experiment as completed
  await db
    .update(testRunExperiments)
    .set({
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(testRunExperiments.id, experimentId));

  log.info("api", "A/B experiment completed", { experimentId });
}

async function executeTestRunWithPromptOverride(
  runId: string,
  promptOverride: string,
  suite: TestSuite
): Promise<void> {
  // Store the prompt override in redis so the test runner can pick it up
  const overrideKey = `test-run:prompt-override:${runId}`;
  await redis.set(overrideKey, promptOverride, "EX", 3600); // 1 hour expiry

  // Execute the run
  await executeTestRun(runId);

  // Clean up
  await redis.del(overrideKey);
}

// ============================================================================
// Experiment Queries
// ============================================================================

export async function getExperiment(
  experimentId: string
): Promise<TestRunExperiment | null> {
  const experiment = await db.query.testRunExperiments.findFirst({
    where: eq(testRunExperiments.id, experimentId),
  });
  return experiment ?? null;
}

export async function getLatestExperimentForSuite(
  suiteId: string
): Promise<TestRunExperiment | null> {
  const [experiment] = await db
    .select()
    .from(testRunExperiments)
    .where(eq(testRunExperiments.suiteId, suiteId))
    .orderBy(desc(testRunExperiments.createdAt))
    .limit(1);

  return experiment ?? null;
}

export async function getExperimentComparison(
  experimentId: string
): Promise<ExperimentComparison | null> {
  const experiment = await getExperiment(experimentId);
  if (!experiment) return null;

  const calculatePassRate = (run: InferSelectModel<typeof testSuiteRuns>) => {
    const total = run.totalCases - run.skippedCases;
    if (total <= 0) return 0;
    return (run.passedCases / total) * 100;
  };

  let baseline: ExperimentComparison["baseline"] = null;
  let candidate: ExperimentComparison["candidate"] = null;

  if (experiment.baselineRunId) {
    const baselineRun = await db.query.testSuiteRuns.findFirst({
      where: eq(testSuiteRuns.id, experiment.baselineRunId),
    });
    if (baselineRun) {
      baseline = {
        runId: baselineRun.id,
        passRate: calculatePassRate(baselineRun),
        passedCases: baselineRun.passedCases,
        failedCases: baselineRun.failedCases,
        totalCases: baselineRun.totalCases,
        systemPrompt: baselineRun.systemPrompt,
      };
    }
  }

  if (experiment.candidateRunId) {
    const candidateRun = await db.query.testSuiteRuns.findFirst({
      where: eq(testSuiteRuns.id, experiment.candidateRunId),
    });
    if (candidateRun) {
      candidate = {
        runId: candidateRun.id,
        passRate: calculatePassRate(candidateRun),
        passedCases: candidateRun.passedCases,
        failedCases: candidateRun.failedCases,
        totalCases: candidateRun.totalCases,
        systemPrompt: candidateRun.systemPrompt,
      };
    }
  }

  const delta =
    baseline && candidate
      ? {
          passRate: candidate.passRate - baseline.passRate,
          passedCases: candidate.passedCases - baseline.passedCases,
          failedCases: candidate.failedCases - baseline.failedCases,
        }
      : null;

  return { experiment, baseline, candidate, delta };
}

export async function listExperimentsForSuite(
  suiteId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ experiments: TestRunExperiment[]; total: number }> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;

  const experiments = await db
    .select()
    .from(testRunExperiments)
    .where(eq(testRunExperiments.suiteId, suiteId))
    .orderBy(desc(testRunExperiments.createdAt))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ count: db.$count(testRunExperiments) })
    .from(testRunExperiments)
    .where(eq(testRunExperiments.suiteId, suiteId));

  return {
    experiments,
    total: Number(countRow?.count ?? 0),
  };
}

// ============================================================================
// Get prompt override for a run (used by test runner)
// ============================================================================

export async function getPromptOverride(runId: string): Promise<string | null> {
  const overrideKey = `test-run:prompt-override:${runId}`;
  const override = await redis.get(overrideKey);
  return override;
}
