import { db } from "@grounded/db";
import { sourceRuns, sources } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { addPageFetchJob, addSourceRunFinalizeJob, redis } from "@grounded/queue";
import { log } from "@grounded/logger";
import {
  normalizeUrl,
  type SourceDiscoverUrlsJob,
  FetchMode,
  parseRobotsTxt,
  filterUrlsByRobotsTxt,
  buildRobotsTxtUrl,
  buildRobotsTxtCacheKey,
  extractDomainForRobots,
  createRobotsTxtNotFound,
  createRobotsTxtError,
  getRobotsTxtCacheTtl,
  getRobotsTxtFetchTimeout,
  getDefaultRobotsTxtConfig,
  isRobotsTxtGloballyDisabled,
  type ParsedRobotsTxt,
  type RobotsTxtEnforcementConfig,
  // Robots override logging
  RobotsOverrideType,
  createRobotsOverrideLog,
  createRobotsBlockedSummaryLog,
  createStructuredRobotsOverrideLog,
  createStructuredRobotsBlockedSummaryLog,
} from "@grounded/shared";
import { createCrawlState } from "@grounded/crawl-state";

// Cache for parsed robots.txt by domain (in-memory for current process)
const robotsTxtCache = new Map<string, { parsed: ParsedRobotsTxt; expiresAt: number }>();

/**
 * Fetches and parses robots.txt for a domain.
 * Uses Redis cache for persistence across workers.
 *
 * @param domain - The domain to fetch robots.txt for
 * @param url - A sample URL from the domain (used to build robots.txt URL)
 * @returns Parsed robots.txt
 */
async function fetchRobotsTxt(domain: string, url: string): Promise<ParsedRobotsTxt> {
  // Check in-memory cache first
  const cached = robotsTxtCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.parsed;
  }

  // Check Redis cache
  const cacheKey = buildRobotsTxtCacheKey(domain);
  const cachedContent = await redis.get(cacheKey);
  if (cachedContent) {
    try {
      const parsed = JSON.parse(cachedContent) as ParsedRobotsTxt;
      // Store in memory cache
      robotsTxtCache.set(domain, {
        parsed,
        expiresAt: Date.now() + getRobotsTxtCacheTtl() * 1000,
      });
      return parsed;
    } catch {
      // Invalid cache, fetch fresh
    }
  }

  // Fetch robots.txt
  const robotsUrl = buildRobotsTxtUrl(url);
  const timeout = getRobotsTxtFetchTimeout();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Grounded-Bot/1.0; +https://grounded.example.com/bot)",
      },
    });

    clearTimeout(timeoutId);

    if (response.status === 404) {
      // No robots.txt means everything is allowed
      const parsed = createRobotsTxtNotFound();
      await cacheRobotsTxt(domain, parsed);
      return parsed;
    }

    if (!response.ok) {
      // Server error - allow by default but log
      log.warn("ingestion-worker", "Failed to fetch robots.txt", {
        domain,
        url: robotsUrl,
        status: response.status,
      });
      const parsed = createRobotsTxtError(`HTTP ${response.status}`, response.status);
      await cacheRobotsTxt(domain, parsed);
      return parsed;
    }

    const content = await response.text();
    const parsed = parseRobotsTxt(content, response.status);
    await cacheRobotsTxt(domain, parsed);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("ingestion-worker", "Error fetching robots.txt", {
      domain,
      url: robotsUrl,
      error: message,
    });
    const parsed = createRobotsTxtError(message);
    await cacheRobotsTxt(domain, parsed);
    return parsed;
  }
}

/**
 * Caches parsed robots.txt in both memory and Redis.
 */
async function cacheRobotsTxt(domain: string, parsed: ParsedRobotsTxt): Promise<void> {
  const ttl = getRobotsTxtCacheTtl();

  // Store in memory
  robotsTxtCache.set(domain, {
    parsed,
    expiresAt: Date.now() + ttl * 1000,
  });

  // Store in Redis
  const cacheKey = buildRobotsTxtCacheKey(domain);
  await redis.set(cacheKey, JSON.stringify(parsed), "EX", ttl);
}

/**
 * Result of filtering URLs by robots.txt rules.
 */
interface RobotsFilterResult {
  allowed: string[];
  blocked: Array<{ url: string; reason: string; rule?: string }>;
  /** Whether an override was used (global or per-source) */
  overrideUsed: boolean;
  /** Type of override if used */
  overrideType?: RobotsOverrideType;
}

/**
 * Filters URLs by robots.txt rules, grouping by domain.
 *
 * @param urls - URLs to filter
 * @param respectRobotsTxt - Whether to respect robots.txt (from source config)
 * @returns Object with allowed URLs, blocked URLs, and override info
 */
async function filterUrlsByRobotsRules(
  urls: string[],
  respectRobotsTxt: boolean
): Promise<RobotsFilterResult> {
  // Check for global override first
  if (isRobotsTxtGloballyDisabled()) {
    return {
      allowed: urls,
      blocked: [],
      overrideUsed: true,
      overrideType: RobotsOverrideType.GLOBAL_DISABLED,
    };
  }

  // Check for per-source override
  if (!respectRobotsTxt) {
    return {
      allowed: urls,
      blocked: [],
      overrideUsed: true,
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
    };
  }

  // Group URLs by domain
  const urlsByDomain = new Map<string, string[]>();
  for (const url of urls) {
    try {
      const domain = extractDomainForRobots(url);
      const domainUrls = urlsByDomain.get(domain) || [];
      domainUrls.push(url);
      urlsByDomain.set(domain, domainUrls);
    } catch {
      // Invalid URL, will be filtered out elsewhere
    }
  }

  const allowed: string[] = [];
  const blocked: Array<{ url: string; reason: string; rule?: string }> = [];
  const config = getDefaultRobotsTxtConfig();

  // Fetch and check robots.txt for each domain
  for (const [domain, domainUrls] of urlsByDomain) {
    const robotsTxt = await fetchRobotsTxt(domain, domainUrls[0]);
    const result = filterUrlsByRobotsTxt(robotsTxt, domainUrls, config);
    allowed.push(...result.allowed);
    blocked.push(...result.blocked);
  }

  return { allowed, blocked, overrideUsed: false };
}

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

  log.info("ingestion-worker", "Found initial URLs after pattern filtering", { urlCount: filteredUrls.length, runId });

  if (filteredUrls.length === 0) {
    // No URLs to process, finalize immediately
    log.info("ingestion-worker", "No URLs to process, finalizing run", { runId });
    await addSourceRunFinalizeJob({ tenantId, runId, requestId, traceId });
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
    // All URLs were blocked by robots.txt, finalize immediately
    log.info("ingestion-worker", "All URLs blocked by robots.txt, finalizing run", {
      runId,
      blockedCount: robotsResult.blocked.length,
      overrideUsed: robotsResult.overrideUsed,
    });
    await addSourceRunFinalizeJob({ tenantId, runId, requestId, traceId });
    return;
  }

  log.info("ingestion-worker", "Found initial URLs for run after robots.txt filtering", {
    urlCount: robotsFilteredUrls.length,
    robotsBlocked: robotsResult.blocked.length,
    overrideUsed: robotsResult.overrideUsed,
    runId,
  });

  // Queue URLs atomically using CrawlState
  // This returns only the truly new URLs (prevents duplicates)
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
      requestId,
      traceId,
    });
  }

  log.info("ingestion-worker", "Queued page fetch jobs for run", { jobCount: newUrls.length, runId });
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
