import { db } from "@grounded/db";
import { sourceRuns, sourceRunPages, kbChunks } from "@grounded/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { log } from "@grounded/logger";
import { SourceRunStage } from "@grounded/shared";
import { redis, getFetchedHtmlUrls } from "@grounded/queue";
import { createCrawlState } from "@grounded/crawl-state";
import { cleanupRunRedisState } from "./cleanup";
import { initializeStage } from "./progress";

const STAGE_ORDER: SourceRunStage[] = [
  SourceRunStage.DISCOVERING,
  SourceRunStage.SCRAPING,
  SourceRunStage.PROCESSING,
  SourceRunStage.INDEXING,
  SourceRunStage.EMBEDDING,
  SourceRunStage.COMPLETED,
];

export function getNextStage(currentStage: SourceRunStage): SourceRunStage | null {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex >= STAGE_ORDER.length - 1) {
    return null;
  }
  return STAGE_ORDER[currentIndex + 1];
}

export function getStageIndex(stage: SourceRunStage): number {
  return STAGE_ORDER.indexOf(stage) + 1; // 1-indexed for UI display
}

export function getTotalStages(): number {
  return STAGE_ORDER.length - 1; // Exclude COMPLETED from count
}

/**
 * Check if run is canceled (should be called before processing jobs)
 */
export async function isRunCanceled(runId: string): Promise<boolean> {
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
    columns: { status: true },
  });
  return run?.status === "canceled";
}

/**
 * Transition to the next stage
 * Returns the items to process in the next stage
 */
export async function transitionToNextStage(runId: string): Promise<{
  nextStage: SourceRunStage | null;
  itemCount: number;
}> {
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run || !run.stage) {
    throw new Error(`Run ${runId} not found or has no stage`);
  }

  // Check if run should be marked as partial due to failures
  const hasFailures = run.stageFailed > 0;

  const nextStage = getNextStage(run.stage);

  if (!nextStage) {
    // No more stages - finalize
    await finalizeRun(runId, hasFailures);
    return { nextStage: null, itemCount: 0 };
  }

  // Get item count for next stage
  const itemCount = await getItemCountForStage(runId, nextStage);

  if (itemCount === 0) {
    // Skip to next stage if nothing to do
    log.info("ingestion-worker", "Skipping empty stage", { runId, stage: nextStage });
    await initializeStage(runId, nextStage, 0);
    return transitionToNextStage(runId);
  }

  // Initialize next stage
  await initializeStage(runId, nextStage, itemCount);

  log.info("ingestion-worker", "Transitioned to next stage", {
    runId,
    previousStage: run.stage,
    nextStage,
    itemCount,
  });

  return { nextStage, itemCount };
}

/**
 * Get the count of items to process for a given stage
 */
async function getItemCountForStage(runId: string, stage: SourceRunStage): Promise<number> {
  switch (stage) {
    case SourceRunStage.SCRAPING: {
      // Count URLs queued in crawl state (Redis) that need scraping
      const crawlState = createCrawlState(redis, runId);
      const queuedUrls = await crawlState.getQueuedUrls();
      return queuedUrls.length;
    }

    case SourceRunStage.PROCESSING: {
      // Count URLs with fetched HTML in Redis (staged by page-fetch)
      const urlsWithHtml = await getFetchedHtmlUrls(runId);
      return urlsWithHtml.length;
    }

    case SourceRunStage.INDEXING: {
      // Count pages that were successfully processed
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(sourceRunPages)
        .where(and(
          eq(sourceRunPages.sourceRunId, runId),
          eq(sourceRunPages.currentStage, "extract"),
          eq(sourceRunPages.status, "succeeded")
        ));
      return Number(result[0]?.count || 0);
    }

    case SourceRunStage.EMBEDDING: {
      // Count chunks that need embedding, then calculate number of embed jobs
      // Stage progress tracks JOBS (batches of 50), not individual chunks
      const EMBED_BATCH_SIZE = 50;
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(kbChunks)
        .where(and(
          eq(kbChunks.sourceRunId, runId),
          isNull(kbChunks.deletedAt)
        ));
      const chunkCount = Number(result[0]?.count || 0);
      return Math.ceil(chunkCount / EMBED_BATCH_SIZE);
    }

    default:
      return 0;
  }
}

/**
 * Finalize a run - calculate stats and determine final status
 */
async function finalizeRun(runId: string, hasFailures: boolean): Promise<void> {
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  // Get all pages for statistics
  const allPages = await db.query.sourceRunPages.findMany({
    where: eq(sourceRunPages.sourceRunId, runId),
  });

  const stats = {
    total: allPages.length,
    succeeded: allPages.filter(p => p.status === "succeeded").length,
    failed: allPages.filter(p => p.status === "failed").length,
    skipped: allPages.filter(p => p.status === "skipped_unchanged" || p.status === "skipped_non_html").length,
  };

  // Determine final status
  let finalStatus: "succeeded" | "partial" | "failed" = "succeeded";

  const successfulPages = stats.succeeded + stats.skipped;

  if (successfulPages === 0 && stats.failed > 0) {
    finalStatus = "failed";
  } else if (stats.failed > 0 || hasFailures) {
    finalStatus = "partial";
  }

  await db
    .update(sourceRuns)
    .set({
      status: finalStatus,
      stage: SourceRunStage.COMPLETED,
      finishedAt: new Date(),
      stats: {
        pagesSeen: stats.total,
        pagesIndexed: stats.succeeded,
        pagesFailed: stats.failed,
        pagesSkipped: stats.skipped,
        tokensEstimated: run.stats?.tokensEstimated || 0,
      },
    })
    .where(eq(sourceRuns.id, runId));

  // Cleanup Redis state
  await cleanupRunRedisState(runId);

  log.info("ingestion-worker", "Run finalized", {
    runId,
    status: finalStatus,
    pagesIndexed: stats.succeeded,
    pagesFailed: stats.failed,
    pagesSkipped: stats.skipped,
  });
}
