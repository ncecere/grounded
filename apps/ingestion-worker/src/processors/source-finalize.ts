import { db } from "@grounded/db";
import { sourceRuns, sourceRunPages } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { redis } from "@grounded/queue";
import type { SourceRunFinalizeJob } from "@grounded/shared";
import { createCrawlState } from "@grounded/crawl-state";

export async function processSourceFinalize(data: SourceRunFinalizeJob): Promise<void> {
  const { runId } = data;

  console.log(`[SourceFinalize] Finalizing source run ${runId}`);

  // Initialize CrawlState to get accurate Redis stats
  const crawlState = createCrawlState(redis, runId);

  // Get run
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  // Get progress from Redis (accurate)
  const redisProgress = await crawlState.getProgress();
  console.log(`[SourceFinalize] Redis progress for run ${runId}:`, redisProgress);

  // Also get PostgreSQL stats for comparison/backup
  const allPages = await db
    .select()
    .from(sourceRunPages)
    .where(eq(sourceRunPages.sourceRunId, runId));

  const pgStats = {
    total: allPages.length,
    succeeded: allPages.filter(p => p.status === 'succeeded').length,
    failed: allPages.filter(p => p.status === 'failed').length,
    skipped: allPages.filter(p => p.status === 'skipped_unchanged').length,
  };

  console.log(`[SourceFinalize] PostgreSQL stats for run ${runId}:`, pgStats);

  // Use Redis stats as primary (they're accurate)
  // Fall back to PostgreSQL if Redis data is missing
  const stats = {
    total: redisProgress.total || pgStats.total,
    succeeded: redisProgress.processed || pgStats.succeeded,
    failed: redisProgress.failed || pgStats.failed,
    skipped: pgStats.skipped, // Skipped pages are only tracked in PostgreSQL
  };

  // Determine final status
  // Skipped pages count as successful (content unchanged from previous run)
  const successfulPages = stats.succeeded + stats.skipped;

  let finalStatus: "succeeded" | "partial" | "failed";
  if (successfulPages > 0 && stats.failed === 0) {
    finalStatus = "succeeded";
  } else if (successfulPages > 0 && stats.failed > 0) {
    finalStatus = "partial";
  } else {
    finalStatus = "failed";
  }

  const finishedAt = new Date();

  console.log(`[SourceFinalize] Updating run ${runId} with status ${finalStatus}`);

  try {
    // Update run
    await db
      .update(sourceRuns)
      .set({
        status: finalStatus,
        finishedAt,
        stats: {
          pagesSeen: stats.total,
          pagesIndexed: stats.succeeded,
          pagesFailed: stats.failed,
          pagesSkipped: stats.skipped,
          tokensEstimated: run.stats?.tokensEstimated || 0,
        },
      })
      .where(eq(sourceRuns.id, runId));
    console.log(`[SourceFinalize] Run ${runId} updated successfully`);
  } catch (e) {
    console.error(`[SourceFinalize] Error updating run ${runId}:`, e);
    throw e;
  }

  // Get failed URLs for logging
  const failedUrls = await crawlState.getFailedUrls();
  if (failedUrls.length > 0) {
    console.log(`[SourceFinalize] Failed URLs for run ${runId}:`);
    for (const { url, error } of failedUrls.slice(0, 10)) {
      console.log(`  - ${url}: ${error}`);
    }
    if (failedUrls.length > 10) {
      console.log(`  ... and ${failedUrls.length - 10} more`);
    }
  }

  // Cleanup Redis crawl state data
  // This is important to prevent Redis memory growth
  console.log(`[SourceFinalize] Cleaning up Redis crawl state for run ${runId}`);
  await crawlState.cleanup();

  console.log(
    `[SourceFinalize] Source run ${runId} finalized: ${finalStatus} ` +
    `(${stats.succeeded}/${stats.total} indexed, ${stats.failed} failed, ${stats.skipped} skipped)`
  );
}
