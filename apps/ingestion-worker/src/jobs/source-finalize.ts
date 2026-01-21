/**
 * Source Run Finalization
 * 
 * With the new sequential stage architecture, this processor is only called
 * when ALL stages have completed (including embedding). There's no longer
 * a need to wait for embeddings or handle "embedding_incomplete" status.
 * 
 * This processor:
 * 1. Calculates final statistics
 * 2. Determines final status (succeeded, partial, failed)
 * 3. Cleans up Redis state
 * 4. Logs run summary
 */

import { db } from "@grounded/db";
import { sourceRuns, sourceRunPages } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { redis, cleanupChunkEmbedStatuses } from "@grounded/queue";
import { log } from "@grounded/logger";
import { 
  SourceRunStage,
  type SourceRunFinalizeJob, 
  type PageSkipDetails,
  createRunSummaryLog,
  createCompactRunSummary,
  getRunSummaryLogLevel,
  type RunSummaryInput,
} from "@grounded/shared";
import { createCrawlState } from "@grounded/crawl-state";
import { cleanupRunRedisState } from "../stage-manager";

// Note: This job handler was moved from processors/ to jobs/ as part of the
// ingestion worker modularization. The stage-manager import remains at the
// same level since stage-manager.ts is in the src/ directory.

export async function processSourceFinalize(data: SourceRunFinalizeJob): Promise<void> {
  const { runId, requestId, traceId } = data;

  log.info("ingestion-worker", "Finalizing source run", { runId, requestId, traceId });

  // Initialize CrawlState to get accurate Redis stats
  const crawlState = createCrawlState(redis, runId);

  // Get run
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  // If run is already canceled, skip finalization
  if (run.status === "canceled") {
    log.info("ingestion-worker", "Run was canceled, skipping finalization", { runId });
    await cleanupRunRedisState(runId);
    return;
  }

  // Get all pages for statistics
  const allPages = await db
    .select()
    .from(sourceRunPages)
    .where(eq(sourceRunPages.sourceRunId, runId));

  const stats = {
    total: allPages.length,
    succeeded: allPages.filter(p => p.status === 'succeeded').length,
    failed: allPages.filter(p => p.status === 'failed').length,
    skipped: allPages.filter(p => p.status === 'skipped_unchanged' || p.status === 'skipped_non_html').length,
  };

  log.debug("ingestion-worker", "Page stats for run", { runId, stats });

  // Determine final status based on failures
  let finalStatus: "succeeded" | "partial" | "failed";
  
  const successfulPages = stats.succeeded + stats.skipped;
  
  if (successfulPages === 0 && stats.failed > 0) {
    finalStatus = "failed";
  } else if (stats.failed > 0 || run.stageFailed > 0) {
    finalStatus = "partial";
  } else {
    finalStatus = "succeeded";
  }

  const finishedAt = new Date();

  // Update run with final status
  try {
    await db
      .update(sourceRuns)
      .set({
        status: finalStatus,
        stage: SourceRunStage.COMPLETED,
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

    log.debug("ingestion-worker", "Run updated successfully", { runId, status: finalStatus });
  } catch (e) {
    log.error("ingestion-worker", "Error updating run", { 
      runId, 
      error: e instanceof Error ? e.message : String(e) 
    });
    throw e;
  }

  // Get failed URLs for logging
  const failedUrls = await crawlState.getFailedUrls();
  if (failedUrls.length > 0) {
    log.warn("ingestion-worker", "Failed URLs for run", {
      runId,
      failedCount: failedUrls.length,
      sampleFailedUrls: failedUrls.slice(0, 10),
    });
  }

  // Build skipped pages list
  const skippedPages = allPages
    .filter(p => p.status === 'skipped_unchanged' || p.status === 'skipped_non_html')
    .map(p => ({
      url: p.url,
      skipDetails: p.status === 'skipped_non_html'
        ? { 
            reason: 'non_html_content_type' as const, 
            description: 'Non-HTML content type', 
            stage: 'fetch' as const, 
            skippedAt: new Date().toISOString() 
          } as PageSkipDetails
        : { 
            reason: 'content_unchanged' as const, 
            description: 'Content unchanged since last crawl', 
            stage: 'fetch' as const, 
            skippedAt: new Date().toISOString() 
          } as PageSkipDetails,
    }));

  // Create run summary input
  const chunksToEmbed = run.chunksToEmbed || 0;
  const chunksEmbedded = run.chunksEmbedded || 0;
  
  const summaryInput: RunSummaryInput = {
    runId,
    sourceId: run.sourceId || "unknown",
    tenantId: run.tenantId ?? null,
    finalStatus,
    runStartedAt: run.startedAt || new Date(),
    runFinishedAt: finishedAt,
    pages: {
      total: stats.total,
      succeeded: stats.succeeded,
      failed: stats.failed,
      skipped: stats.skipped,
    },
    embeddings: chunksToEmbed > 0 ? {
      chunksToEmbed,
      chunksEmbedded,
      chunksFailed: chunksToEmbed - chunksEmbedded,
    } : undefined,
    failedPages: failedUrls,
    skippedPages,
  };

  // Generate and log run summary
  const runSummary = createRunSummaryLog(summaryInput);
  const logLevel = getRunSummaryLogLevel(runSummary);
  const compactSummary = createCompactRunSummary(runSummary);

  // Log compact summary at appropriate level
  const summaryLogContext = runSummary as unknown as Record<string, unknown>;
  if (logLevel === "error") {
    log.error("ingestion-worker", `Run summary: ${compactSummary}`, summaryLogContext);
  } else if (logLevel === "warn") {
    log.warn("ingestion-worker", `Run summary: ${compactSummary}`, summaryLogContext);
  } else {
    log.info("ingestion-worker", `Run summary: ${compactSummary}`, summaryLogContext);
  }

  // Log detailed error breakdown if there are failures
  if (runSummary.errorBreakdown.length > 0) {
    log.info("ingestion-worker", "Error breakdown for run", {
      runId,
      event: "error_breakdown",
      uniqueErrorCodes: runSummary.summary.uniqueErrorCodes,
      hasRetryableErrors: runSummary.summary.hasRetryableErrors,
      hasPermanentErrors: runSummary.summary.hasPermanentErrors,
      breakdown: runSummary.errorBreakdown,
    });
  }

  // Log detailed skip breakdown if there are skips
  if (runSummary.skipBreakdown.length > 0) {
    log.info("ingestion-worker", "Skip breakdown for run", {
      runId,
      event: "skip_breakdown",
      uniqueSkipReasons: runSummary.summary.uniqueSkipReasons,
      breakdown: runSummary.skipBreakdown,
    });
  }

  // Cleanup Redis state
  log.debug("ingestion-worker", "Cleaning up Redis state for run", { runId });
  await crawlState.cleanup();
  await cleanupRunRedisState(runId);
  
  // Cleanup chunk embed status tracking
  const cleanedUpStatuses = await cleanupChunkEmbedStatuses(runId);
  if (cleanedUpStatuses > 0) {
    log.debug("ingestion-worker", "Cleaned up chunk embed status keys", {
      runId,
      keysDeleted: cleanedUpStatuses,
    });
  }

  log.info("ingestion-worker", "Source run finalized", {
    runId,
    finalStatus,
    succeeded: stats.succeeded,
    total: stats.total,
    failed: stats.failed,
    skipped: stats.skipped,
    chunksToEmbed,
    chunksEmbedded,
  });
}
