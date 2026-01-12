# Domain Crawling Architecture Improvements

## Problem Statement

The current crawling system stalls at ~152/713 pages due to:
1. **Race condition** in `pagesSeen` stat updates (concurrent read-modify-write)
2. **Premature finalization** - checks only DB count, not job queue
3. **No atomic URL deduplication** - URLs can be queued multiple times
4. **Stats stored in PostgreSQL** - slow for high-frequency updates

## Solution: Redis-Based Crawl State Management

Inspired by Firecrawl's architecture, we'll move crawl state tracking to Redis.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     REDIS CRAWL STATE                            │
├─────────────────────────────────────────────────────────────────┤
│  crawl:{runId}:urls:queued     SET    URLs added to fetch queue │
│  crawl:{runId}:urls:fetched    SET    URLs successfully fetched │
│  crawl:{runId}:urls:processed  SET    URLs fully processed      │
│  crawl:{runId}:urls:failed     SET    URLs that failed          │
│  crawl:{runId}:meta            HASH   Crawl metadata & config   │
│  crawl:{runId}:lock:{url}      STRING URL processing lock       │
└─────────────────────────────────────────────────────────────────┘

                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
    ┌─────────┐         ┌─────────┐         ┌─────────┐
    │ DISCOVER│         │  FETCH  │         │ PROCESS │
    │   JOB   │────────▶│   JOB   │────────▶│   JOB   │
    └─────────┘         └─────────┘         └─────────┘
         │                    │                    │
         │ SADD queued        │ SMOVE to fetched   │ SMOVE to processed
         │ (atomic)           │ (atomic)           │ (atomic)
         ▼                    ▼                    ▼
    ┌─────────────────────────────────────────────────┐
    │           COMPLETION CHECKER (periodic)          │
    │  IF SCARD(queued) == SCARD(processed) + SCARD(failed) │
    │  AND no active jobs in BullMQ                    │
    │  THEN trigger finalization                       │
    └─────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Redis Crawl State Module

Create `packages/crawl-state/src/index.ts`:

```typescript
import { Redis } from "ioredis";

export class CrawlState {
  private redis: Redis;
  private runId: string;
  private ttl: number = 86400; // 24 hours

  constructor(redis: Redis, runId: string) {
    this.redis = redis;
    this.runId = runId;
  }

  private key(suffix: string): string {
    return `crawl:${this.runId}:${suffix}`;
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
    const normalizedUrl = this.normalizeUrl(url);

    // SADD returns 1 if added, 0 if already exists
    const added = await this.redis.sadd(this.key("urls:queued"), normalizedUrl);

    if (added === 1) {
      await this.redis.expire(this.key("urls:queued"), this.ttl);
      return true;
    }
    return false;
  }

  /**
   * Queue multiple URLs atomically, returns only the new ones.
   */
  async queueUrls(urls: string[]): Promise<string[]> {
    if (urls.length === 0) return [];

    const normalized = urls.map(u => this.normalizeUrl(u));
    const pipeline = this.redis.pipeline();

    // Check each URL
    for (const url of normalized) {
      pipeline.sadd(this.key("urls:queued"), url);
    }

    const results = await pipeline.exec();
    const newUrls: string[] = [];

    results?.forEach((result, index) => {
      if (result[1] === 1) {
        newUrls.push(urls[index]); // Return original URL
      }
    });

    if (newUrls.length > 0) {
      await this.redis.expire(this.key("urls:queued"), this.ttl);
    }

    return newUrls;
  }

  /**
   * Mark URL as fetched (moves from queued to fetched set)
   */
  async markFetched(url: string): Promise<void> {
    const normalized = this.normalizeUrl(url);
    await this.redis.smove(
      this.key("urls:queued"),
      this.key("urls:fetched"),
      normalized
    );
    await this.redis.expire(this.key("urls:fetched"), this.ttl);
  }

  /**
   * Mark URL as processed (moves from fetched to processed set)
   */
  async markProcessed(url: string): Promise<void> {
    const normalized = this.normalizeUrl(url);
    await this.redis.smove(
      this.key("urls:fetched"),
      this.key("urls:processed"),
      normalized
    );
    await this.redis.expire(this.key("urls:processed"), this.ttl);
  }

  /**
   * Mark URL as failed
   */
  async markFailed(url: string, error: string): Promise<void> {
    const normalized = this.normalizeUrl(url);
    const pipeline = this.redis.pipeline();

    // Remove from queued/fetched, add to failed
    pipeline.srem(this.key("urls:queued"), normalized);
    pipeline.srem(this.key("urls:fetched"), normalized);
    pipeline.sadd(this.key("urls:failed"), normalized);
    pipeline.hset(this.key("errors"), normalized, error);

    await pipeline.exec();
  }

  // ============================================================
  // PROGRESS TRACKING
  // ============================================================

  async getProgress(): Promise<{
    queued: number;
    fetched: number;
    processed: number;
    failed: number;
    total: number;
    percentComplete: number;
  }> {
    const pipeline = this.redis.pipeline();
    pipeline.scard(this.key("urls:queued"));
    pipeline.scard(this.key("urls:fetched"));
    pipeline.scard(this.key("urls:processed"));
    pipeline.scard(this.key("urls:failed"));

    const results = await pipeline.exec();

    const queued = (results?.[0]?.[1] as number) || 0;
    const fetched = (results?.[1]?.[1] as number) || 0;
    const processed = (results?.[2]?.[1] as number) || 0;
    const failed = (results?.[3]?.[1] as number) || 0;

    const total = queued + fetched + processed + failed;
    const done = processed + failed;
    const percentComplete = total > 0 ? Math.round((done / total) * 100) : 0;

    return { queued, fetched, processed, failed, total, percentComplete };
  }

  /**
   * Check if crawl is complete (all URLs processed or failed)
   */
  async isComplete(): Promise<boolean> {
    const { queued, fetched } = await this.getProgress();
    return queued === 0 && fetched === 0;
  }

  // ============================================================
  // URL NORMALIZATION
  // ============================================================

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Remove trailing slash
      let path = parsed.pathname.replace(/\/+$/, '') || '/';

      // Remove index.html, index.php, etc.
      path = path.replace(/\/index\.(html?|php|asp)$/i, '/');

      // Lowercase host
      const host = parsed.host.toLowerCase();

      // Remove default ports
      const portlessHost = host.replace(/:80$/, '').replace(/:443$/, '');

      // Remove www prefix for deduplication
      const normalizedHost = portlessHost.replace(/^www\./, '');

      // Sort query params for consistency
      const params = new URLSearchParams(parsed.search);
      params.sort();
      const query = params.toString();

      return `${normalizedHost}${path}${query ? '?' + query : ''}`;
    } catch {
      return url.toLowerCase();
    }
  }

  // ============================================================
  // CLEANUP
  // ============================================================

  async cleanup(): Promise<void> {
    const keys = await this.redis.keys(`crawl:${this.runId}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
```

---

### Phase 2: Update Source Discovery

Modify `apps/ingestion-worker/src/processors/source-discover.ts`:

```typescript
import { CrawlState } from "@grounded/crawl-state";

export async function processSourceDiscover(job: Job<SourceDiscoverJob>) {
  const { runId, sourceId, tenantId } = job.data;
  const crawlState = new CrawlState(redis, runId);

  // Discover initial URLs (sitemap, domain root, etc.)
  const discoveredUrls = await discoverUrls(source);

  // Queue URLs atomically - only new ones are returned
  const newUrls = await crawlState.queueUrls(discoveredUrls);

  console.log(`Discovered ${discoveredUrls.length} URLs, ${newUrls.length} are new`);

  // Queue fetch jobs only for new URLs
  for (const url of newUrls) {
    await addPageFetchJob({
      runId,
      sourceId,
      tenantId,
      url,
      depth: 0,
    });
  }

  // Update PostgreSQL stats for UI (less frequent)
  await db.update(sourceRuns)
    .set({
      stats: sql`jsonb_set(stats, '{pagesSeen}', ${newUrls.length}::text::jsonb)`
    })
    .where(eq(sourceRuns.id, runId));
}
```

---

### Phase 3: Update Page Fetch

Modify `apps/scraper-worker/src/processors/page-fetch.ts`:

```typescript
export async function processPageFetch(job: Job<PageFetchJob>) {
  const { runId, url, depth } = job.data;
  const crawlState = new CrawlState(redis, runId);

  try {
    // Fetch the page
    const html = await fetchPage(url);

    // Mark as fetched in Redis
    await crawlState.markFetched(url);

    // Queue processing job
    await addPageProcessJob({
      runId,
      url,
      html,
      depth,
    });

  } catch (error) {
    await crawlState.markFailed(url, error.message);
    throw error;
  }
}
```

---

### Phase 4: Update Page Process with Atomic URL Discovery

Modify `apps/ingestion-worker/src/processors/page-process.ts`:

```typescript
export async function processPageProcess(job: Job<PageProcessJob>) {
  const { runId, url, html, depth } = job.data;
  const crawlState = new CrawlState(redis, runId);

  try {
    // Extract content and create chunks
    const { content, links } = extractContent(html);
    await createChunks(content);

    // Domain crawl: discover new URLs atomically
    if (source.config.mode === "domain" && depth < maxDepth) {
      const validLinks = filterLinks(links, source.config);

      // This is atomic - only returns truly new URLs
      const newUrls = await crawlState.queueUrls(validLinks);

      console.log(`Found ${links.length} links, ${newUrls.length} are new`);

      // Queue fetch jobs for new URLs only
      for (const newUrl of newUrls) {
        await addPageFetchJob({
          runId,
          url: newUrl,
          depth: depth + 1,
        });
      }
    }

    // Mark as processed
    await crawlState.markProcessed(url);

    // Check completion (lightweight Redis check)
    await checkAndMaybeFinalize(runId, crawlState);

  } catch (error) {
    await crawlState.markFailed(url, error.message);
    throw error;
  }
}

async function checkAndMaybeFinalize(runId: string, crawlState: CrawlState) {
  const progress = await crawlState.getProgress();

  // Only finalize if ALL URLs are in terminal state
  if (progress.queued === 0 && progress.fetched === 0) {
    // Double-check no jobs in BullMQ
    const fetchPending = await pageFetchQueue.getWaitingCount();
    const fetchActive = await pageFetchQueue.getActiveCount();
    const processPending = await pageProcessQueue.getWaitingCount();
    const processActive = await pageProcessQueue.getActiveCount();

    if (fetchPending === 0 && fetchActive === 0 &&
        processPending === 0 && processActive === 0) {

      // Safe to finalize
      await addSourceFinalizeJob({ runId });
    }
  }
}
```

---

### Phase 5: Update Stats Display

The UI should show Redis-based stats for accuracy:

```typescript
// New API endpoint: GET /sources/:sourceId/runs/:runId/progress
app.get("/runs/:runId/progress", async (c) => {
  const crawlState = new CrawlState(redis, runId);
  const progress = await crawlState.getProgress();

  return c.json({
    total: progress.total,
    processed: progress.processed,
    failed: progress.failed,
    inProgress: progress.queued + progress.fetched,
    percentComplete: progress.percentComplete,
  });
});
```

---

## Migration Path

1. **Phase 1**: Add `@grounded/crawl-state` package (no breaking changes)
2. **Phase 2**: Update discovery to use Redis (backwards compatible)
3. **Phase 3**: Update fetch to track state (backwards compatible)
4. **Phase 4**: Update process with atomic discovery (fixes race condition)
5. **Phase 5**: Update UI to show accurate progress
6. **Phase 6**: Remove legacy PostgreSQL stats updates

---

## Expected Improvements

| Metric | Before | After |
|--------|--------|-------|
| Race conditions | Frequent | None (atomic Redis ops) |
| Duplicate URLs queued | Common | Impossible |
| Premature finalization | Yes | No (checks queues) |
| Stats accuracy | ~50% | 100% |
| Crawl completion | Stalls | Reliable |

---

## Additional Firecrawl-Inspired Features

### 1. URL Permutation for Better Deduplication

```typescript
function generateUrlPermutations(url: string): string[] {
  const parsed = new URL(url);
  const variants: string[] = [];

  // With/without www
  const hosts = [parsed.host];
  if (parsed.host.startsWith('www.')) {
    hosts.push(parsed.host.slice(4));
  } else {
    hosts.push('www.' + parsed.host);
  }

  // With/without trailing slash
  const paths = [parsed.pathname];
  if (parsed.pathname.endsWith('/')) {
    paths.push(parsed.pathname.slice(0, -1));
  } else {
    paths.push(parsed.pathname + '/');
  }

  // Generate all combinations
  for (const host of hosts) {
    for (const path of paths) {
      variants.push(`${parsed.protocol}//${host}${path}${parsed.search}`);
    }
  }

  return variants;
}
```

### 2. Crawl Limits

```typescript
async queueUrl(url: string, maxUrls: number = 10000): Promise<boolean> {
  // Check limit before adding
  const currentCount = await this.redis.scard(this.key("urls:queued"));
  if (currentCount >= maxUrls) {
    console.warn(`Crawl limit reached: ${maxUrls} URLs`);
    return false;
  }

  // ... rest of implementation
}
```

### 3. Periodic Completion Checker

Instead of checking after every page, run a periodic job:

```typescript
// Run every 30 seconds
const completionChecker = new Worker("crawl-completion", async (job) => {
  const { runId } = job.data;
  const crawlState = new CrawlState(redis, runId);

  if (await crawlState.isComplete()) {
    await addSourceFinalizeJob({ runId });
  }
}, {
  connection: redis,
  limiter: { max: 1, duration: 30000 }
});
```

---

## Files to Modify

1. `packages/crawl-state/` - New package (create)
2. `apps/ingestion-worker/src/processors/source-discover.ts` - Use CrawlState
3. `apps/scraper-worker/src/processors/page-fetch.ts` - Track fetched state
4. `apps/ingestion-worker/src/processors/page-process.ts` - Atomic URL discovery
5. `apps/ingestion-worker/src/processors/source-finalize.ts` - Use Redis stats
6. `apps/api/src/routes/sources.ts` - Add progress endpoint
7. `apps/web/src/pages/Sources.tsx` - Show accurate progress
