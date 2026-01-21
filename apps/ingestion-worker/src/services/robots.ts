import { log } from "@grounded/logger";
import { redis } from "@grounded/queue";
import {
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
  RobotsOverrideType,
} from "@grounded/shared";

// Cache for parsed robots.txt by domain (in-memory for current process)
const robotsTxtCache = new Map<string, { parsed: ParsedRobotsTxt; expiresAt: number }>();

/**
 * Result of filtering URLs by robots.txt rules.
 */
export interface RobotsFilterResult {
  allowed: string[];
  blocked: Array<{ url: string; reason: string; rule?: string }>;
  /** Whether an override was used (global or per-source) */
  overrideUsed: boolean;
  /** Type of override if used */
  overrideType?: RobotsOverrideType;
}

/**
 * Fetches and parses robots.txt for a domain.
 * Uses Redis cache for persistence across workers.
 *
 * @param domain - The domain to fetch robots.txt for
 * @param url - A sample URL from the domain (used to build robots.txt URL)
 * @returns Parsed robots.txt
 */
export async function fetchRobotsTxt(domain: string, url: string): Promise<ParsedRobotsTxt> {
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
 * Filters URLs by robots.txt rules, grouping by domain.
 *
 * @param urls - URLs to filter
 * @param respectRobotsTxt - Whether to respect robots.txt (from source config)
 * @returns Object with allowed URLs, blocked URLs, and override info
 */
export async function filterUrlsByRobotsRules(
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
