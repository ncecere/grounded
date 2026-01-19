import type { Redis } from "ioredis";

export interface CrawlProgress {
  queued: number;
  fetched: number;
  processed: number;
  failed: number;
  total: number;
  percentComplete: number;
}

export interface CrawlStateOptions {
  ttl?: number; // TTL in seconds, default 24 hours
  maxUrls?: number; // Maximum URLs to crawl, default 10000
}

/**
 * Redis-based crawl state management.
 *
 * Uses atomic Redis operations to prevent race conditions in URL tracking.
 * All URL operations use SADD which is atomic and returns whether the URL was new.
 *
 * State flow:
 *   queued → fetched → processed
 *                   ↘ failed
 */
export class CrawlState {
  private redis: Redis;
  private runId: string;
  private ttl: number;
  private maxUrls: number;

  constructor(redis: Redis, runId: string, options: CrawlStateOptions = {}) {
    this.redis = redis;
    this.runId = runId;
    this.ttl = options.ttl ?? 86400; // 24 hours default
    this.maxUrls = options.maxUrls ?? 10000;
  }

  private key(suffix: string): string {
    return `crawl:${this.runId}:${suffix}`;
  }

  // ============================================================
  // URL NORMALIZATION
  // ============================================================

  /**
   * Normalize URL for deduplication.
   * Handles: trailing slashes, www prefix, default ports, query param order, index files
   */
  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Remove trailing slash (except for root)
      let path = parsed.pathname.replace(/\/+$/, "") || "/";

      // Remove index.html, index.php, etc.
      path = path.replace(/\/index\.(html?|php|aspx?)$/i, "/");

      // Lowercase host
      let host = parsed.host.toLowerCase();

      // Remove default ports
      host = host.replace(/:80$/, "").replace(/:443$/, "");

      // Remove www prefix for deduplication
      host = host.replace(/^www\./, "");

      // Sort query params for consistency
      const params = new URLSearchParams(parsed.search);
      params.sort();
      const query = params.toString();

      // Remove hash/fragment
      return `${host}${path}${query ? "?" + query : ""}`;
    } catch {
      return url.toLowerCase().trim();
    }
  }

  /**
   * Generate URL permutations for thorough deduplication.
   * Checks if any variant of the URL has been seen.
   */
  generateUrlPermutations(url: string): string[] {
    try {
      const parsed = new URL(url);
      const variants: string[] = [];

      // With/without www
      const hosts: string[] = [parsed.host.toLowerCase()];
      if (parsed.host.toLowerCase().startsWith("www.")) {
        hosts.push(parsed.host.toLowerCase().slice(4));
      } else {
        hosts.push("www." + parsed.host.toLowerCase());
      }

      // With/without trailing slash
      const paths: string[] = [parsed.pathname];
      if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
        paths.push(parsed.pathname.slice(0, -1));
      } else if (parsed.pathname !== "/") {
        paths.push(parsed.pathname + "/");
      }

      // Generate combinations (normalized form)
      for (const host of hosts) {
        for (const path of paths) {
          const normalizedHost = host.replace(/^www\./, "");
          const normalizedPath = path.replace(/\/+$/, "") || "/";
          variants.push(`${normalizedHost}${normalizedPath}`);
        }
      }

      // Remove duplicates
      return [...new Set(variants)];
    } catch {
      return [this.normalizeUrl(url)];
    }
  }

  // ============================================================
  // URL MANAGEMENT - All operations are atomic
  // ============================================================

  /**
   * Attempt to queue a URL for fetching.
   * Returns true if URL was added (not seen before), false if duplicate.
   * This is the ONLY way to add URLs - prevents race conditions.
   */
  async queueUrl(url: string): Promise<boolean> {
    // Check limit before adding
    const currentCount = await this.redis.scard(this.key("urls:all"));
    if (currentCount >= this.maxUrls) {
      console.warn(`[CrawlState] Crawl limit reached: ${this.maxUrls} URLs`);
      return false;
    }

    const normalizedUrl = this.normalizeUrl(url);

    // Use pipeline for atomic check-and-add
    const pipeline = this.redis.pipeline();
    pipeline.sadd(this.key("urls:all"), normalizedUrl); // Track all seen URLs
    pipeline.sadd(this.key("urls:queued"), normalizedUrl);

    const results = await pipeline.exec();

    // First SADD returns 1 if URL is new to "all" set
    const isNew = results?.[0]?.[1] === 1;

    if (isNew) {
      // Set TTL on first add
      await this.redis.expire(this.key("urls:all"), this.ttl);
      await this.redis.expire(this.key("urls:queued"), this.ttl);
    } else {
      // URL was already seen, remove from queued if we just added it
      await this.redis.srem(this.key("urls:queued"), normalizedUrl);
    }

    return isNew;
  }

  /**
   * Queue multiple URLs atomically, returns only the new ones.
   * Much more efficient than calling queueUrl() in a loop.
   */
  async queueUrls(urls: string[]): Promise<string[]> {
    if (urls.length === 0) return [];

    // Check current count
    const currentCount = await this.redis.scard(this.key("urls:all"));
    const remainingCapacity = this.maxUrls - currentCount;

    if (remainingCapacity <= 0) {
      console.warn(`[CrawlState] Crawl limit reached: ${this.maxUrls} URLs`);
      return [];
    }

    // Limit URLs to remaining capacity
    const urlsToProcess = urls.slice(0, remainingCapacity);
    const normalizedMap = new Map<string, string>(); // normalized -> original

    for (const url of urlsToProcess) {
      const normalized = this.normalizeUrl(url);
      if (!normalizedMap.has(normalized)) {
        normalizedMap.set(normalized, url);
      }
    }

    const normalizedUrls = Array.from(normalizedMap.keys());

    // Use pipeline to check all URLs atomically
    const pipeline = this.redis.pipeline();
    for (const normalized of normalizedUrls) {
      pipeline.sadd(this.key("urls:all"), normalized);
    }

    const results = await pipeline.exec();
    const newUrls: string[] = [];

    // Second pipeline to add only new URLs to queued set
    const queuePipeline = this.redis.pipeline();
    let hasNew = false;

    results?.forEach((result, index) => {
      // SADD returns 1 if the element was added (didn't exist before)
      if (result[1] === 1) {
        const normalized = normalizedUrls[index];
        const originalUrl = normalizedMap.get(normalized)!;
        newUrls.push(originalUrl);
        queuePipeline.sadd(this.key("urls:queued"), normalized);
        // Store mapping from normalized to original URL
        queuePipeline.hset(this.key("urls:original"), normalized, originalUrl);
        hasNew = true;
      }
    });

    if (hasNew) {
      await queuePipeline.exec();
      await this.redis.expire(this.key("urls:all"), this.ttl);
      await this.redis.expire(this.key("urls:queued"), this.ttl);
      await this.redis.expire(this.key("urls:original"), this.ttl);
    }

    if (newUrls.length < urls.length) {
      const skipped = urls.length - newUrls.length;
      console.log(`[CrawlState] Queued ${newUrls.length} URLs, skipped ${skipped} duplicates`);
    }

    return newUrls;
  }

  /**
   * Check if a URL has already been seen (in any state).
   */
  async hasUrl(url: string): Promise<boolean> {
    const normalized = this.normalizeUrl(url);
    const exists = await this.redis.sismember(this.key("urls:all"), normalized);
    return exists === 1;
  }

  /**
   * Mark URL as fetched (moves from queued to fetched set).
   * Called after successfully downloading a page.
   */
  async markFetched(url: string): Promise<void> {
    const normalized = this.normalizeUrl(url);
    const pipeline = this.redis.pipeline();

    pipeline.srem(this.key("urls:queued"), normalized);
    pipeline.sadd(this.key("urls:fetched"), normalized);

    await pipeline.exec();
    await this.redis.expire(this.key("urls:fetched"), this.ttl);
  }

  /**
   * Mark URL as processed (moves from fetched to processed set).
   * Called after content extraction and chunk creation.
   */
  async markProcessed(url: string): Promise<void> {
    const normalized = this.normalizeUrl(url);
    const pipeline = this.redis.pipeline();

    pipeline.srem(this.key("urls:fetched"), normalized);
    pipeline.sadd(this.key("urls:processed"), normalized);

    await pipeline.exec();
    await this.redis.expire(this.key("urls:processed"), this.ttl);
  }

  /**
   * Mark URL as failed.
   * Removes from queued/fetched and adds to failed set with error message.
   */
  async markFailed(url: string, error?: string): Promise<void> {
    const normalized = this.normalizeUrl(url);
    const pipeline = this.redis.pipeline();

    pipeline.srem(this.key("urls:queued"), normalized);
    pipeline.srem(this.key("urls:fetched"), normalized);
    pipeline.sadd(this.key("urls:failed"), normalized);

    if (error) {
      pipeline.hset(this.key("errors"), normalized, error.slice(0, 500));
    }

    await pipeline.exec();
    await this.redis.expire(this.key("urls:failed"), this.ttl);
    if (error) {
      await this.redis.expire(this.key("errors"), this.ttl);
    }
  }

  // ============================================================
  // PROGRESS TRACKING
  // ============================================================

  /**
   * Get current crawl progress.
   * All counts are from Redis sets, so they're always accurate.
   */
  async getProgress(): Promise<CrawlProgress> {
    const pipeline = this.redis.pipeline();
    pipeline.scard(this.key("urls:queued"));
    pipeline.scard(this.key("urls:fetched"));
    pipeline.scard(this.key("urls:processed"));
    pipeline.scard(this.key("urls:failed"));
    pipeline.scard(this.key("urls:all"));

    const results = await pipeline.exec();

    const queued = (results?.[0]?.[1] as number) || 0;
    const fetched = (results?.[1]?.[1] as number) || 0;
    const processed = (results?.[2]?.[1] as number) || 0;
    const failed = (results?.[3]?.[1] as number) || 0;
    const total = (results?.[4]?.[1] as number) || 0;

    const done = processed + failed;
    const percentComplete = total > 0 ? Math.round((done / total) * 100) : 0;

    return { queued, fetched, processed, failed, total, percentComplete };
  }

  /**
   * Check if crawl is complete (all URLs processed or failed).
   * A crawl is complete when there are no URLs in queued or fetched state.
   */
  async isComplete(): Promise<boolean> {
    const { queued, fetched } = await this.getProgress();
    return queued === 0 && fetched === 0;
  }

  /**
   * Get list of failed URLs with their error messages.
   */
  async getFailedUrls(): Promise<Array<{ url: string; error: string }>> {
    const failedUrls = await this.redis.smembers(this.key("urls:failed"));
    const errors = await this.redis.hgetall(this.key("errors"));

    return failedUrls.map((url) => ({
      url,
      error: errors[url] || "Unknown error",
    }));
  }

  /**
   * Get all queued URLs (discovered but not yet fetched).
   * Used by the stage manager to queue fetch jobs for the SCRAPING stage.
   * Returns the original URLs (with protocol), not normalized URLs.
   */
  async getQueuedUrls(): Promise<string[]> {
    const normalizedUrls = await this.redis.smembers(this.key("urls:queued"));
    if (normalizedUrls.length === 0) return [];
    
    // Get original URLs from the mapping
    const originalUrls = await this.redis.hmget(this.key("urls:original"), ...normalizedUrls);
    
    // Return original URLs, falling back to https:// + normalized if mapping is missing
    return normalizedUrls.map((normalized, index) => {
      const original = originalUrls[index];
      if (original) return original;
      // Fallback: assume https protocol if no mapping exists
      return `https://${normalized}`;
    });
  }

  // ============================================================
  // METADATA
  // ============================================================

  /**
   * Store crawl metadata (config, options, etc.)
   */
  async setMetadata(data: Record<string, string | number | boolean>): Promise<void> {
    const stringified: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      stringified[key] = String(value);
    }
    await this.redis.hset(this.key("meta"), stringified);
    await this.redis.expire(this.key("meta"), this.ttl);
  }

  /**
   * Get crawl metadata.
   */
  async getMetadata(): Promise<Record<string, string>> {
    return await this.redis.hgetall(this.key("meta"));
  }

  // ============================================================
  // CLEANUP
  // ============================================================

  /**
   * Delete all Redis keys for this crawl.
   * Call after crawl is complete and data has been persisted to PostgreSQL.
   */
  async cleanup(): Promise<void> {
    const keys = await this.redis.keys(`crawl:${this.runId}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

/**
 * Factory function to create CrawlState instances.
 * Can be used with a shared Redis connection.
 */
export function createCrawlState(
  redis: Redis,
  runId: string,
  options?: CrawlStateOptions
): CrawlState {
  return new CrawlState(redis, runId, options);
}
