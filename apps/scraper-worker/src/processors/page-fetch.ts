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
  incrementStageProgressTotal,
  storeFetchedHtml,
  addStageTransitionJob,
  addPageFetchJob,
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
import { discoverLinks } from "../services/link-extractor";

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

    // --- Domain crawl: discover and queue new URLs ---
    if (source.config.mode === "domain" && source.config.url) {
      try {
        const newLinks = discoverLinks(
          html,
          url,
          source.config.url,
          {
            depth: source.config.depth ?? 3,
            includePatterns: source.config.includePatterns,
            excludePatterns: source.config.excludePatterns,
            includeSubdomains: source.config.includeSubdomains,
          },
          depth
        );

        if (newLinks.length > 0) {
          // Deduplicate against already-seen URLs via CrawlState (atomic Redis SADD)
          const trulyNewUrls = await crawlState.queueUrls(newLinks);

          if (trulyNewUrls.length > 0) {
            log.info("scraper-worker", "Discovered new URLs for domain crawl", {
              runId,
              pageUrl: url,
              discovered: newLinks.length,
              new: trulyNewUrls.length,
              deduplicated: newLinks.length - trulyNewUrls.length,
              currentDepth: depth,
            });

            // CRITICAL: Increment stage total BEFORE queueing jobs to prevent
            // premature stage completion. If we queue first, another worker could
            // complete the last existing job before our total is updated.
            await incrementStageProgressTotal(runId, trulyNewUrls.length);

            // Also update the DB stageTotal and pagesSeen for UI display
            await db
              .update(sourceRuns)
              .set({
                stageTotal: sql`${sourceRuns.stageTotal} + ${trulyNewUrls.length}`,
                stats: sql`jsonb_set(${sourceRuns.stats}, '{pagesSeen}', to_jsonb((${sourceRuns.stats}->>'pagesSeen')::int + ${trulyNewUrls.length}))`,
              })
              .where(eq(sourceRuns.id, runId));

            // Queue page-fetch jobs for each new URL at depth + 1
            const newDepth = depth + 1;
            await Promise.all(
              trulyNewUrls.map((newUrl) =>
                addPageFetchJob({
                  tenantId,
                  runId,
                  url: newUrl,
                  fetchMode,
                  depth: newDepth,
                  requestId,
                  traceId,
                })
              )
            );

            log.info("scraper-worker", "Queued new page-fetch jobs", {
              runId,
              count: trulyNewUrls.length,
              depth: newDepth,
            });
          }
        }
      } catch (linkError) {
        // Link discovery failure should NOT fail the page fetch itself
        log.error("scraper-worker", "Error during link discovery (non-fatal)", {
          url,
          runId,
          error: linkError instanceof Error ? linkError.message : String(linkError),
        });
      }
    }

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
