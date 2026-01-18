import { Queue, Worker, Job, QueueEvents, ConnectionOptions } from "bullmq";
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
  type EmbedChunksBatchJob,
  type EnrichPageJob,
  type SourceRunFinalizeJob,
  type HardDeleteObjectJob,
  type KbReindexJob,
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

export async function addPageFetchJob(data: PageFetchJob): Promise<Job> {
  // Use full base64 URL to ensure unique job IDs (truncation caused collisions)
  const urlHash = Buffer.from(data.url).toString("base64url");
  return pageFetchQueue.add("fetch", data, {
    jobId: `page-fetch-${data.runId}-${urlHash}`,
  });
}

export async function addPageProcessJob(data: PageProcessJob): Promise<Job> {
  // Use full base64 URL to ensure unique job IDs (truncation caused collisions)
  const urlHash = Buffer.from(data.url).toString("base64url");
  return pageProcessQueue.add("process", data, {
    jobId: `page-process-${data.runId}-${urlHash}`,
  });
}

export async function addEmbedChunksBatchJob(data: EmbedChunksBatchJob): Promise<Job> {
  // Generate deterministic job ID based on chunk IDs
  // This ensures:
  // 1. Same chunks always produce the same job ID (idempotent re-queuing)
  // 2. BullMQ will deduplicate jobs with the same ID
  // 3. Better tracking and debugging with predictable IDs
  const { jobId } = generateDeterministicEmbedJobId(data.kbId, data.chunkIds);

  return embedChunksQueue.add("embed", data, {
    jobId,
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
// Worker Creation Helpers
// ============================================================================

export { Worker, Job, QueueEvents };
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
} from "@grounded/shared";
