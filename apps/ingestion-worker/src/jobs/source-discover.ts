import { db } from "@grounded/db";
import { sourceRuns, sources } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { addStageTransitionJob, redis, initializeStageProgress } from "@grounded/queue";
import { log } from "@grounded/logger";
import { initializeStage } from "../stage-manager";

// Note: This job handler was moved from processors/ to jobs/ as part of the
// ingestion worker modularization. The stage-manager import remains at the
// same level since stage-manager.ts is in the src/ directory.
import {
  type SourceDiscoverUrlsJob,
  SourceRunStage,
  createRobotsOverrideLog,
  createRobotsBlockedSummaryLog,
  createStructuredRobotsOverrideLog,
  createStructuredRobotsBlockedSummaryLog,
} from "@grounded/shared";
import { createCrawlState } from "@grounded/crawl-state";
import { filterUrlsByRobotsRules } from "../services/robots";


export async function processSourceDiscover(data: SourceDiscoverUrlsJob): Promise<void> {
  const { tenantId, runId, requestId, traceId } = data;

  log.info("ingestion-worker", "Starting URL discovery for run", { runId, requestId, traceId });

  // Get run and source
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  const source = await db.query.sources.findFirst({
    where: eq(sources.id, run.sourceId),
  });

  if (!source) {
    throw new Error(`Source ${run.sourceId} not found`);
  }

  // Initialize CrawlState for this run
  // Default max URLs to 10000 for domain crawls
  const crawlState = createCrawlState(redis, runId, {
    maxUrls: 10000,
  });

  // Store metadata for later reference
  await crawlState.setMetadata({
    sourceId: source.id,
    tenantId: tenantId ?? "global",
    mode: source.config.mode,
    startedAt: Date.now(),
  });

  const config = source.config;
  const urls: string[] = [];

  // Discover URLs based on mode
  switch (config.mode) {
    case "single":
      if (config.url) {
        urls.push(config.url);
      }
      break;

    case "list":
      if (config.urls) {
        urls.push(...config.urls);
      }
      break;

    case "sitemap":
      if (config.url) {
        const sitemapUrls = await discoverFromSitemap(config.url);
        urls.push(...sitemapUrls);
      }
      break;

    case "domain":
      if (config.url) {
        // For domain crawl, we'll start with the base URL
        // and discover more URLs as we scrape
        urls.push(config.url);
      }
      break;
  }

  // Apply include/exclude patterns
  const filteredUrls = urls.filter((url) => {
    try {
      const urlPath = new URL(url).pathname;

      // Check exclude patterns
      if (config.excludePatterns?.length) {
        for (const pattern of config.excludePatterns) {
          if (matchPattern(urlPath, pattern)) {
            return false;
          }
        }
      }

      // Check include patterns
      if (config.includePatterns?.length) {
        let matches = false;
        for (const pattern of config.includePatterns) {
          if (matchPattern(urlPath, pattern)) {
            matches = true;
            break;
          }
        }
        return matches;
      }

      return true;
    } catch {
      return false;
    }
  });

  log.info("ingestion-worker", "Found initial URLs after pattern filtering", { urlCount: filteredUrls.length, runId });

  if (filteredUrls.length === 0) {
    // No URLs to process - initialize DISCOVERING as complete with 0 items
    // and trigger transition (which will skip to finalization)
    log.info("ingestion-worker", "No URLs to process, completing discovery", { runId });
    await initializeStage(runId, SourceRunStage.DISCOVERING, 0);
    await addStageTransitionJob({ tenantId, runId, completedStage: SourceRunStage.DISCOVERING, requestId, traceId });
    return;
  }

  // Apply robots.txt filtering
  const respectRobotsTxt = config.respectRobotsTxt !== false; // Default to true
  const robotsResult = await filterUrlsByRobotsRules(filteredUrls, respectRobotsTxt);

  // Log robots.txt override usage if an override was used
  if (robotsResult.overrideUsed && robotsResult.overrideType) {
    const overrideLog = createRobotsOverrideLog({
      overrideType: robotsResult.overrideType,
      runId,
      sourceId: source.id,
      tenantId,
      urls: filteredUrls,
    });

    log.info("ingestion-worker", "Robots.txt override active", createStructuredRobotsOverrideLog(overrideLog));
  }

  // Create and log robots.txt blocked summary
  const summaryLog = createRobotsBlockedSummaryLog({
    runId,
    sourceId: source.id,
    tenantId,
    totalUrlsChecked: filteredUrls.length,
    blockedUrls: robotsResult.blocked,
    robotsTxtRespected: !robotsResult.overrideUsed,
  });

  // Log summary if there were any URLs to check
  if (filteredUrls.length > 0) {
    log.info("ingestion-worker", "Robots.txt filtering complete", createStructuredRobotsBlockedSummaryLog(summaryLog));
  }

  // Log individual blocked URLs at debug level
  if (robotsResult.blocked.length > 0) {
    for (const blocked of robotsResult.blocked) {
      log.debug("ingestion-worker", "URL blocked by robots.txt", {
        runId,
        url: blocked.url,
        reason: blocked.reason,
        rule: blocked.rule,
      });
    }
  }

  const robotsFilteredUrls = robotsResult.allowed;

  if (robotsFilteredUrls.length === 0) {
    // All URLs were blocked by robots.txt - complete discovery with 0 items
    log.info("ingestion-worker", "All URLs blocked by robots.txt, completing discovery", {
      runId,
      blockedCount: robotsResult.blocked.length,
      overrideUsed: robotsResult.overrideUsed,
    });
    await initializeStage(runId, SourceRunStage.DISCOVERING, 0);
    await addStageTransitionJob({ tenantId, runId, completedStage: SourceRunStage.DISCOVERING, requestId, traceId });
    return;
  }

  log.info("ingestion-worker", "Found initial URLs for run after robots.txt filtering", {
    urlCount: robotsFilteredUrls.length,
    robotsBlocked: robotsResult.blocked.length,
    overrideUsed: robotsResult.overrideUsed,
    runId,
  });

  // Queue URLs atomically using CrawlState (for deduplication during domain crawl)
  // This returns only the truly new URLs (prevents duplicates)
  // URLs are stored in Redis and will be fetched during SCRAPING stage
  const newUrls = await crawlState.queueUrls(robotsFilteredUrls);

  log.debug("ingestion-worker", "Queued URLs in Redis for run", { urlCount: newUrls.length, runId });

  // Update initial stats in PostgreSQL (for UI display)
  await db
    .update(sourceRuns)
    .set({
      stats: {
        ...run.stats,
        pagesSeen: newUrls.length,
      },
    })
    .where(eq(sourceRuns.id, runId));

  // Initialize DISCOVERING stage as complete (discovery is a single job)
  // The count is 1 because we count the discovery job itself, not individual URLs
  await initializeStage(runId, SourceRunStage.DISCOVERING, 1);
  
  // Mark stage as complete by updating counters
  await db
    .update(sourceRuns)
    .set({ stageCompleted: 1 })
    .where(eq(sourceRuns.id, runId));

  // Initialize Redis-based stage progress for SCRAPING stage
  // This is used for cross-worker progress tracking
  await initializeStageProgress(runId, newUrls.length);

  // Trigger transition to SCRAPING stage
  // The stage transition processor will queue fetch jobs based on URLs in crawl state
  await addStageTransitionJob({ 
    tenantId, 
    runId, 
    completedStage: SourceRunStage.DISCOVERING, 
    requestId, 
    traceId 
  });

  log.info("ingestion-worker", "Discovery complete, transitioning to scraping", { 
    urlCount: newUrls.length, 
    runId 
  });
}

async function discoverFromSitemap(sitemapUrl: string): Promise<string[]> {
  const urls: string[] = [];

  try {
    const response = await fetch(sitemapUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch sitemap: ${response.status}`);
    }

    const xml = await response.text();

    // Simple sitemap XML parsing
    const locMatches = xml.matchAll(/<loc>([^<]+)<\/loc>/g);
    for (const match of locMatches) {
      const url = match[1].trim();
      if (url.endsWith(".xml")) {
        // Nested sitemap
        const nestedUrls = await discoverFromSitemap(url);
        urls.push(...nestedUrls);
      } else {
        urls.push(url);
      }
    }
  } catch (error) {
    log.error("ingestion-worker", "Error fetching sitemap", { sitemapUrl, error: error instanceof Error ? error.message : String(error) });
  }

  return urls;
}

function matchPattern(path: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".") +
      "$"
  );
  return regex.test(path);
}
