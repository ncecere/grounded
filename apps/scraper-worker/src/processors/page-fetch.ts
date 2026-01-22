import type { Browser } from "playwright";
import { db } from "@grounded/db";
import { sourceRuns, sourceRunPages, sources, tenantUsage } from "@grounded/db/schema";
import { eq, sql, and } from "drizzle-orm";
import {
  redis,
  incrementStageProgress,
  storeFetchedHtml,
  addStageTransitionJob,
  acquireSlot,
  releaseSlot,
  FairnessSlotUnavailableError,
} from "@grounded/queue";
import { log } from "@grounded/logger";
import {
  normalizeUrl,
  type PageFetchJob,
  SourceRunStage,
} from "@grounded/shared";

import { createCrawlState } from "@grounded/crawl-state";
import { fetchWithFirecrawl } from "../fetch/firecrawl";
import { fetchWithHttp } from "../fetch/http";
import { fetchWithPlaywright } from "../fetch/playwright";
import { needsJsRendering } from "../services/content-validation";

export async function processPageFetch(
  data: PageFetchJob,
  browser: Browser
): Promise<void> {
  const { tenantId, runId, url, fetchMode, depth = 0, requestId, traceId } = data;

  // Try to acquire a fairness slot before processing
  // This ensures fair distribution of worker capacity across concurrent source runs
  const slotResult = await acquireSlot(runId);
  
  if (!slotResult.acquired) {
    // Slot not available - throw special error to trigger delayed retry
    log.debug("scraper-worker", "Fairness slot not available, will retry", {
      runId,
      url,
      currentSlots: slotResult.currentSlots,
      maxAllowedSlots: slotResult.maxAllowedSlots,
      activeRunCount: slotResult.activeRunCount,
      retryDelayMs: slotResult.retryDelayMs,
    });
    throw new FairnessSlotUnavailableError(runId, slotResult);
  }

  // Slot acquired - process the job
  // IMPORTANT: Always release the slot in the finally block
  try {
    await processPageFetchWithSlot(data, browser);
  } finally {
    // Always release the slot, even if processing failed
    await releaseSlot(runId);
  }
}

/**
 * Internal function that processes the page fetch after a slot has been acquired.
 * This is separated to ensure the slot is always released in the outer function's finally block.
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

  let html: string;
  let title: string | null = null;

  try {
    // Try different fetch methods based on mode
    if (fetchMode === "firecrawl" || (fetchMode === "auto" && source.config.firecrawlEnabled)) {
      // Use Firecrawl
      const result = await fetchWithFirecrawl(url);
      html = result.html;
      title = result.title;
    } else if (fetchMode === "headless") {
      // Use Playwright directly
      const result = await fetchWithPlaywright(url, browser);
      html = result.html;
      title = result.title;
    } else {
      // Auto mode: try HTML first, fall back to Playwright
      try {
        const result = await fetchWithHttp(url);
        html = result.html;
        title = result.title;

        // Check if content looks like it needs JS rendering
        if (needsJsRendering(html)) {
          log.debug("scraper-worker", "Page needs JS rendering, using Playwright", { url });
          const playwrightResult = await fetchWithPlaywright(url, browser);
          html = playwrightResult.html;
          title = playwrightResult.title;
        }
      } catch (error) {
        // Fall back to Playwright
        log.debug("scraper-worker", "HTTP fetch failed, trying Playwright", { url, error: error instanceof Error ? error.message : String(error) });
        const result = await fetchWithPlaywright(url, browser);
        html = result.html;
        title = result.title;
      }
    }

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
