import { eq, inArray, and, lt } from "drizzle-orm";
import { db } from "@grounded/db";
import { testSuiteRuns, testRunExperiments, agentTestSuites } from "@grounded/db/schema";
import { redis } from "@grounded/queue";
import { log } from "@grounded/logger";

const LOCK_KEY_PREFIX = "test-suite:run-lock:";
const RECOVERY_INTERVAL_MS = 30 * 1000; // Check every 30 seconds
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // Consider stuck after 5 minutes

let recoveryInterval: NodeJS.Timeout | null = null;

/**
 * Recovers orphaned test suite locks on startup and periodically.
 * 
 * This handles cases where:
 * 1. The API was restarted while a test was running
 * 2. A process crashed without releasing its lock
 * 3. A lock TTL was set too long and the process died
 * 4. A run is stuck in "running" state without progress
 */
export async function recoverOrphanedLocks(): Promise<void> {
  try {
    log.info("api", "Checking for orphaned test suite locks...");

    // Find all test suite run locks in Redis
    const lockKeys = await redis.keys(`${LOCK_KEY_PREFIX}*`);
    
    if (lockKeys.length === 0) {
      log.info("api", "No test suite locks found");
      return;
    }

    log.info("api", `Found ${lockKeys.length} test suite lock(s), validating...`);

    let recoveredCount = 0;

    for (const lockKey of lockKeys) {
      const runId = await redis.get(lockKey);
      if (!runId) continue;

      // Check if the run is actually still running
      const run = await db.query.testSuiteRuns.findFirst({
        where: eq(testSuiteRuns.id, runId),
        columns: { id: true, status: true, suiteId: true, startedAt: true, totalCases: true, passedCases: true, failedCases: true },
      });

      if (!run) {
        // Run doesn't exist, clear the lock
        log.warn("api", "Clearing orphaned lock - run not found", { lockKey, runId });
        await redis.del(lockKey);
        recoveredCount++;
        continue;
      }

      // Check if the run is in a terminal or non-running state
      const isRunning = run.status === "running";
      
      if (!isRunning) {
        // Run is not actually running (completed, failed, cancelled, or still pending)
        log.warn("api", "Clearing orphaned lock - run not in running state", {
          lockKey,
          runId,
          status: run.status,
        });
        await redis.del(lockKey);
        recoveredCount++;
        continue;
      }

      // Check if the run has been "running" for too long
      // This catches cases where the execution process died but the status wasn't updated
      if (run.startedAt) {
        const timeSinceStart = Date.now() - run.startedAt.getTime();
        const completedCases = run.passedCases + run.failedCases;
        const remainingCases = run.totalCases - completedCases;
        
        // If run has been going for > 5 minutes and still has remaining cases, 
        // check if it's making progress. Allow ~2 min per case as generous estimate.
        const maxExpectedTimeMs = Math.max(STUCK_THRESHOLD_MS, remainingCases * 2 * 60 * 1000);
        
        if (timeSinceStart > maxExpectedTimeMs) {
          log.warn("api", "Clearing orphaned lock - run stuck without progress", {
            lockKey,
            runId,
            status: run.status,
            timeSinceStartMs: timeSinceStart,
            completedCases,
            totalCases: run.totalCases,
          });
          
          // Mark the run as failed
          await db
            .update(testSuiteRuns)
            .set({
              status: "failed",
              completedAt: new Date(),
              errorMessage: "Run timed out - no progress detected",
            })
            .where(eq(testSuiteRuns.id, runId));
          
          await redis.del(lockKey);
          recoveredCount++;
        }
      }
    }

    if (recoveredCount > 0) {
      log.info("api", `Recovered ${recoveredCount} orphaned lock(s)`);
    }

    // Also recover any experiments stuck in non-terminal states
    await recoverStuckExperiments();

  } catch (error) {
    log.error("api", "Failed to recover orphaned locks", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Recover experiments that were interrupted mid-flow.
 */
async function recoverStuckExperiments(): Promise<void> {
  try {
    // Find experiments in non-terminal states that have been stuck for > 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const stuckExperiments = await db.query.testRunExperiments.findMany({
      where: inArray(testRunExperiments.status, [
        "pending",
        "baseline_running", 
        "analyzing",
        "candidate_running",
      ]),
    });

    for (const exp of stuckExperiments) {
      // Check if created more than 1 hour ago (likely stuck)
      if (exp.createdAt < oneHourAgo) {
        log.warn("api", "Marking stuck experiment as failed", {
          experimentId: exp.id,
          status: exp.status,
          createdAt: exp.createdAt,
        });

        await db
          .update(testRunExperiments)
          .set({ status: "failed" })
          .where(eq(testRunExperiments.id, exp.id));
      }
    }
  } catch (error) {
    log.error("api", "Failed to recover stuck experiments", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Validate a lock before honoring it.
 * Returns true if the lock is valid, false if it should be ignored.
 */
export async function validateLock(suiteId: string): Promise<boolean> {
  const lockKey = `${LOCK_KEY_PREFIX}${suiteId}`;
  const runId = await redis.get(lockKey);
  
  if (!runId) {
    // No lock exists
    return true;
  }

  // Check if the locked run is actually still running
  const run = await db.query.testSuiteRuns.findFirst({
    where: eq(testSuiteRuns.id, runId),
    columns: { status: true },
  });

  if (!run || run.status !== "running") {
    // Lock is orphaned, clear it
    log.warn("api", "Clearing invalid lock during validation", {
      suiteId,
      runId,
      status: run?.status,
    });
    await redis.del(lockKey);
    return true;
  }

  // Lock is valid - another run is actually in progress
  return false;
}

/**
 * Resume pending runs that are part of experiments but got stuck.
 * This handles the case where the API restarted mid-experiment.
 */
async function resumeStuckExperimentRuns(): Promise<void> {
  try {
    const stuckThreshold = new Date(Date.now() - STUCK_THRESHOLD_MS);

    // Find runs that are pending but part of an experiment and older than threshold
    const pendingRuns = await db.query.testSuiteRuns.findMany({
      where: and(
        eq(testSuiteRuns.status, "pending"),
        lt(testSuiteRuns.createdAt, stuckThreshold)
      ),
      columns: { id: true, suiteId: true, experimentId: true, createdAt: true, promptVariant: true },
    });

    if (pendingRuns.length === 0) {
      return;
    }

    for (const run of pendingRuns) {
      if (!run.experimentId) continue;

      const lockKey = `${LOCK_KEY_PREFIX}${run.suiteId}`;
      const lockExists = await redis.exists(lockKey);

      if (!lockExists) {
        // No lock - try to acquire and execute
        log.info("api", "Found stuck experiment run, attempting to resume", {
          runId: run.id,
          experimentId: run.experimentId,
          suiteId: run.suiteId,
          promptVariant: run.promptVariant,
          age: Date.now() - run.createdAt.getTime(),
        });

        // Try to acquire lock
        const acquired = await redis.set(lockKey, run.id, "PX", 45 * 60 * 1000, "NX");

        if (acquired) {
          // Get the experiment and suite details
          const experiment = await db.query.testRunExperiments.findFirst({
            where: eq(testRunExperiments.id, run.experimentId),
          });

          const suite = await db.query.agentTestSuites.findFirst({
            where: eq(agentTestSuites.id, run.suiteId),
          });

          if (experiment && suite) {
            // Import and execute
            const { executeBaselineAndContinue } = await import("./ab-experiment");
            
            log.info("api", "Resuming stuck experiment", {
              experimentId: run.experimentId,
              runId: run.id,
            });

            // Execute in background
            void executeBaselineAndContinue(run.experimentId, run.id, suite);
          } else {
            // Release lock if we can't find experiment/suite
            await redis.del(lockKey);
            log.warn("api", "Could not find experiment or suite for stuck run", {
              runId: run.id,
              experimentId: run.experimentId,
            });
          }
        }
      }
    }
  } catch (error) {
    log.error("api", "Failed to resume stuck experiment runs", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Start the periodic recovery process.
 * This runs in the background and checks for stuck experiments/locks.
 */
export function startPeriodicRecovery(): void {
  if (recoveryInterval) {
    return; // Already running
  }

  log.info("api", "Starting periodic lock recovery", {
    intervalMs: RECOVERY_INTERVAL_MS,
    stuckThresholdMs: STUCK_THRESHOLD_MS,
  });

  recoveryInterval = setInterval(async () => {
    try {
      await recoverOrphanedLocks();
      await resumeStuckExperimentRuns();
    } catch (error) {
      log.error("api", "Periodic recovery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, RECOVERY_INTERVAL_MS);
}

/**
 * Stop the periodic recovery process.
 */
export function stopPeriodicRecovery(): void {
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
    log.info("api", "Stopped periodic lock recovery");
  }
}
