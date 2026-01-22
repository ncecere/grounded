/**
 * Page Fetch Processor
 * 
 * Orchestrates page fetch operations using modular services:
 * - fairness-slots: Manages fair distribution of worker capacity across concurrent runs
 * - fetch/selection: Selects and executes the appropriate fetch strategy
 * - content-validation: Validates fetched content (used internally by selection)
 * 
 * The processor handles:
 * 1. Fairness slot acquisition (via withFairnessSlotOrThrow)
 * 2. Fetch execution (via selectAndFetch)
 * 3. CrawlState updates (marking URLs as fetched/failed)
 * 4. Usage tracking (tenant scraped pages count)
 * 5. Stage progress tracking and transitions
 */

import type { Browser } from "playwright";
import { db } from "@grounded/db";
import { sourceRuns, sourceRunPages, sources, tenantUsage } from "@grounded/db/schema";
import { eq, sql, and } from "drizzle-orm";
import {
  redis,
  incrementStageProgress,
  storeFetchedHtml,
  addStageTransitionJob,
} from "@grounded/queue";
import { log } from "@grounded/logger";
import {
  normalizeUrl,
  type PageFetchJob,
  SourceRunStage,
} from "@grounded/shared";

import { createCrawlState } from "@grounded/crawl-state";
import { selectAndFetch } from "../fetch/selection";
import { withFairnessSlotOrThrow } from "../services/fairness-slots";

/**
 * Processes a page fetch job with fairness slot management.
 * 
 * This is the main entry point called by the worker. It:
 * 1. Acquires a fairness slot (throws FairnessSlotUnavailableError if unavailable)
 * 2. Executes the page fetch with automatic slot release
 * 
 * The fairness slot ensures fair distribution of worker capacity across
 * concurrent source runs, preventing any single run from monopolizing workers.
 * 
 * @throws FairnessSlotUnavailableError - If no slot is available (triggers delayed retry)
 */
export async function processPageFetch(
  data: PageFetchJob,
  browser: Browser
): Promise<void> {
  const { runId, requestId, traceId } = data;

  // Execute fetch within fairness slot context
  // withFairnessSlotOrThrow handles:
  // - Slot acquisition with logging
  // - Automatic slot release in finally block
  // - Throws FairnessSlotUnavailableError if slot unavailable
  await withFairnessSlotOrThrow(
    runId,
    () => processPageFetchWithSlot(data, browser),
    { requestId, traceId }
  );
}

/**
 * Internal function that processes the page fetch after a slot has been acquired.
 * 
 * This function orchestrates the actual fetch operation using modular services:
 * 1. Validates run exists and is not canceled
 * 2. Fetches page content using selectAndFetch (handles strategy selection)
 * 3. Updates crawl state and usage tracking
 * 4. Triggers stage transition when scraping phase completes
 */
async function processPageFetchWithSlot(
  data: PageFetchJob,
  browser: Browser
): Promise<void> {
  const { tenantId, runId, url, fetchMode, depth = 0, requestId, traceId } = data;

  log.info("scraper-worker", "Fetching page", { url, fetchMode, depth, requestId, traceId });

  // Initialize CrawlState for this run
  const crawlState = createCrawlState(redis, runId);

  // Get run and source
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  // Check if run was canceled
  if (run.status === "canceled") {
    log.info("scraper-worker", "Run was canceled, skipping page fetch", { runId });
    return;
  }

  const source = await db.query.sources.findFirst({
    where: eq(sources.id, run.sourceId),
  });

  if (!source) {
    throw new Error(`Source ${run.sourceId} not found`);
  }

  try {
    // Fetch page using the selection helper
    // selectAndFetch handles:
    // - Strategy selection based on fetchMode and source config
    // - HTTP fetch with Playwright fallback (for auto/html modes)
    // - JS rendering detection and fallback
    const result = await selectAndFetch({
      url,
      fetchMode,
      sourceConfig: {
        firecrawlEnabled: source.config.firecrawlEnabled,
      },
      browser,
    });

    const { html, title } = result;

    // Mark URL as fetched in Redis (atomic state transition)
    await crawlState.markFetched(url);

    if (tenantId) {
      // Update usage
      const currentMonth = new Date().toISOString().slice(0, 7);
      await db
        .update(tenantUsage)
        .set({
          scrapedPages: sql`${tenantUsage.scrapedPages} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenantUsage.tenantId, tenantId),
            eq(tenantUsage.month, currentMonth)
          )
        );
    }

    // Store fetched HTML in Redis for later processing (sequential stage model)
    // The PROCESSING stage will retrieve this HTML when it runs
    await storeFetchedHtml(runId, url, html, title);

    // Track SCRAPING stage progress (success)
    const stageProgress = await incrementStageProgress(runId, false);
    log.info("scraper-worker", "Page fetched successfully", { 
      url, 
      stageProgress: `${stageProgress.completed}/${stageProgress.total}`,
    });

    // If SCRAPING stage is complete, trigger transition to PROCESSING
    if (stageProgress.isComplete) {
      log.info("scraper-worker", "SCRAPING stage complete, triggering transition to PROCESSING", {
        runId,
        completed: stageProgress.completed,
        failed: stageProgress.failed,
        total: stageProgress.total,
      });
      await addStageTransitionJob({
        tenantId,
        runId,
        completedStage: SourceRunStage.SCRAPING,
        requestId,
        traceId,
      });
    }
  } catch (error) {
    log.error("scraper-worker", "Error fetching page", { url, error: error instanceof Error ? error.message : String(error) });

    // Mark as failed in Redis
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await crawlState.markFailed(url, errorMessage);

    // Record failure in PostgreSQL for history
    await db.insert(sourceRunPages).values({
      tenantId,
      sourceRunId: runId,
      url,
      normalizedUrl: normalizeUrl(url),
      title: null,
      status: "failed",
      error: errorMessage,
    });

    // Track SCRAPING stage progress (failure)
    const stageProgress = await incrementStageProgress(runId, true);
    log.debug("scraper-worker", "Page fetch failed, stage progress updated", {
      url,
      stageProgress: `${stageProgress.completed + stageProgress.failed}/${stageProgress.total}`,
    });

    // If SCRAPING stage is complete (even with failures), trigger transition to PROCESSING
    if (stageProgress.isComplete) {
      log.info("scraper-worker", "SCRAPING stage complete (with failures), triggering transition to PROCESSING", {
        runId,
        completed: stageProgress.completed,
        failed: stageProgress.failed,
        total: stageProgress.total,
      });
      await addStageTransitionJob({
        tenantId,
        runId,
        completedStage: SourceRunStage.SCRAPING,
        requestId,
        traceId,
      });
    }
  }
}
