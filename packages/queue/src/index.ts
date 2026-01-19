import { Queue, Worker, Job, QueueEvents, ConnectionOptions, DelayedError } from "bullmq";
import { Redis } from "ioredis";
import {
  QUEUE_NAMES,
  JOB_RETRY_ATTEMPTS,
  JOB_RETRY_DELAY_MS,
  JOB_BACKOFF_TYPE,
  getEnv,
  generateDeterministicEmbedJobId,
  type SourceRunStartJob,
  type SourceDiscoverUrlsJob,
  type PageFetchJob,
  type PageProcessJob,
  type PageIndexJob,
  type EmbedChunksBatchJob,
  type EnrichPageJob,
  type SourceRunFinalizeJob,
  type HardDeleteObjectJob,
  type KbReindexJob,
  type StageTransitionJob,
} from "@grounded/shared";

// ============================================================================
// Redis Connection
// ============================================================================

const redisUrl = getEnv("REDIS_URL", "redis://localhost:6379");

export const connection: ConnectionOptions = {
  host: new URL(redisUrl).hostname,
  port: parseInt(new URL(redisUrl).port || "6379"),
  password: new URL(redisUrl).password || undefined,
};

export const redis = new Redis(redisUrl);

// ============================================================================
// Queue Definitions
// ============================================================================

export const sourceRunQueue = new Queue<SourceRunStartJob | SourceDiscoverUrlsJob | SourceRunFinalizeJob>(
  QUEUE_NAMES.SOURCE_RUN,
  {
    connection,
    defaultJobOptions: {
      attempts: JOB_RETRY_ATTEMPTS,
      backoff: {
        type: JOB_BACKOFF_TYPE,
        delay: JOB_RETRY_DELAY_MS,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  }
);

export const pageFetchQueue = new Queue<PageFetchJob>(QUEUE_NAMES.PAGE_FETCH, {
  connection,
  defaultJobOptions: {
    attempts: JOB_RETRY_ATTEMPTS,
    backoff: {
      type: JOB_BACKOFF_TYPE,
      delay: JOB_RETRY_DELAY_MS,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export const pageProcessQueue = new Queue<PageProcessJob>(QUEUE_NAMES.PAGE_PROCESS, {
  connection,
  defaultJobOptions: {
    attempts: JOB_RETRY_ATTEMPTS,
    backoff: {
      type: JOB_BACKOFF_TYPE,
      delay: JOB_RETRY_DELAY_MS,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export const pageIndexQueue = new Queue<PageIndexJob>(QUEUE_NAMES.PAGE_INDEX, {
  connection,
  defaultJobOptions: {
    attempts: JOB_RETRY_ATTEMPTS,
    backoff: {
      type: JOB_BACKOFF_TYPE,
      delay: JOB_RETRY_DELAY_MS,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export const embedChunksQueue = new Queue<EmbedChunksBatchJob>(QUEUE_NAMES.EMBED_CHUNKS, {
  connection,
  defaultJobOptions: {
    attempts: JOB_RETRY_ATTEMPTS,
    backoff: {
      type: JOB_BACKOFF_TYPE,
      delay: JOB_RETRY_DELAY_MS,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export const enrichPageQueue = new Queue<EnrichPageJob>(QUEUE_NAMES.ENRICH_PAGE, {
  connection,
  defaultJobOptions: {
    attempts: JOB_RETRY_ATTEMPTS,
    backoff: {
      type: JOB_BACKOFF_TYPE,
      delay: JOB_RETRY_DELAY_MS,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export const deletionQueue = new Queue<HardDeleteObjectJob>(QUEUE_NAMES.DELETION, {
  connection,
  defaultJobOptions: {
    attempts: JOB_RETRY_ATTEMPTS,
    backoff: {
      type: JOB_BACKOFF_TYPE,
      delay: JOB_RETRY_DELAY_MS,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export const kbReindexQueue = new Queue<KbReindexJob>(QUEUE_NAMES.KB_REINDEX, {
  connection,
  defaultJobOptions: {
    attempts: 1, // Don't retry reindex jobs - they can be restarted manually
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

// ============================================================================
// Queue Events
// ============================================================================

export const sourceRunEvents = new QueueEvents(QUEUE_NAMES.SOURCE_RUN, { connection });
export const pageFetchEvents = new QueueEvents(QUEUE_NAMES.PAGE_FETCH, { connection });
export const pageProcessEvents = new QueueEvents(QUEUE_NAMES.PAGE_PROCESS, { connection });
export const pageIndexEvents = new QueueEvents(QUEUE_NAMES.PAGE_INDEX, { connection });
export const embedChunksEvents = new QueueEvents(QUEUE_NAMES.EMBED_CHUNKS, { connection });

// ============================================================================
// Job Helpers
// ============================================================================

export async function addSourceRunStartJob(data: SourceRunStartJob): Promise<Job> {
  return sourceRunQueue.add("start", data, {
    jobId: `source-run-start-${data.runId}`,
  });
}

export async function addSourceDiscoverUrlsJob(data: SourceDiscoverUrlsJob): Promise<Job> {
  return sourceRunQueue.add("discover", data, {
    jobId: `source-discover-${data.runId}`,
  });
}

export interface JobOptions {
  priority?: number;
}

export async function addPageFetchJob(data: PageFetchJob, options?: JobOptions): Promise<Job> {
  // Use full base64 URL to ensure unique job IDs (truncation caused collisions)
  const urlHash = Buffer.from(data.url).toString("base64url");
  return pageFetchQueue.add("fetch", data, {
    jobId: `page-fetch-${data.runId}-${urlHash}`,
    priority: options?.priority,
  });
}

export async function addPageProcessJob(data: PageProcessJob, options?: JobOptions): Promise<Job> {
  // Use full base64 URL to ensure unique job IDs (truncation caused collisions)
  const urlHash = Buffer.from(data.url).toString("base64url");
  return pageProcessQueue.add("process", data, {
    jobId: `page-process-${data.runId}-${urlHash}`,
    priority: options?.priority,
  });
}

export async function addPageIndexJob(data: PageIndexJob, options?: JobOptions): Promise<Job> {
  return pageIndexQueue.add("index", data, {
    jobId: `page-index-${data.runId}-${data.pageId}`,
    priority: options?.priority,
  });
}

export async function addEmbedChunksBatchJob(data: EmbedChunksBatchJob, options?: JobOptions): Promise<Job> {
  // Generate deterministic job ID based on chunk IDs
  // This ensures:
  // 1. Same chunks always produce the same job ID (idempotent re-queuing)
  // 2. BullMQ will deduplicate jobs with the same ID
  // 3. Better tracking and debugging with predictable IDs
  const { jobId } = generateDeterministicEmbedJobId(data.kbId, data.chunkIds);

  return embedChunksQueue.add("embed", data, {
    jobId,
    priority: options?.priority,
  });
}

export async function addEnrichPageJob(data: EnrichPageJob): Promise<Job> {
  return enrichPageQueue.add("enrich", data, {
    jobId: `enrich-${data.kbId}-${Date.now()}`,
  });
}

export async function addSourceRunFinalizeJob(data: SourceRunFinalizeJob): Promise<Job> {
  return sourceRunQueue.add("finalize", data, {
    jobId: `source-run-finalize-${data.runId}`,
  });
}

export async function addHardDeleteJob(data: HardDeleteObjectJob): Promise<Job> {
  return deletionQueue.add("delete", data, {
    jobId: `delete-${data.objectType}-${data.objectId}`,
  });
}

export async function addKbReindexJob(data: KbReindexJob): Promise<Job> {
  return kbReindexQueue.add("reindex", data, {
    jobId: `kb-reindex-${data.kbId}`,
  });
}

export async function addStageTransitionJob(data: StageTransitionJob): Promise<Job> {
  return sourceRunQueue.add("stage-transition", data, {
    jobId: `stage-transition-${data.runId}-${data.completedStage}`,
  });
}

// ============================================================================
// Job Cleanup for Canceled Runs
// ============================================================================

/**
 * Remove all pending embed jobs for a given source run.
 * This should be called when a source run is canceled to prevent
 * wasted embedding API calls and queue blockage.
 * 
 * @returns The number of jobs removed
 */
export async function removeEmbedJobsForRun(runId: string): Promise<number> {
  let removed = 0;
  
  // Get all waiting jobs and filter by runId
  // BullMQ stores job data in Redis, so we need to check each job
  const waitingJobs = await embedChunksQueue.getJobs(["waiting", "delayed"]);
  
  for (const job of waitingJobs) {
    if (job.data?.runId === runId) {
      try {
        await job.remove();
        removed++;
      } catch (error) {
        // Job might have already been processed or removed
        // This is fine, just continue
      }
    }
  }
  
  return removed;
}

/**
 * Remove all pending source-run jobs (start, discover, finalize, stage-transition) for a given run.
 */
export async function removeSourceRunJobsForRun(runId: string): Promise<number> {
  let removed = 0;
  
  const waitingJobs = await sourceRunQueue.getJobs(["waiting", "delayed"]);
  
  for (const job of waitingJobs) {
    if (job.data?.runId === runId) {
      try {
        await job.remove();
        removed++;
      } catch (error) {
        // Job might have already been processed or removed
      }
    }
  }
  
  return removed;
}

/**
 * Remove all pending page-fetch jobs for a given source run.
 */
export async function removePageFetchJobsForRun(runId: string): Promise<number> {
  let removed = 0;
  
  const waitingJobs = await pageFetchQueue.getJobs(["waiting", "delayed"]);
  
  for (const job of waitingJobs) {
    if (job.data?.runId === runId) {
      try {
        await job.remove();
        removed++;
      } catch (error) {
        // Job might have already been processed or removed
      }
    }
  }
  
  return removed;
}

/**
 * Remove all pending page-process jobs for a given source run.
 */
export async function removePageProcessJobsForRun(runId: string): Promise<number> {
  let removed = 0;
  
  const waitingJobs = await pageProcessQueue.getJobs(["waiting", "delayed"]);
  
  for (const job of waitingJobs) {
    if (job.data?.runId === runId) {
      try {
        await job.remove();
        removed++;
      } catch (error) {
        // Job might have already been processed or removed
      }
    }
  }
  
  return removed;
}

/**
 * Remove all pending page-index jobs for a given source run.
 */
export async function removePageIndexJobsForRun(runId: string): Promise<number> {
  let removed = 0;
  
  const waitingJobs = await pageIndexQueue.getJobs(["waiting", "delayed"]);
  
  for (const job of waitingJobs) {
    if (job.data?.runId === runId) {
      try {
        await job.remove();
        removed++;
      } catch (error) {
        // Job might have already been processed or removed
      }
    }
  }
  
  return removed;
}

/**
 * Clean up all Redis state for a canceled run.
 * This includes pending index jobs counter, crawl state, and stage batch tracking.
 */
export async function cleanupRunRedisState(runId: string): Promise<void> {
  // Delete pending index jobs counter
  await redis.del(`pending_index_jobs:${runId}`);
  
  // Delete stage batch pending key
  await redis.del(`batch:${runId}:pending`);
  
  // Delete crawl state keys (pattern: crawl:{runId}:*)
  const crawlKeys = await redis.keys(`crawl:${runId}:*`);
  if (crawlKeys.length > 0) {
    await redis.del(...crawlKeys);
  }
  
  // Delete chunk embed status keys (pattern: chunk_embed_status:{runId}:*)
  const embedStatusKeys = await redis.keys(`chunk_embed_status:${runId}:*`);
  if (embedStatusKeys.length > 0) {
    await redis.del(...embedStatusKeys);
  }
}

/**
 * Remove all pending jobs across all queues for a given source run.
 * Call this when canceling a source run to clean up the queue.
 * Also cleans up Redis state.
 * 
 * @returns Object with count of removed jobs per queue
 */
export async function removeAllJobsForRun(runId: string): Promise<{
  sourceRun: number;
  pageFetch: number;
  pageProcess: number;
  pageIndex: number;
  embed: number;
  total: number;
}> {
  // Clean up all Redis state for this run
  await cleanupRunRedisState(runId);
  
  const [sourceRun, pageFetch, pageProcess, pageIndex, embed] = await Promise.all([
    removeSourceRunJobsForRun(runId),
    removePageFetchJobsForRun(runId),
    removePageProcessJobsForRun(runId),
    removePageIndexJobsForRun(runId),
    removeEmbedJobsForRun(runId),
  ]);
  
  return {
    sourceRun,
    pageFetch,
    pageProcess,
    pageIndex,
    embed,
    total: sourceRun + pageFetch + pageProcess + pageIndex + embed,
  };
}

// ============================================================================
// Rate Limiting
// ============================================================================

const RATE_LIMIT_PREFIX = "rate_limit:";

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const fullKey = `${RATE_LIMIT_PREFIX}${key}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  // Remove old entries and count current
  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(fullKey, 0, windowStart);
  pipeline.zcard(fullKey);
  pipeline.zadd(fullKey, now, `${now}-${Math.random()}`);
  pipeline.expire(fullKey, windowSeconds);

  const results = await pipeline.exec();
  const currentCount = (results?.[1]?.[1] as number) || 0;

  return {
    allowed: currentCount < limit,
    remaining: Math.max(0, limit - currentCount - 1),
    resetAt: now + windowSeconds * 1000,
  };
}

// ============================================================================
// Conversation Memory (Redis-based)
// ============================================================================

const CONVERSATION_PREFIX = "conv:";
const CONVERSATION_TTL = 60 * 60; // 1 hour
const MAX_TURNS = 20;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export async function getConversation(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<ConversationTurn[]> {
  const key = `${CONVERSATION_PREFIX}${tenantId}:${agentId}:${conversationId}`;
  const data = await redis.get(key);
  if (!data) return [];
  return JSON.parse(data);
}

export async function addToConversation(
  tenantId: string,
  agentId: string,
  conversationId: string,
  turn: ConversationTurn
): Promise<void> {
  const key = `${CONVERSATION_PREFIX}${tenantId}:${agentId}:${conversationId}`;
  const existing = await getConversation(tenantId, agentId, conversationId);

  // Add new turn and keep only last MAX_TURNS
  const updated = [...existing, turn].slice(-MAX_TURNS);

  await redis.setex(key, CONVERSATION_TTL, JSON.stringify(updated));
}

export async function clearConversation(
  tenantId: string,
  agentId: string,
  conversationId: string
): Promise<void> {
  const key = `${CONVERSATION_PREFIX}${tenantId}:${agentId}:${conversationId}`;
  await redis.del(key);
}

// ============================================================================
// Per-Tenant and Per-Domain Concurrency Limiting
// ============================================================================

import {
  type ConcurrencyCheckResult,
  type CombinedConcurrencyCheckResult,
  type ActiveJobTracker,
  type ConcurrencyLimitOptions,
  type TenantQuotas,
  buildTenantConcurrencyKey,
  buildDomainConcurrencyKey,
  buildTenantDomainConcurrencyKey,
  extractDomainFromUrl,
  getTenantConcurrencyLimit,
  resolveDomainConcurrency,
  getConcurrencyKeyTtl,
  DEFAULT_TENANT_CONCURRENCY,
  DEFAULT_DOMAIN_CONCURRENCY,
} from "@grounded/shared";

/**
 * Checks if a tenant has capacity for another concurrent fetch job.
 * Uses Redis INCR/DECR pattern for atomic counting.
 *
 * @param tenantId - The tenant identifier
 * @param limit - Maximum allowed concurrent jobs for this tenant
 * @returns Check result with current count and allowed status
 */
export async function checkTenantConcurrency(
  tenantId: string,
  limit: number = DEFAULT_TENANT_CONCURRENCY
): Promise<ConcurrencyCheckResult> {
  const key = buildTenantConcurrencyKey(tenantId);
  const current = await redis.get(key);
  const currentCount = current ? parseInt(current, 10) : 0;

  return {
    allowed: currentCount < limit,
    current: currentCount,
    limit,
    key,
    reason: currentCount >= limit ? "tenant_limit" : undefined,
  };
}

/**
 * Checks if a domain has capacity for another concurrent fetch job.
 * This limit applies globally across all tenants to protect target servers.
 *
 * @param domain - The normalized domain
 * @param limit - Maximum allowed concurrent jobs for this domain
 * @returns Check result with current count and allowed status
 */
export async function checkDomainConcurrency(
  domain: string,
  limit: number = DEFAULT_DOMAIN_CONCURRENCY
): Promise<ConcurrencyCheckResult> {
  const key = buildDomainConcurrencyKey(domain);
  const current = await redis.get(key);
  const currentCount = current ? parseInt(current, 10) : 0;

  return {
    allowed: currentCount < limit,
    current: currentCount,
    limit,
    key,
    reason: currentCount >= limit ? "domain_limit" : undefined,
  };
}

/**
 * Checks combined tenant+domain concurrency limit.
 * Optional stricter limit for per-tenant-per-domain control.
 *
 * @param tenantId - The tenant identifier
 * @param domain - The normalized domain
 * @param limit - Maximum allowed concurrent jobs for this tenant+domain
 * @returns Check result with current count and allowed status
 */
export async function checkTenantDomainConcurrency(
  tenantId: string,
  domain: string,
  limit: number
): Promise<ConcurrencyCheckResult> {
  const key = buildTenantDomainConcurrencyKey(tenantId, domain);
  const current = await redis.get(key);
  const currentCount = current ? parseInt(current, 10) : 0;

  return {
    allowed: currentCount < limit,
    current: currentCount,
    limit,
    key,
    reason: currentCount >= limit ? "tenant_domain_limit" : undefined,
  };
}

/**
 * Checks all applicable concurrency limits for a fetch job.
 * Returns combined result indicating whether the job can proceed.
 *
 * @param tenantId - The tenant identifier
 * @param url - The URL being fetched (domain extracted automatically)
 * @param options - Concurrency limit options
 * @returns Combined check result
 */
export async function checkFetchConcurrencyLimits(
  tenantId: string,
  url: string,
  options: ConcurrencyLimitOptions = {}
): Promise<CombinedConcurrencyCheckResult> {
  const domain = extractDomainFromUrl(url);

  if (!domain) {
    // Invalid URL, allow to proceed (will fail at fetch stage)
    return { allowed: true };
  }

  const tenantLimit = options.tenantLimit ?? DEFAULT_TENANT_CONCURRENCY;
  const domainLimit = options.domainLimit ?? DEFAULT_DOMAIN_CONCURRENCY;

  // Check tenant limit
  const tenantCheck = await checkTenantConcurrency(tenantId, tenantLimit);
  if (!tenantCheck.allowed) {
    return {
      allowed: false,
      tenantCheck,
      reason: "tenant_limit",
    };
  }

  // Check domain limit
  const domainCheck = await checkDomainConcurrency(domain, domainLimit);
  if (!domainCheck.allowed) {
    return {
      allowed: false,
      tenantCheck,
      domainCheck,
      reason: "domain_limit",
    };
  }

  // Optional: check tenant+domain limit
  if (options.checkTenantDomainLimit && options.tenantDomainLimit !== undefined) {
    const tenantDomainCheck = await checkTenantDomainConcurrency(
      tenantId,
      domain,
      options.tenantDomainLimit
    );
    if (!tenantDomainCheck.allowed) {
      return {
        allowed: false,
        tenantCheck,
        domainCheck,
        tenantDomainCheck,
        reason: "tenant_domain_limit",
      };
    }
    return {
      allowed: true,
      tenantCheck,
      domainCheck,
      tenantDomainCheck,
    };
  }

  return {
    allowed: true,
    tenantCheck,
    domainCheck,
  };
}

/**
 * Atomically acquires concurrency slots for a fetch job.
 * Should be called after checkFetchConcurrencyLimits returns allowed=true.
 *
 * @param tenantId - The tenant identifier
 * @param url - The URL being fetched
 * @param jobId - Unique job identifier for tracking
 * @param options - Options including whether to track tenant+domain
 * @returns The active job tracker for cleanup
 */
export async function acquireFetchConcurrencySlots(
  tenantId: string,
  url: string,
  jobId: string,
  options: { checkTenantDomainLimit?: boolean } = {}
): Promise<ActiveJobTracker | null> {
  const domain = extractDomainFromUrl(url);

  if (!domain) {
    return null;
  }

  const ttl = getConcurrencyKeyTtl();
  const pipeline = redis.pipeline();

  // Increment counters atomically
  const tenantKey = buildTenantConcurrencyKey(tenantId);
  const domainKey = buildDomainConcurrencyKey(domain);

  pipeline.incr(tenantKey);
  pipeline.expire(tenantKey, ttl);
  pipeline.incr(domainKey);
  pipeline.expire(domainKey, ttl);

  if (options.checkTenantDomainLimit) {
    const tenantDomainKey = buildTenantDomainConcurrencyKey(tenantId, domain);
    pipeline.incr(tenantDomainKey);
    pipeline.expire(tenantDomainKey, ttl);
  }

  await pipeline.exec();

  return {
    jobId,
    tenantId,
    domain,
    startedAt: Date.now(),
  };
}

/**
 * Releases concurrency slots when a fetch job completes (success or failure).
 * Must be called to prevent slot leakage.
 *
 * @param tracker - The active job tracker from acquireFetchConcurrencySlots
 * @param options - Options including whether tenant+domain was tracked
 */
export async function releaseFetchConcurrencySlots(
  tracker: ActiveJobTracker,
  options: { checkTenantDomainLimit?: boolean } = {}
): Promise<void> {
  if (!tracker.tenantId) {
    return;
  }

  const pipeline = redis.pipeline();

  const tenantKey = buildTenantConcurrencyKey(tracker.tenantId);
  const domainKey = buildDomainConcurrencyKey(tracker.domain);

  // Decrement counters, ensuring they don't go below 0
  pipeline.decr(tenantKey);
  pipeline.decr(domainKey);

  if (options.checkTenantDomainLimit) {
    const tenantDomainKey = buildTenantDomainConcurrencyKey(
      tracker.tenantId,
      tracker.domain
    );
    pipeline.decr(tenantDomainKey);
  }

  await pipeline.exec();

  // Clean up any negative values (shouldn't happen, but be defensive)
  const tenantCount = await redis.get(tenantKey);
  if (tenantCount && parseInt(tenantCount, 10) < 0) {
    await redis.set(tenantKey, "0");
  }

  const domainCount = await redis.get(domainKey);
  if (domainCount && parseInt(domainCount, 10) < 0) {
    await redis.set(domainKey, "0");
  }
}

/**
 * Gets the current concurrency counts for a tenant.
 * Useful for monitoring and debugging.
 *
 * @param tenantId - The tenant identifier
 * @returns Current count of active jobs
 */
export async function getTenantActiveFetchCount(tenantId: string): Promise<number> {
  const key = buildTenantConcurrencyKey(tenantId);
  const current = await redis.get(key);
  return current ? Math.max(0, parseInt(current, 10)) : 0;
}

/**
 * Gets the current concurrency counts for a domain.
 * Useful for monitoring and debugging.
 *
 * @param domain - The normalized domain
 * @returns Current count of active jobs
 */
export async function getDomainActiveFetchCount(domain: string): Promise<number> {
  const key = buildDomainConcurrencyKey(domain);
  const current = await redis.get(key);
  return current ? Math.max(0, parseInt(current, 10)) : 0;
}

/**
 * Resets concurrency counters for a tenant.
 * Use with caution - typically only for testing or emergency cleanup.
 *
 * @param tenantId - The tenant identifier
 */
export async function resetTenantConcurrency(tenantId: string): Promise<void> {
  const key = buildTenantConcurrencyKey(tenantId);
  await redis.del(key);
}

/**
 * Resets concurrency counters for a domain.
 * Use with caution - typically only for testing or emergency cleanup.
 *
 * @param domain - The normalized domain
 */
export async function resetDomainConcurrency(domain: string): Promise<void> {
  const key = buildDomainConcurrencyKey(domain);
  await redis.del(key);
}

/**
 * Creates concurrency limit options from tenant quotas and environment.
 *
 * @param tenantQuotas - Optional tenant quotas from database
 * @returns Resolved concurrency limit options
 */
export function createConcurrencyOptionsFromQuotas(
  tenantQuotas?: Partial<TenantQuotas>
): ConcurrencyLimitOptions {
  return {
    tenantLimit: getTenantConcurrencyLimit(tenantQuotas),
    domainLimit: resolveDomainConcurrency((key) => process.env[key]),
    checkTenantDomainLimit: false,
  };
}

// ============================================================================
// Embed Backpressure
// ============================================================================

import {
  type EmbedBackpressureCheckResult,
  type EmbedBackpressureConfig,
  type EmbedBackpressureWaitResult,
  type EmbedBackpressureMetrics,
  resolveEmbedBackpressureConfig,
  getDefaultEmbedBackpressureConfig,
  checkEmbedBackpressure,
  calculateEmbedBackpressureMetrics,
  getEmbedBackpressureKey,
  getEmbedBackpressureKeyTtl,
} from "@grounded/shared";

// Cache for backpressure config (resolved once at startup)
let cachedBackpressureConfig: EmbedBackpressureConfig | null = null;

/**
 * Gets the embed backpressure configuration.
 * Resolves from environment variables on first call and caches the result.
 *
 * @returns Backpressure configuration
 */
export function getEmbedBackpressureConfig(): EmbedBackpressureConfig {
  if (!cachedBackpressureConfig) {
    cachedBackpressureConfig = resolveEmbedBackpressureConfig((key) => process.env[key]);
  }
  return cachedBackpressureConfig;
}

/**
 * Resets the cached backpressure configuration.
 * Useful for testing or when environment changes.
 */
export function resetEmbedBackpressureConfigCache(): void {
  cachedBackpressureConfig = null;
}

/**
 * Gets the current embed queue depth (pending + waiting jobs).
 * Uses BullMQ queue counts for accurate real-time measurement.
 *
 * @returns Current queue depth
 */
export async function getEmbedQueueDepth(): Promise<number> {
  const counts = await embedChunksQueue.getJobCounts("waiting", "active", "delayed");
  return counts.waiting + counts.active + counts.delayed;
}

/**
 * Gets the embed queue depth from Redis counter.
 * This is a fallback when queue metrics are unavailable.
 *
 * @returns Current queue depth from Redis counter
 */
export async function getEmbedQueueDepthFromRedis(): Promise<number> {
  const key = getEmbedBackpressureKey();
  const value = await redis.get(key);
  return value ? Math.max(0, parseInt(value, 10)) : 0;
}

/**
 * Increments the Redis-based embed queue depth counter.
 * Called when adding embed jobs.
 *
 * @param count - Number of jobs being added (default 1)
 * @returns New counter value
 */
export async function incrementEmbedQueueDepth(count: number = 1): Promise<number> {
  const key = getEmbedBackpressureKey();
  const ttl = getEmbedBackpressureKeyTtl();
  const newValue = await redis.incrby(key, count);
  await redis.expire(key, ttl);
  return newValue;
}

/**
 * Decrements the Redis-based embed queue depth counter.
 * Called when embed jobs complete.
 *
 * @param count - Number of jobs completed (default 1)
 * @returns New counter value
 */
export async function decrementEmbedQueueDepth(count: number = 1): Promise<number> {
  const key = getEmbedBackpressureKey();
  const newValue = await redis.decrby(key, count);
  // Ensure counter doesn't go negative
  if (newValue < 0) {
    await redis.set(key, "0");
    return 0;
  }
  return newValue;
}

/**
 * Resets the Redis-based embed queue depth counter.
 * Use with caution - typically only for testing or emergency cleanup.
 */
export async function resetEmbedQueueDepth(): Promise<void> {
  const key = getEmbedBackpressureKey();
  await redis.del(key);
}

/**
 * Checks current embed backpressure status.
 * Uses BullMQ queue metrics for accuracy.
 *
 * @param embedLag - Optional embed lag value (if already known from DB)
 * @returns Backpressure check result
 */
export async function checkCurrentEmbedBackpressure(
  embedLag: number = 0
): Promise<EmbedBackpressureCheckResult> {
  const config = getEmbedBackpressureConfig();

  // Get queue depth from BullMQ
  const queueDepth = await getEmbedQueueDepth();

  return checkEmbedBackpressure(queueDepth, embedLag, config);
}

/**
 * Waits for embed backpressure to clear.
 * Polls at configured intervals until backpressure clears or max wait is reached.
 *
 * @param getEmbedLag - Function to get current embed lag (called on each check)
 * @returns Wait result with statistics
 */
export async function waitForEmbedBackpressure(
  getEmbedLag: () => Promise<number>
): Promise<EmbedBackpressureWaitResult> {
  const config = getEmbedBackpressureConfig();
  const startTime = Date.now();
  let waitCycles = 0;
  let lastCheck: EmbedBackpressureCheckResult;

  // Initial check
  const embedLag = await getEmbedLag();
  lastCheck = await checkCurrentEmbedBackpressure(embedLag);

  if (!lastCheck.shouldWait) {
    return {
      waited: false,
      waitCycles: 0,
      waitTimeMs: 0,
      timedOut: false,
      finalCheck: lastCheck,
    };
  }

  // Wait loop
  while (lastCheck.shouldWait && waitCycles < config.maxWaitCycles) {
    await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    waitCycles++;

    const currentLag = await getEmbedLag();
    lastCheck = await checkCurrentEmbedBackpressure(currentLag);
  }

  const waitTimeMs = Date.now() - startTime;

  return {
    waited: true,
    waitCycles,
    waitTimeMs,
    timedOut: waitCycles >= config.maxWaitCycles && lastCheck.shouldWait,
    finalCheck: lastCheck,
  };
}

/**
 * Gets current embed backpressure metrics for monitoring.
 *
 * @param embedLag - Current embed lag value
 * @returns Metrics snapshot
 */
export async function getEmbedBackpressureMetrics(
  embedLag: number = 0
): Promise<EmbedBackpressureMetrics> {
  const config = getEmbedBackpressureConfig();
  const queueDepth = await getEmbedQueueDepth();
  return calculateEmbedBackpressureMetrics(queueDepth, embedLag, config);
}

// ============================================================================
// Chunk Embed Status Tracking
// ============================================================================

import {
  type ChunkEmbedStatusRecord,
  type ChunkEmbedStatusSummary,
  type EmbedCompletionGatingConfig,
  type EmbedCompletionCheckResult,
  ChunkEmbedStatus,
  buildChunkEmbedStatusKey,
  buildChunkEmbedFailedSetKey,
  createPendingChunkEmbedStatus,
  createInProgressChunkEmbedStatus,
  createSucceededChunkEmbedStatus,
  createFailedChunkEmbedStatus,
  calculateChunkEmbedStatusSummary,
  getChunkEmbedStatusKeyTtl,
  resolveEmbedCompletionGatingConfig,
  determineRunStatusFromEmbedding,
} from "@grounded/shared";

/**
 * Initializes chunk embed status records for a batch of chunks.
 * Call this when queuing embed jobs to mark chunks as pending.
 *
 * @param runId - Source run ID
 * @param kbId - Knowledge base ID
 * @param chunkIds - Array of chunk IDs to track
 */
export async function initializeChunkEmbedStatuses(
  runId: string,
  kbId: string,
  chunkIds: string[]
): Promise<void> {
  if (chunkIds.length === 0) return;

  const ttl = getChunkEmbedStatusKeyTtl();
  const pipeline = redis.pipeline();

  for (const chunkId of chunkIds) {
    const key = buildChunkEmbedStatusKey(runId, chunkId);
    const record = createPendingChunkEmbedStatus(chunkId, runId, kbId);
    pipeline.setex(key, ttl, JSON.stringify(record));
  }

  await pipeline.exec();
}

/**
 * Gets the embed status for a single chunk.
 *
 * @param runId - Source run ID
 * @param chunkId - Chunk ID
 * @returns Status record or null if not found
 */
export async function getChunkEmbedStatus(
  runId: string,
  chunkId: string
): Promise<ChunkEmbedStatusRecord | null> {
  const key = buildChunkEmbedStatusKey(runId, chunkId);
  const data = await redis.get(key);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * Gets the embed statuses for multiple chunks.
 *
 * @param runId - Source run ID
 * @param chunkIds - Array of chunk IDs
 * @returns Array of status records (in same order as input)
 */
export async function getChunkEmbedStatuses(
  runId: string,
  chunkIds: string[]
): Promise<(ChunkEmbedStatusRecord | null)[]> {
  if (chunkIds.length === 0) return [];

  const keys = chunkIds.map((id) => buildChunkEmbedStatusKey(runId, id));
  const data = await redis.mget(...keys);

  return data.map((d) => (d ? JSON.parse(d) : null));
}

/**
 * Marks chunks as in-progress (being embedded).
 *
 * @param runId - Source run ID
 * @param chunkIds - Array of chunk IDs to mark
 */
export async function markChunksEmbedInProgress(
  runId: string,
  chunkIds: string[]
): Promise<void> {
  if (chunkIds.length === 0) return;

  const ttl = getChunkEmbedStatusKeyTtl();
  const currentRecords = await getChunkEmbedStatuses(runId, chunkIds);
  const pipeline = redis.pipeline();

  for (let i = 0; i < chunkIds.length; i++) {
    const chunkId = chunkIds[i];
    const current = currentRecords[i];
    if (!current) continue;

    const key = buildChunkEmbedStatusKey(runId, chunkId);
    const updated = createInProgressChunkEmbedStatus(current);
    pipeline.setex(key, ttl, JSON.stringify(updated));
  }

  await pipeline.exec();
}

/**
 * Marks chunks as successfully embedded.
 *
 * @param runId - Source run ID
 * @param chunkIds - Array of chunk IDs that succeeded
 * @param dimensions - Embedding dimensions used
 */
export async function markChunksEmbedSucceeded(
  runId: string,
  chunkIds: string[],
  dimensions: number
): Promise<void> {
  if (chunkIds.length === 0) return;

  const ttl = getChunkEmbedStatusKeyTtl();
  const currentRecords = await getChunkEmbedStatuses(runId, chunkIds);
  const pipeline = redis.pipeline();

  for (let i = 0; i < chunkIds.length; i++) {
    const chunkId = chunkIds[i];
    const current = currentRecords[i];
    if (!current) continue;

    const key = buildChunkEmbedStatusKey(runId, chunkId);
    const updated = createSucceededChunkEmbedStatus(current, dimensions);
    pipeline.setex(key, ttl, JSON.stringify(updated));
  }

  await pipeline.exec();
}

/**
 * Marks chunks as failed.
 *
 * @param runId - Source run ID
 * @param chunkIds - Array of chunk IDs that failed
 * @param error - Error message
 * @param errorCode - Error code
 * @param retryable - Whether the error is retryable
 */
export async function markChunksEmbedFailed(
  runId: string,
  chunkIds: string[],
  error: string,
  errorCode?: string,
  retryable?: boolean
): Promise<void> {
  if (chunkIds.length === 0) return;

  const ttl = getChunkEmbedStatusKeyTtl();
  const currentRecords = await getChunkEmbedStatuses(runId, chunkIds);
  const pipeline = redis.pipeline();

  // Track failed chunks in a set for easier lookup
  const failedSetKey = buildChunkEmbedFailedSetKey(runId);

  for (let i = 0; i < chunkIds.length; i++) {
    const chunkId = chunkIds[i];
    const current = currentRecords[i];
    if (!current) continue;

    const key = buildChunkEmbedStatusKey(runId, chunkId);
    const updated = createFailedChunkEmbedStatus(current, error, errorCode, retryable);
    pipeline.setex(key, ttl, JSON.stringify(updated));

    // Add to failed set for permanent failures
    if (!retryable) {
      pipeline.sadd(failedSetKey, chunkId);
    }
  }

  // Set TTL on the failed set
  pipeline.expire(failedSetKey, ttl);

  await pipeline.exec();
}

/**
 * Gets the list of failed chunk IDs for a run.
 *
 * @param runId - Source run ID
 * @returns Array of failed chunk IDs
 */
export async function getFailedChunkIds(runId: string): Promise<string[]> {
  const key = buildChunkEmbedFailedSetKey(runId);
  return await redis.smembers(key);
}

/**
 * Gets the count of pending/in-progress chunks for a run.
 * Uses SCAN to find all chunk status keys for the run.
 *
 * @param runId - Source run ID
 * @returns Count of chunks still being processed
 */
export async function getRunPendingEmbedCount(runId: string): Promise<number> {
  const pattern = `${buildChunkEmbedStatusKey(runId, "")}*`;
  let cursor = "0";
  let pendingCount = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;

    if (keys.length > 0) {
      const data = await redis.mget(...keys);
      for (const d of data) {
        if (d) {
          const record: ChunkEmbedStatusRecord = JSON.parse(d);
          if (
            record.status === ChunkEmbedStatus.PENDING ||
            record.status === ChunkEmbedStatus.IN_PROGRESS
          ) {
            pendingCount++;
          }
        }
      }
    }
  } while (cursor !== "0");

  return pendingCount;
}

/**
 * Gets a summary of all chunk embed statuses for a run.
 * Scans all chunk status keys to build a complete summary.
 *
 * @param runId - Source run ID
 * @returns Summary of chunk embed statuses
 */
export async function getRunChunkEmbedSummary(
  runId: string
): Promise<ChunkEmbedStatusSummary> {
  const pattern = `${buildChunkEmbedStatusKey(runId, "")}*`;
  let cursor = "0";
  const records: ChunkEmbedStatusRecord[] = [];

  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;

    if (keys.length > 0) {
      const data = await redis.mget(...keys);
      for (const d of data) {
        if (d) {
          records.push(JSON.parse(d));
        }
      }
    }
  } while (cursor !== "0");

  return calculateChunkEmbedStatusSummary(records);
}

/**
 * Checks embedding completion status for a run.
 * Returns information needed to gate run finalization.
 *
 * @param runId - Source run ID
 * @param totalExpected - Expected total chunks from sourceRun.chunksToEmbed
 * @param hasPageFailures - Whether there were page-level failures
 * @returns Completion check result
 */
export async function checkRunEmbeddingCompletion(
  runId: string,
  totalExpected: number,
  hasPageFailures: boolean
): Promise<EmbedCompletionCheckResult> {
  // If no chunks expected, consider complete
  if (totalExpected === 0) {
    return {
      isComplete: true,
      allSucceeded: !hasPageFailures,
      pendingCount: 0,
      failedCount: 0,
      succeededCount: 0,
      totalCount: 0,
      suggestedStatus: hasPageFailures ? "partial" : "succeeded",
    };
  }

  const summary = await getRunChunkEmbedSummary(runId);

  return {
    isComplete: summary.isComplete,
    allSucceeded: summary.allSucceeded,
    pendingCount: summary.pending + summary.inProgress,
    failedCount: summary.failedRetryable + summary.failedPermanent,
    succeededCount: summary.succeeded,
    totalCount: summary.total,
    suggestedStatus: determineRunStatusFromEmbedding(summary, hasPageFailures),
  };
}

/**
 * Waits for run embedding to complete (or timeout).
 *
 * @param runId - Source run ID
 * @param totalExpected - Expected total chunks
 * @param hasPageFailures - Whether there were page-level failures
 * @param config - Optional gating configuration
 * @returns Final completion check result
 */
export async function waitForRunEmbeddingCompletion(
  runId: string,
  totalExpected: number,
  hasPageFailures: boolean,
  config?: EmbedCompletionGatingConfig
): Promise<EmbedCompletionCheckResult> {
  const gatingConfig = config ?? resolveEmbedCompletionGatingConfig();

  // If gating is disabled, return immediate status
  if (!gatingConfig.enabled) {
    return await checkRunEmbeddingCompletion(runId, totalExpected, hasPageFailures);
  }

  const startTime = Date.now();
  let lastResult = await checkRunEmbeddingCompletion(runId, totalExpected, hasPageFailures);

  while (!lastResult.isComplete && Date.now() - startTime < gatingConfig.maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, gatingConfig.checkIntervalMs));
    lastResult = await checkRunEmbeddingCompletion(runId, totalExpected, hasPageFailures);
  }

  return lastResult;
}

/**
 * Cleans up chunk embed status keys for a run.
 * Call this during source run cleanup.
 *
 * @param runId - Source run ID
 * @returns Number of keys deleted
 */
export async function cleanupChunkEmbedStatuses(runId: string): Promise<number> {
  const pattern = `${buildChunkEmbedStatusKey(runId, "")}*`;
  let cursor = "0";
  let deletedCount = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;

    if (keys.length > 0) {
      await redis.del(...keys);
      deletedCount += keys.length;
    }
  } while (cursor !== "0");

  // Also clean up the failed set
  const failedSetKey = buildChunkEmbedFailedSetKey(runId);
  await redis.del(failedSetKey);

  return deletedCount;
}

// ============================================================================
// Worker Creation Helpers
// ============================================================================
// Pending Page-Index Job Tracking
// ============================================================================

const PENDING_INDEX_JOBS_KEY_PREFIX = "pending_index_jobs:";
const PENDING_INDEX_JOBS_TTL_SECONDS = 86400; // 24 hours

/**
 * Builds the Redis key for tracking pending page-index jobs for a run.
 */
function buildPendingIndexJobsKey(runId: string): string {
  return `${PENDING_INDEX_JOBS_KEY_PREFIX}${runId}`;
}

/**
 * Increments the pending page-index jobs counter for a run.
 * Call this when queuing a page-index job.
 *
 * @param runId - Source run ID
 * @param count - Number of jobs being added (default 1)
 * @returns New counter value
 */
export async function incrementPendingIndexJobs(runId: string, count: number = 1): Promise<number> {
  const key = buildPendingIndexJobsKey(runId);
  const newValue = await redis.incrby(key, count);
  await redis.expire(key, PENDING_INDEX_JOBS_TTL_SECONDS);
  return newValue;
}

/**
 * Decrements the pending page-index jobs counter for a run.
 * Call this when a page-index job completes (success or failure).
 *
 * @param runId - Source run ID
 * @param count - Number of jobs completed (default 1)
 * @returns New counter value (0 if all jobs complete)
 */
export async function decrementPendingIndexJobs(runId: string, count: number = 1): Promise<number> {
  const key = buildPendingIndexJobsKey(runId);
  const newValue = await redis.decrby(key, count);
  // Ensure counter doesn't go negative
  if (newValue <= 0) {
    await redis.del(key);
    return 0;
  }
  return newValue;
}

/**
 * Gets the current count of pending page-index jobs for a run.
 *
 * @param runId - Source run ID
 * @returns Current counter value
 */
export async function getPendingIndexJobsCount(runId: string): Promise<number> {
  const key = buildPendingIndexJobsKey(runId);
  const value = await redis.get(key);
  return value ? parseInt(value, 10) : 0;
}

/**
 * Checks if all page-index jobs are complete for a run.
 *
 * @param runId - Source run ID
 * @returns true if counter is 0 or key doesn't exist
 */
export async function areAllIndexJobsComplete(runId: string): Promise<boolean> {
  const count = await getPendingIndexJobsCount(runId);
  return count === 0;
}

// ============================================================================
// Stage Progress Tracking (Redis-based for cross-worker coordination)
// ============================================================================

const STAGE_PROGRESS_KEY_PREFIX = "stage_progress:";
const STAGE_PROGRESS_TTL_SECONDS = 86400; // 24 hours

/**
 * Builds the Redis key for stage progress tracking.
 */
function buildStageProgressKey(runId: string, field: "total" | "completed" | "failed"): string {
  return `${STAGE_PROGRESS_KEY_PREFIX}${runId}:${field}`;
}

/**
 * Initializes stage progress counters in Redis.
 * Call this when starting a new stage.
 * 
 * @param runId - Source run ID
 * @param total - Total items expected in this stage
 */
export async function initializeStageProgress(
  runId: string, 
  total: number
): Promise<void> {
  const pipeline = redis.pipeline();
  pipeline.set(buildStageProgressKey(runId, "total"), total);
  pipeline.expire(buildStageProgressKey(runId, "total"), STAGE_PROGRESS_TTL_SECONDS);
  pipeline.set(buildStageProgressKey(runId, "completed"), 0);
  pipeline.expire(buildStageProgressKey(runId, "completed"), STAGE_PROGRESS_TTL_SECONDS);
  pipeline.set(buildStageProgressKey(runId, "failed"), 0);
  pipeline.expire(buildStageProgressKey(runId, "failed"), STAGE_PROGRESS_TTL_SECONDS);
  await pipeline.exec();
}

/**
 * Increments the stage completed counter and returns the new values.
 * Uses atomic increment for safe concurrent updates from multiple workers.
 * 
 * @param runId - Source run ID
 * @returns Object with total, completed, failed counts and whether stage is complete
 */
export async function incrementStageProgress(
  runId: string, 
  failed: boolean = false
): Promise<{ total: number; completed: number; failed: number; isComplete: boolean }> {
  const key = failed 
    ? buildStageProgressKey(runId, "failed")
    : buildStageProgressKey(runId, "completed");
  
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.get(buildStageProgressKey(runId, "total"));
  pipeline.get(buildStageProgressKey(runId, "completed"));
  pipeline.get(buildStageProgressKey(runId, "failed"));
  
  const results = await pipeline.exec();
  
  const total = parseInt(String(results?.[1]?.[1] || "0"), 10);
  const completed = parseInt(String(results?.[2]?.[1] || "0"), 10);
  const failedCount = parseInt(String(results?.[3]?.[1] || "0"), 10);
  
  return {
    total,
    completed,
    failed: failedCount,
    isComplete: (completed + failedCount) >= total && total > 0,
  };
}

/**
 * Gets current stage progress from Redis.
 * 
 * @param runId - Source run ID
 * @returns Object with total, completed, failed counts
 */
export async function getStageProgress(
  runId: string
): Promise<{ total: number; completed: number; failed: number; isComplete: boolean }> {
  const pipeline = redis.pipeline();
  pipeline.get(buildStageProgressKey(runId, "total"));
  pipeline.get(buildStageProgressKey(runId, "completed"));
  pipeline.get(buildStageProgressKey(runId, "failed"));
  
  const results = await pipeline.exec();
  
  const total = parseInt(String(results?.[0]?.[1] || "0"), 10);
  const completed = parseInt(String(results?.[1]?.[1] || "0"), 10);
  const failed = parseInt(String(results?.[2]?.[1] || "0"), 10);
  
  return {
    total,
    completed,
    failed,
    isComplete: (completed + failed) >= total && total > 0,
  };
}

/**
 * Cleans up stage progress keys for a run.
 * 
 * @param runId - Source run ID
 */
export async function cleanupStageProgress(runId: string): Promise<void> {
  await redis.del(
    buildStageProgressKey(runId, "total"),
    buildStageProgressKey(runId, "completed"),
    buildStageProgressKey(runId, "failed")
  );
}

// ============================================================================
// Fetched HTML Staging (Redis-based temporary storage between stages)
// ============================================================================

const FETCHED_HTML_KEY_PREFIX = "fetched_html:";
const FETCHED_HTML_TTL_SECONDS = 3600; // 1 hour (should be processed quickly)

/**
 * Builds the Redis key for storing fetched HTML.
 */
function buildFetchedHtmlKey(runId: string, url: string): string {
  // Use base64 encoding to handle URLs with special characters
  const urlHash = Buffer.from(url).toString("base64url");
  return `${FETCHED_HTML_KEY_PREFIX}${runId}:${urlHash}`;
}

/**
 * Stores fetched HTML content in Redis for later processing.
 * Called by page-fetch after successfully fetching a page.
 * 
 * @param runId - Source run ID
 * @param url - The URL that was fetched
 * @param html - The HTML content
 * @param title - The page title (optional)
 */
export async function storeFetchedHtml(
  runId: string,
  url: string,
  html: string,
  title: string | null
): Promise<void> {
  const key = buildFetchedHtmlKey(runId, url);
  const data = JSON.stringify({ html, title, url, storedAt: Date.now() });
  await redis.setex(key, FETCHED_HTML_TTL_SECONDS, data);
}

/**
 * Retrieves fetched HTML content from Redis.
 * Called by page-process to get the HTML for processing.
 * 
 * @param runId - Source run ID
 * @param url - The URL to retrieve
 * @returns The stored data or null if not found/expired
 */
export async function getFetchedHtml(
  runId: string,
  url: string
): Promise<{ html: string; title: string | null; url: string } | null> {
  const key = buildFetchedHtmlKey(runId, url);
  const data = await redis.get(key);
  if (!data) return null;
  
  try {
    const parsed = JSON.parse(data);
    return { html: parsed.html, title: parsed.title, url: parsed.url };
  } catch {
    return null;
  }
}

/**
 * Deletes fetched HTML content from Redis after processing.
 * Called by page-process after successfully processing a page.
 * 
 * @param runId - Source run ID
 * @param url - The URL to delete
 */
export async function deleteFetchedHtml(runId: string, url: string): Promise<void> {
  const key = buildFetchedHtmlKey(runId, url);
  await redis.del(key);
}

/**
 * Gets all URLs with fetched HTML waiting to be processed.
 * Used by stage-job-queuer to queue processing jobs.
 * 
 * @param runId - Source run ID
 * @returns Array of URLs with fetched HTML
 */
export async function getFetchedHtmlUrls(runId: string): Promise<string[]> {
  const pattern = `${FETCHED_HTML_KEY_PREFIX}${runId}:*`;
  const keys = await redis.keys(pattern);
  
  const urls: string[] = [];
  for (const key of keys) {
    const data = await redis.get(key);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        urls.push(parsed.url);
      } catch {
        // Skip invalid entries
      }
    }
  }
  
  return urls;
}

/**
 * Cleans up all fetched HTML for a run.
 * Called during run cleanup.
 * 
 * @param runId - Source run ID
 */
export async function cleanupFetchedHtml(runId: string): Promise<void> {
  const pattern = `${FETCHED_HTML_KEY_PREFIX}${runId}:*`;
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

// ============================================================================

export { Worker, Job, QueueEvents, DelayedError };
export type { ConnectionOptions };

// Re-export constants from shared for convenience
export {
  QUEUE_NAMES,
  JOB_RETRY_ATTEMPTS,
  JOB_RETRY_DELAY_MS,
  JOB_BACKOFF_TYPE,
  STAGE_QUEUE_MAPPING,
  STAGE_DEFAULT_CONCURRENCY,
  STAGE_CONCURRENCY_ENV_VARS,
  QUEUE_DEFAULT_CONCURRENCY,
  QUEUE_CONCURRENCY_ENV_VARS,
  DEFAULT_TENANT_CONCURRENCY,
  DEFAULT_DOMAIN_CONCURRENCY,
  DOMAIN_CONCURRENCY_ENV_VAR,
  CONCURRENCY_KEY_PREFIXES,
  CONCURRENCY_KEY_TTL_SECONDS,
  CONCURRENCY_RETRY_DELAY_MS,
  // Embed backpressure constants
  DEFAULT_EMBED_QUEUE_THRESHOLD,
  DEFAULT_EMBED_LAG_THRESHOLD,
  EMBED_BACKPRESSURE_DELAY_MS,
  EMBED_BACKPRESSURE_MAX_WAIT_CYCLES,
  EMBED_BACKPRESSURE_ENV_VARS,
  EMBED_BACKPRESSURE_KEY,
  EMBED_BACKPRESSURE_KEY_TTL_SECONDS,
  // Chunk embed status constants
  CHUNK_EMBED_STATUS_KEY_PREFIX,
  CHUNK_EMBED_STATUS_KEY_TTL_SECONDS,
  CHUNK_EMBED_FAILED_SET_KEY_PREFIX,
  EMBED_COMPLETION_GATING_DISABLED_ENV_VAR,
  DEFAULT_EMBED_COMPLETION_WAIT_MS,
  EMBED_COMPLETION_CHECK_INTERVAL_MS,
  EMBED_COMPLETION_ENV_VARS,
} from "@grounded/shared";

// Re-export queue configuration helpers from shared
export {
  getQueueForStage,
  getStageConcurrency,
  getStageConcurrencyEnvVar,
  getQueueConcurrency,
  getQueueConcurrencyEnvVar,
  getStagesForQueue,
  buildQueueConfigMap,
  resolveQueueConcurrency,
  resolveStageConcurrency,
  // Concurrency limit helpers
  extractDomainFromUrl,
  buildTenantConcurrencyKey,
  buildDomainConcurrencyKey,
  buildTenantDomainConcurrencyKey,
  resolveDomainConcurrency,
  getTenantConcurrencyLimit,
  createConcurrencyLimitOptions,
  getConcurrencyKeyTtl,
  getConcurrencyRetryDelay,
  // Embed backpressure helpers
  resolveEmbedBackpressureConfig,
  getDefaultEmbedBackpressureConfig,
  checkEmbedBackpressure,
  calculateEmbedBackpressureMetrics,
  getEmbedBackpressureKey,
  getEmbedBackpressureKeyTtl,
  // Deterministic embed job ID helpers
  generateDeterministicEmbedJobId,
  hashChunkIds,
  isValidDeterministicEmbedJobId,
  parseDeterministicEmbedJobId,
  wouldProduceSameEmbedJobId,
  DEFAULT_EMBED_JOB_ID_CONFIG,
  // Chunk embed status helpers
  ChunkEmbedStatus,
  buildChunkEmbedStatusKey,
  buildChunkEmbedFailedSetKey,
  createPendingChunkEmbedStatus,
  createInProgressChunkEmbedStatus,
  createSucceededChunkEmbedStatus,
  createFailedChunkEmbedStatus,
  calculateChunkEmbedStatusSummary,
  getChunkEmbedStatusKeyTtl,
  isChunkEmbedInProgress,
  isChunkEmbedTerminal,
  isChunkEmbedFailed,
  determineRunStatusFromEmbedding,
  resolveEmbedCompletionGatingConfig,
  getDefaultEmbedCompletionGatingConfig,
} from "@grounded/shared";

export type {
  QueueName,
  QueueConfig,
  ConcurrencyCheckResult,
  CombinedConcurrencyCheckResult,
  ActiveJobTracker,
  ConcurrencyLimitOptions,
  ConcurrencyMetrics,
  // Embed backpressure types
  EmbedBackpressureCheckResult,
  EmbedBackpressureConfig,
  EmbedBackpressureWaitResult,
  EmbedBackpressureMetrics,
  // Deterministic embed job ID types
  DeterministicEmbedJobIdConfig,
  DeterministicEmbedJobIdResult,
  // Chunk embed status types
  ChunkEmbedStatusRecord,
  ChunkEmbedStatusSummary,
  EmbedCompletionGatingConfig,
  EmbedCompletionCheckResult,
  // Fairness scheduler types
  FairnessConfig,
  FairnessSlotResult,
  FairnessMetrics,
} from "@grounded/shared";

// ============================================================================
// Fairness Scheduler
// ============================================================================

export {
  // Core functions
  registerRun,
  unregisterRun,
  acquireSlot,
  releaseSlot,
  // Query functions
  getActiveRuns,
  getRunSlotCount,
  getFairnessMetrics,
  isRunRegistered,
  // Configuration
  getFairnessConfig,
  resetFairnessConfigCache,
  setFairnessConfig,
  updateFairnessConfigFromSettings,
  // Utilities
  resetFairnessState,
  // Error types
  FairnessSlotUnavailableError,
  isFairnessSlotError,
} from "./fairness-scheduler";
