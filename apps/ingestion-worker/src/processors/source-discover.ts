import { db } from "@kcb/db";
import { sourceRuns, sources } from "@kcb/db/schema";
import { eq } from "drizzle-orm";
import { addPageFetchJob, addSourceRunFinalizeJob, redis } from "@kcb/queue";
import { normalizeUrl, type SourceDiscoverUrlsJob, FetchMode } from "@kcb/shared";
import { createCrawlState } from "@kcb/crawl-state";

export async function processSourceDiscover(data: SourceDiscoverUrlsJob): Promise<void> {
  const { tenantId, runId } = data;

  console.log(`[SourceDiscover] Starting URL discovery for run ${runId}`);

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
    tenantId,
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

  console.log(`[SourceDiscover] Found ${filteredUrls.length} initial URLs for run ${runId}`);

  if (filteredUrls.length === 0) {
    // No URLs to process, finalize immediately
    console.log(`[SourceDiscover] No URLs to process, finalizing run ${runId}`);
    await addSourceRunFinalizeJob({ tenantId, runId });
    return;
  }

  // Queue URLs atomically using CrawlState
  // This returns only the truly new URLs (prevents duplicates)
  const newUrls = await crawlState.queueUrls(filteredUrls);

  console.log(`[SourceDiscover] Queued ${newUrls.length} URLs in Redis for run ${runId}`);

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

  // Determine fetch mode
  const fetchMode: FetchMode = config.firecrawlEnabled ? "firecrawl" : "auto";

  // Queue page fetch jobs for new URLs
  for (const url of newUrls) {
    await addPageFetchJob({
      tenantId,
      runId,
      url,
      fetchMode,
      depth: 0, // Starting depth
    });
  }

  console.log(`[SourceDiscover] Queued ${newUrls.length} page fetch jobs for run ${runId}`);
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
    console.error(`Error fetching sitemap ${sitemapUrl}:`, error);
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
