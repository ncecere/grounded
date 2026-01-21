import { log } from "@grounded/logger";
import { redis } from "@grounded/queue";

/**
 * Clean up all Redis state for a run
 */
export async function cleanupRunRedisState(runId: string): Promise<void> {
  // Delete pending batch keys
  await redis.del(`batch:${runId}:pending`);

  // Delete any crawl state keys
  const crawlKeys = await redis.keys(`crawl:${runId}:*`);
  if (crawlKeys.length > 0) {
    await redis.del(...crawlKeys);
  }

  // Delete chunk embed status keys
  const embedStatusKeys = await redis.keys(`chunk_embed_status:${runId}:*`);
  if (embedStatusKeys.length > 0) {
    await redis.del(...embedStatusKeys);
  }

  log.debug("ingestion-worker", "Cleaned up Redis state for run", { runId });
}
