import { db } from "@grounded/db";
import { sourceRuns } from "@grounded/db/schema";
import { eq, sql } from "drizzle-orm";
import { log } from "@grounded/logger";
import { SourceRunStage } from "@grounded/shared";

export interface StageProgress {
  runId: string;
  stage: SourceRunStage;
  total: number;
  completed: number;
  failed: number;
  percentComplete: number;
}

/**
 * Get current stage progress for a run
 */
export async function getStageProgress(runId: string): Promise<StageProgress | null> {
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run || !run.stage) {
    return null;
  }

  return {
    runId,
    stage: run.stage,
    total: run.stageTotal,
    completed: run.stageCompleted,
    failed: run.stageFailed,
    percentComplete: run.stageTotal > 0
      ? Math.round((run.stageCompleted / run.stageTotal) * 100)
      : 0,
  };
}

/**
 * Initialize stage with total count and reset progress
 */
export async function initializeStage(
  runId: string,
  stage: SourceRunStage,
  total: number
): Promise<void> {
  await db
    .update(sourceRuns)
    .set({
      stage,
      stageTotal: total,
      stageCompleted: 0,
      stageFailed: 0,
    })
    .where(eq(sourceRuns.id, runId));

  log.info("ingestion-worker", "Stage initialized", { runId, stage, total });
}

/**
 * Mark a stage item as completed (or failed)
 * Returns true if the stage is now complete
 */
export async function markStageItemComplete(
  runId: string,
  failed: boolean = false
): Promise<{ stageComplete: boolean; progress: StageProgress }> {
  // Use atomic increment
  const [updated] = await db
    .update(sourceRuns)
    .set(failed
      ? { stageFailed: sql`${sourceRuns.stageFailed} + 1` }
      : { stageCompleted: sql`${sourceRuns.stageCompleted} + 1` }
    )
    .where(eq(sourceRuns.id, runId))
    .returning();

  if (!updated) {
    throw new Error(`Run ${runId} not found`);
  }

  const progress: StageProgress = {
    runId,
    stage: updated.stage!,
    total: updated.stageTotal,
    completed: updated.stageCompleted,
    failed: updated.stageFailed,
    percentComplete: updated.stageTotal > 0
      ? Math.round((updated.stageCompleted / updated.stageTotal) * 100)
      : 0,
  };

  const stageComplete = (updated.stageCompleted + updated.stageFailed) >= updated.stageTotal;

  if (stageComplete) {
    log.info("ingestion-worker", "Stage complete", {
      runId,
      stage: updated.stage,
      completed: updated.stageCompleted,
      failed: updated.stageFailed,
      total: updated.stageTotal,
    });
  }

  return { stageComplete, progress };
}

/**
 * Increment stage completed count by a specific amount (for batch operations)
 */
export async function incrementStageCompleted(
  runId: string,
  amount: number,
  failedAmount: number = 0
): Promise<{ stageComplete: boolean; progress: StageProgress }> {
  const [updated] = await db
    .update(sourceRuns)
    .set({
      stageCompleted: sql`${sourceRuns.stageCompleted} + ${amount}`,
      stageFailed: sql`${sourceRuns.stageFailed} + ${failedAmount}`,
    })
    .where(eq(sourceRuns.id, runId))
    .returning();

  if (!updated) {
    throw new Error(`Run ${runId} not found`);
  }

  const progress: StageProgress = {
    runId,
    stage: updated.stage!,
    total: updated.stageTotal,
    completed: updated.stageCompleted,
    failed: updated.stageFailed,
    percentComplete: updated.stageTotal > 0
      ? Math.round((updated.stageCompleted / updated.stageTotal) * 100)
      : 0,
  };

  const stageComplete = (updated.stageCompleted + updated.stageFailed) >= updated.stageTotal;

  return { stageComplete, progress };
}
