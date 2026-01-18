import { db } from "@grounded/db";
import { sourceRuns, sourceRunPages } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import {
  redis,
  waitForRunEmbeddingCompletion,
  cleanupChunkEmbedStatuses,
  resolveEmbedCompletionGatingConfig,
} from "@grounded/queue";
import { log } from "@grounded/logger";
import type { SourceRunFinalizeJob, PageSkipDetails } from "@grounded/shared";
import {
  createRunSummaryLog,
  createCompactRunSummary,
  getRunSummaryLogLevel,
  type RunSummaryInput,
} from "@grounded/shared";
import { createCrawlState } from "@grounded/crawl-state";

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

  // Get progress from Redis (accurate)
  const redisProgress = await crawlState.getProgress();
  log.debug("ingestion-worker", "Redis progress for run", { runId, redisProgress });

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

  log.debug("ingestion-worker", "PostgreSQL stats for run", { runId, pgStats });

  // Use Redis stats as primary (they're accurate)
  // Fall back to PostgreSQL if Redis data is missing
  const stats = {
    total: redisProgress.total || pgStats.total,
    succeeded: redisProgress.processed || pgStats.succeeded,
    failed: redisProgress.failed || pgStats.failed,
    skipped: pgStats.skipped, // Skipped pages are only tracked in PostgreSQL
  };

  // Determine if there were page-level failures
  const hasPageFailures = stats.failed > 0;
  const successfulPages = stats.succeeded + stats.skipped;

  // Wait for embedding completion if gating is enabled
  const gatingConfig = resolveEmbedCompletionGatingConfig();
  const chunksToEmbed = run.chunksToEmbed || 0;

  let finalStatus: "succeeded" | "partial" | "failed" | "embedding_incomplete";

  if (chunksToEmbed > 0 && gatingConfig.enabled) {
    log.info("ingestion-worker", "Waiting for embedding completion", {
      runId,
      chunksToEmbed,
      chunksEmbedded: run.chunksEmbedded || 0,
      maxWaitMs: gatingConfig.maxWaitMs,
    });

    const embedResult = await waitForRunEmbeddingCompletion(
      runId,
      chunksToEmbed,
      hasPageFailures,
      gatingConfig
    );

    log.info("ingestion-worker", "Embedding completion check result", {
      runId,
      isComplete: embedResult.isComplete,
      allSucceeded: embedResult.allSucceeded,
      pendingCount: embedResult.pendingCount,
      failedCount: embedResult.failedCount,
      succeededCount: embedResult.succeededCount,
      totalCount: embedResult.totalCount,
      suggestedStatus: embedResult.suggestedStatus,
    });

    // Use the suggested status from embedding completion check
    if (embedResult.suggestedStatus === "embedding_incomplete") {
      finalStatus = "embedding_incomplete";
      log.warn("ingestion-worker", "Run finalized with incomplete embeddings", {
        runId,
        pendingCount: embedResult.pendingCount,
        failedCount: embedResult.failedCount,
      });
    } else if (embedResult.suggestedStatus === "partial" || hasPageFailures || embedResult.failedCount > 0) {
      finalStatus = "partial";
    } else if (successfulPages > 0) {
      finalStatus = "succeeded";
    } else {
      finalStatus = "failed";
    }
  } else {
    // No embedding gating - use page-level status only
    if (successfulPages > 0 && stats.failed === 0) {
      finalStatus = "succeeded";
    } else if (successfulPages > 0 && stats.failed > 0) {
      finalStatus = "partial";
    } else {
      finalStatus = "failed";
    }
  }

  const finishedAt = new Date();
  const storedFinishedAt = finalStatus === "embedding_incomplete" ? null : finishedAt;

  log.debug("ingestion-worker", "Updating run with status", { runId, finalStatus });

  try {
    // Update run
    await db
      .update(sourceRuns)
      .set({
        status: finalStatus,
        finishedAt: storedFinishedAt,
        stats: {
          pagesSeen: stats.total,
          pagesIndexed: stats.succeeded,
          pagesFailed: stats.failed,
          pagesSkipped: stats.skipped,
          tokensEstimated: run.stats?.tokensEstimated || 0,
        },
      })
      .where(eq(sourceRuns.id, runId));
    log.debug("ingestion-worker", "Run updated successfully", { runId });
  } catch (e) {
    log.error("ingestion-worker", "Error updating run", { runId, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  // Get failed URLs for logging and summary
  const failedUrls = await crawlState.getFailedUrls();
  if (failedUrls.length > 0) {
    log.warn("ingestion-worker", "Failed URLs for run", {
      runId,
      failedCount: failedUrls.length,
      sampleFailedUrls: failedUrls.slice(0, 10),
    });
  }

  // Build skipped pages list from PostgreSQL data
  const skippedPages = allPages
    .filter(p => p.status === 'skipped_unchanged' || p.status === 'skipped_non_html')
    .map(p => ({
      url: p.url,
      skipDetails: p.status === 'skipped_non_html'
        ? { reason: 'non_html_content_type' as const, description: 'Non-HTML content type', stage: 'fetch' as const, skippedAt: new Date().toISOString() } as PageSkipDetails
        : { reason: 'content_unchanged' as const, description: 'Content unchanged since last crawl', stage: 'fetch' as const, skippedAt: new Date().toISOString() } as PageSkipDetails,
    }));

  // Create run summary input
  const summaryInput: RunSummaryInput = {
    runId,
    sourceId: run.sourceId || "unknown",
    tenantId: run.tenantId || "unknown",
    finalStatus,
    runStartedAt: run.startedAt || new Date(),
    runFinishedAt: finishedAt,
    pages: {
      total: stats.total,
      succeeded: stats.succeeded,
      failed: stats.failed,
      skipped: stats.skipped + allPages.filter(p => p.status === 'skipped_non_html').length,
    },
    embeddings: chunksToEmbed > 0 ? {
      chunksToEmbed,
      chunksEmbedded: run.chunksEmbedded || 0,
      chunksFailed: chunksToEmbed - (run.chunksEmbedded || 0),
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

  // Cleanup Redis crawl state data
  // This is important to prevent Redis memory growth
  log.debug("ingestion-worker", "Cleaning up Redis crawl state for run", { runId });
  await crawlState.cleanup();

  // Cleanup chunk embed status tracking data
  if (finalStatus !== "embedding_incomplete") {
    const cleanedUpStatuses = await cleanupChunkEmbedStatuses(runId);
    if (cleanedUpStatuses > 0) {
      log.debug("ingestion-worker", "Cleaned up chunk embed status keys", {
        runId,
        keysDeleted: cleanedUpStatuses,
      });
    }
  } else {
    log.debug("ingestion-worker", "Skipping embed status cleanup for embedding_incomplete run", { runId });
  }

  log.info("ingestion-worker", "Source run finalized", {
    runId,
    finalStatus,
    succeeded: stats.succeeded,
    total: stats.total,
    failed: stats.failed,
    skipped: stats.skipped,
    chunksToEmbed,
    chunksEmbedded: run.chunksEmbedded || 0,
  });
}
