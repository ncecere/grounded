import { Queue, Worker, Job, QueueEvents, ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import {
  QUEUE_NAMES,
  JOB_RETRY_ATTEMPTS,
  JOB_RETRY_DELAY_MS,
  JOB_BACKOFF_TYPE,
  getEnv,
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
  return embedChunksQueue.add("embed", data, {
    jobId: `embed-${data.kbId}-${Date.now()}`,
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
// Worker Creation Helpers
// ============================================================================

export { Worker, Job, QueueEvents };
export type { ConnectionOptions };

// Re-export constants from shared for convenience
export { QUEUE_NAMES, JOB_RETRY_ATTEMPTS, JOB_RETRY_DELAY_MS, JOB_BACKOFF_TYPE } from "@grounded/shared";
