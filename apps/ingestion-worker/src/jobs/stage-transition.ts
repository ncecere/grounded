/**
 * Stage Transition Processor
 * 
 * Handles the transition between stages in the sequential ingestion pipeline.
 * When a stage completes, this processor:
 * 1. Determines the next stage
 * 2. Queues jobs for that stage
 * 3. If no more stages, finalizes the run
 */

import { db } from "@grounded/db";
import { sourceRuns } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { log } from "@grounded/logger";
import { SourceRunStage, type StageTransitionJob } from "@grounded/shared";
import { unregisterRun } from "@grounded/queue";
import { 
  transitionToNextStage, 
  isRunCanceled,
  initializeStage,
} from "../stage-manager";
import { queueJobsForStage } from "../stage-job-queuer";

// Note: This job handler was moved from processors/ to jobs/ as part of the
// ingestion worker modularization. The stage-manager and stage-job-queuer
// imports remain at the same level since those files are in the src/ directory.

export async function processStageTransition(data: StageTransitionJob): Promise<void> {
  const { tenantId, runId, completedStage, requestId, traceId } = data;

  log.info("ingestion-worker", "Processing stage transition", { 
    runId, 
    completedStage, 
    requestId, 
    traceId 
  });

  // Check if run was canceled
  if (await isRunCanceled(runId)) {
    log.info("ingestion-worker", "Run was canceled, skipping stage transition", { runId });
    return;
  }

  // Get current run state
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    log.error("ingestion-worker", "Run not found for stage transition", { runId });
    return;
  }

  // Verify we're in the expected state
  if (run.stage !== completedStage) {
    log.warn("ingestion-worker", "Run stage mismatch", { 
      runId, 
      expected: completedStage, 
      actual: run.stage 
    });
    return;
  }

  // If SCRAPING stage completed, unregister from fairness scheduler
  // This releases the run from slot tracking so other runs can use more capacity
  if (completedStage === SourceRunStage.SCRAPING) {
    await unregisterRun(runId);
    log.debug("ingestion-worker", "Unregistered run from fairness scheduler after SCRAPING", { runId });
  }

  // Transition to the next stage
  const { nextStage, itemCount } = await transitionToNextStage(runId);

  if (!nextStage) {
    // Run has been finalized by transitionToNextStage
    log.info("ingestion-worker", "Run completed all stages", { runId });
    return;
  }

  // Queue jobs for the next stage
  if (itemCount > 0) {
    await queueJobsForStage(nextStage, runId, tenantId, requestId, traceId);
  }

  log.info("ingestion-worker", "Stage transition complete", { 
    runId, 
    fromStage: completedStage,
    toStage: nextStage,
    itemCount,
  });
}
