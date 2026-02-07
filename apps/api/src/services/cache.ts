/**
 * Redis caching layer for frequently-accessed, rarely-mutated data.
 *
 * Provides generic get/set/invalidate helpers that sit on top of the shared
 * ioredis instance exported by @grounded/queue.  Every cached value is
 * JSON-serialised with a configurable TTL (seconds).
 *
 * Cache keys follow the pattern:  cache:{domain}:{...parts}
 *   e.g. cache:agent_config:{tenantId}:{agentId}
 *        cache:widget:{tokenHash}
 *        cache:embed:{modelId}:{queryHash}
 */

import { redis } from "@grounded/queue";
import { log } from "@grounded/logger";
import { createHash } from "crypto";

// ============================================================================
// Generic helpers
// ============================================================================

const KEY_PREFIX = "cache:";

function buildKey(domain: string, ...parts: string[]): string {
  return `${KEY_PREFIX}${domain}:${parts.join(":")}`;
}

/**
 * Get a cached value.  Returns `null` on miss or deserialisation error.
 */
export async function cacheGet<T>(
  domain: string,
  ...parts: string[]
): Promise<T | null> {
  try {
    const key = buildKey(domain, ...parts);
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn("api", "cache: get error", {
      domain,
      parts,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Set a cached value with a TTL (seconds).
 */
export async function cacheSet<T>(
  domain: string,
  parts: string[],
  value: T,
  ttlSeconds: number
): Promise<void> {
  try {
    const key = buildKey(domain, ...parts);
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    // Cache write failures are non-fatal — we just skip caching.
    log.warn("api", "cache: set error", {
      domain,
      parts,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Invalidate one or more cache keys.
 * Accepts exact key parts or a glob pattern suffix (e.g. "*").
 */
export async function cacheInvalidate(
  domain: string,
  ...parts: string[]
): Promise<void> {
  try {
    const key = buildKey(domain, ...parts);
    // If the last part is a wildcard, use SCAN to delete matching keys.
    if (key.endsWith("*")) {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", key, "COUNT", 100);
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== "0");
    } else {
      await redis.del(key);
    }
  } catch (err) {
    log.warn("api", "cache: invalidate error", {
      domain,
      parts,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// Domain-specific helpers
// ============================================================================

// -- Agent config -----------------------------------------------------------

const AGENT_CONFIG_DOMAIN = "agent_config";
const AGENT_CONFIG_TTL = 60; // seconds

export async function getAgentConfigCache<T>(
  tenantId: string,
  agentId: string
): Promise<T | null> {
  return cacheGet<T>(AGENT_CONFIG_DOMAIN, tenantId, agentId);
}

export async function setAgentConfigCache<T>(
  tenantId: string,
  agentId: string,
  value: T
): Promise<void> {
  return cacheSet(AGENT_CONFIG_DOMAIN, [tenantId, agentId], value, AGENT_CONFIG_TTL);
}

export async function invalidateAgentConfigCache(
  tenantId: string,
  agentId: string
): Promise<void> {
  return cacheInvalidate(AGENT_CONFIG_DOMAIN, tenantId, agentId);
}

/**
 * Invalidate all agent caches for a tenant (e.g. on tenant-wide model change).
 */
export async function invalidateAllAgentConfigCaches(
  tenantId: string
): Promise<void> {
  return cacheInvalidate(AGENT_CONFIG_DOMAIN, tenantId, "*");
}

// -- Widget token validation ------------------------------------------------

const WIDGET_DOMAIN = "widget";
const WIDGET_TTL = 120; // seconds

export async function getWidgetCache<T>(tokenHash: string): Promise<T | null> {
  return cacheGet<T>(WIDGET_DOMAIN, tokenHash);
}

export async function setWidgetCache<T>(
  tokenHash: string,
  value: T
): Promise<void> {
  return cacheSet(WIDGET_DOMAIN, [tokenHash], value, WIDGET_TTL);
}

export async function invalidateWidgetCache(tokenHash: string): Promise<void> {
  return cacheInvalidate(WIDGET_DOMAIN, tokenHash);
}

// -- Query embedding --------------------------------------------------------

const EMBED_DOMAIN = "embed";
const EMBED_TTL = 300; // 5 minutes

/**
 * Deterministic hash for an embedding cache key.
 * modelId + text  =>  sha256 hex (first 32 chars is plenty for cache key).
 */
export function embedCacheKey(modelId: string, text: string): string {
  return createHash("sha256")
    .update(`${modelId}::${text}`)
    .digest("hex")
    .slice(0, 32);
}

export async function getEmbeddingCache(
  hash: string
): Promise<number[] | null> {
  return cacheGet<number[]>(EMBED_DOMAIN, hash);
}

export async function setEmbeddingCache(
  hash: string,
  embedding: number[]
): Promise<void> {
  return cacheSet(EMBED_DOMAIN, [hash], embedding, EMBED_TTL);
}
