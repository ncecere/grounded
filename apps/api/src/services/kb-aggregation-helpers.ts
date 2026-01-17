import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { sources, kbChunks, tenantKbSubscriptions } from "@grounded/db/schema";

// ============================================================================
// Types
// ============================================================================

export interface KbCountResult {
  kbId: string;
  count: number;
}

export interface KbAggregatedCounts {
  sourceCount: number;
  chunkCount: number;
}

export interface KbAggregatedCountsWithShares extends KbAggregatedCounts {
  shareCount: number;
}

// ============================================================================
// Grouped Count Functions (for lists of KBs)
// ============================================================================

/**
 * Get source counts grouped by KB ID.
 * Used when listing knowledge bases to show source count per KB.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param kbIds - Array of KB IDs to get counts for
 * @returns Map of KB ID to source count
 */
export async function getSourceCountsByKb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  kbIds: string[]
): Promise<Map<string, number>> {
  if (kbIds.length === 0) {
    return new Map();
  }

  const results: KbCountResult[] = await tx
    .select({
      kbId: sources.kbId,
      count: sql<number>`count(*)::int`,
    })
    .from(sources)
    .where(and(inArray(sources.kbId, kbIds), isNull(sources.deletedAt)))
    .groupBy(sources.kbId);

  return new Map(results.map((r) => [r.kbId, r.count]));
}

/**
 * Get chunk counts grouped by KB ID.
 * Used when listing knowledge bases to show chunk count per KB.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param kbIds - Array of KB IDs to get counts for
 * @returns Map of KB ID to chunk count
 */
export async function getChunkCountsByKb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  kbIds: string[]
): Promise<Map<string, number>> {
  if (kbIds.length === 0) {
    return new Map();
  }

  const results: KbCountResult[] = await tx
    .select({
      kbId: kbChunks.kbId,
      count: sql<number>`count(*)::int`,
    })
    .from(kbChunks)
    .where(and(inArray(kbChunks.kbId, kbIds), isNull(kbChunks.deletedAt)))
    .groupBy(kbChunks.kbId);

  return new Map(results.map((r) => [r.kbId, r.count]));
}

/**
 * Get subscription/share counts grouped by KB ID.
 * Used when listing global KBs to show how many tenants each KB is shared with.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param kbIds - Array of KB IDs to get counts for
 * @returns Map of KB ID to share count
 */
export async function getShareCountsByKb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  kbIds: string[]
): Promise<Map<string, number>> {
  if (kbIds.length === 0) {
    return new Map();
  }

  const results: KbCountResult[] = await tx
    .select({
      kbId: tenantKbSubscriptions.kbId,
      count: sql<number>`count(*)::int`,
    })
    .from(tenantKbSubscriptions)
    .where(
      and(
        inArray(tenantKbSubscriptions.kbId, kbIds),
        isNull(tenantKbSubscriptions.deletedAt)
      )
    )
    .groupBy(tenantKbSubscriptions.kbId);

  return new Map(results.map((r) => [r.kbId, r.count]));
}

/**
 * Get source and chunk counts grouped by KB ID.
 * Convenience function combining getSourceCountsByKb and getChunkCountsByKb.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param kbIds - Array of KB IDs to get counts for
 * @returns Object with sourceCountMap and chunkCountMap
 */
export async function getKbCountMaps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  kbIds: string[]
): Promise<{
  sourceCountMap: Map<string, number>;
  chunkCountMap: Map<string, number>;
}> {
  const [sourceCountMap, chunkCountMap] = await Promise.all([
    getSourceCountsByKb(tx, kbIds),
    getChunkCountsByKb(tx, kbIds),
  ]);

  return { sourceCountMap, chunkCountMap };
}

/**
 * Get source, chunk, and share counts grouped by KB ID.
 * Used for admin global KB listings that include share counts.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param kbIds - Array of KB IDs to get counts for
 * @returns Object with sourceCountMap, chunkCountMap, and shareCountMap
 */
export async function getKbCountMapsWithShares(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  kbIds: string[]
): Promise<{
  sourceCountMap: Map<string, number>;
  chunkCountMap: Map<string, number>;
  shareCountMap: Map<string, number>;
}> {
  const [sourceCountMap, chunkCountMap, shareCountMap] = await Promise.all([
    getSourceCountsByKb(tx, kbIds),
    getChunkCountsByKb(tx, kbIds),
    getShareCountsByKb(tx, kbIds),
  ]);

  return { sourceCountMap, chunkCountMap, shareCountMap };
}

// ============================================================================
// Single KB Count Functions
// ============================================================================

/**
 * Get source count for a single KB.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param kbId - The KB ID to get the count for
 * @returns The source count
 */
export async function getKbSourceCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  kbId: string
): Promise<number> {
  const [result] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(sources)
    .where(and(eq(sources.kbId, kbId), isNull(sources.deletedAt)));

  return result?.count || 0;
}

/**
 * Get chunk count for a single KB.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param kbId - The KB ID to get the count for
 * @returns The chunk count
 */
export async function getKbChunkCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  kbId: string
): Promise<number> {
  const [result] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(kbChunks)
    .where(and(eq(kbChunks.kbId, kbId), isNull(kbChunks.deletedAt)));

  return result?.count || 0;
}

/**
 * Get aggregated counts (source and chunk) for a single KB.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param kbId - The KB ID to get counts for
 * @returns Object with sourceCount and chunkCount
 */
export async function getKbAggregatedCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  kbId: string
): Promise<KbAggregatedCounts> {
  const [sourceCount, chunkCount] = await Promise.all([
    getKbSourceCount(tx, kbId),
    getKbChunkCount(tx, kbId),
  ]);

  return { sourceCount, chunkCount };
}
