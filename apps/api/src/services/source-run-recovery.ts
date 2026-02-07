import { eq, and, lt, inArray } from "drizzle-orm";
import { db } from "@grounded/db";
import { sourceRuns, uploads } from "@grounded/db/schema";
import { redis, removeAllJobsForRun, unregisterRun } from "@grounded/queue";
import { createCrawlState } from "@grounded/crawl-state";
import { log } from "@grounded/logger";

// How often to scan for stuck source runs
const RECOVERY_INTERVAL_MS = 60 * 1000; // Every 60 seconds

// A source run with no progress for this long is considered stuck.
// Uses startedAt — if the run has been "running" for longer than this
// without completing, it's almost certainly dead.
const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

let recoveryInterval: NodeJS.Timeout | null = null;

/**
 * Recovers stuck source runs on startup and periodically.
 *
 * Handles cases where:
 * 1. A worker crashed while processing a source run
 * 2. A stage transition counter got out of sync (completed + failed < total)
 * 3. The finalize job failed after all retries
 * 4. Redis state was lost (e.g., restart) while a run was in progress
 *
 * Detection heuristic:
 * - Run has status = "running"
 * - startedAt is older than STUCK_THRESHOLD_MS
 *
 * Recovery action:
 * - Mark the run as "failed" with an error message
 * - Clean up BullMQ jobs, fairness scheduler slots, and crawl state in Redis
 */
export async function recoverStuckSourceRuns(): Promise<void> {
  try {
    const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);

    // Find source runs that have been "running" for too long
    const stuckRuns = await db.query.sourceRuns.findMany({
      where: and(
        eq(sourceRuns.status, "running"),
        lt(sourceRuns.startedAt, threshold)
      ),
      columns: {
        id: true,
        sourceId: true,
        tenantId: true,
        status: true,
        stage: true,
        startedAt: true,
        stats: true,
        stageTotal: true,
        stageCompleted: true,
        stageFailed: true,
      },
    });

    if (stuckRuns.length === 0) {
      return;
    }

    log.info("api", `Found ${stuckRuns.length} stuck source run(s), recovering...`);

    let recoveredCount = 0;

    for (const run of stuckRuns) {
      try {
        const timeSinceStart = run.startedAt
          ? Date.now() - run.startedAt.getTime()
          : Infinity;

        log.warn("api", "Recovering stuck source run", {
          runId: run.id,
          sourceId: run.sourceId,
          tenantId: run.tenantId,
          stage: run.stage,
          timeSinceStartMs: timeSinceStart,
          stageProgress: `${run.stageCompleted + run.stageFailed}/${run.stageTotal}`,
          stats: run.stats,
        });

        // 1. Mark the run as failed in the database
        await db
          .update(sourceRuns)
          .set({
            status: "failed",
            finishedAt: new Date(),
            error: "Run timed out — no progress detected. The worker may have crashed or a stage transition was missed.",
          })
          .where(
            and(
              eq(sourceRuns.id, run.id),
              // Only update if still "running" to avoid race with normal completion
              eq(sourceRuns.status, "running")
            )
          );

        // 1b. Mark associated uploads as failed
        await db
          .update(uploads)
          .set({ status: "failed" })
          .where(eq(uploads.sourceRunId, run.id));

        // 2. Clean up BullMQ jobs and fairness scheduler (async, best-effort)
        try {
          const [removed] = await Promise.all([
            removeAllJobsForRun(run.id),
            unregisterRun(run.id),
          ]);

          if (removed.total > 0) {
            log.info("api", "Cleaned up pending jobs for recovered run", {
              runId: run.id,
              removedJobs: removed,
            });
          }
        } catch (cleanupError) {
          log.error("api", "Failed to clean up jobs for recovered run", {
            runId: run.id,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }

        // 3. Clean up crawl state in Redis (best-effort)
        try {
          const crawlState = createCrawlState(redis, run.id);
          await crawlState.cleanup();
        } catch (crawlError) {
          log.error("api", "Failed to clean up crawl state for recovered run", {
            runId: run.id,
            error: crawlError instanceof Error ? crawlError.message : String(crawlError),
          });
        }

        recoveredCount++;
      } catch (runError) {
        log.error("api", "Failed to recover stuck source run", {
          runId: run.id,
          error: runError instanceof Error ? runError.message : String(runError),
        });
      }
    }

    if (recoveredCount > 0) {
      log.info("api", `Recovered ${recoveredCount} stuck source run(s)`);
    }
  } catch (error) {
    log.error("api", "Source run recovery scan failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Start the periodic source run recovery process.
 */
export function startSourceRunRecovery(): void {
  if (recoveryInterval) {
    return; // Already running
  }

  log.info("api", "Starting periodic source run recovery", {
    intervalMs: RECOVERY_INTERVAL_MS,
    stuckThresholdMs: STUCK_THRESHOLD_MS,
  });

  recoveryInterval = setInterval(async () => {
    try {
      await recoverStuckSourceRuns();
    } catch (error) {
      log.error("api", "Periodic source run recovery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, RECOVERY_INTERVAL_MS);
}

/**
 * Stop the periodic source run recovery process.
 */
export function stopSourceRunRecovery(): void {
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
    log.info("api", "Stopped periodic source run recovery");
  }
}
