/**
 * Hybrid search combining vector similarity and full-text search (FTS)
 * with Reciprocal Rank Fusion (RRF) for result merging.
 *
 * Architecture:
 *   - Vector search:  pgvector (<=> cosine distance) on the separate vector DB
 *   - FTS search:     plainto_tsquery + ts_rank_cd on kb_chunks.tsv (main DB)
 *   - Fusion:         RRF with k=60 (industry standard from Cormack et al. 2009)
 *
 * The vector results are fetched by the caller (RAG service) and passed in.
 * This module handles only the FTS query and the RRF merge.
 */

import { db } from "@grounded/db";
import { sql } from "drizzle-orm";
import { log } from "@grounded/logger";

// ============================================================================
// Types
// ============================================================================

export interface RankedResult {
  id: string;
  score: number;        // Normalised RRF score
  vectorScore?: number; // Original vector similarity score
  ftsScore?: number;    // Original FTS ts_rank_cd score
}

export interface FtsResult {
  id: string;
  rank: number; // ts_rank_cd value
}

export interface HybridSearchOptions {
  /** Tenant ID for RLS filtering */
  tenantId: string;
  /** Knowledge base IDs to search within */
  kbIds: string[];
  /** Pre-computed vector search results (id + score) */
  vectorResults: Array<{ id: string; score: number }>;
  /** User query text for FTS */
  query: string;
  /** How many FTS results to retrieve (default: same as vectorResults.length) */
  ftsTopK?: number;
  /** RRF constant (default: 60) */
  rrfK?: number;
  /** Weight for vector score in RRF (0-1, default: 0.5 = equal weight) */
  vectorWeight?: number;
}

// ============================================================================
// Full-Text Search
// ============================================================================

/**
 * Run a full-text search query against kb_chunks.tsv.
 * Returns chunk IDs ranked by ts_rank_cd (cover density ranking).
 */
export async function ftsSearch(
  tenantId: string,
  kbIds: string[],
  query: string,
  topK: number
): Promise<FtsResult[]> {
  if (!query.trim() || kbIds.length === 0) {
    return [];
  }

  try {
    const results = await db.execute(sql`
      SELECT id, ts_rank_cd(tsv, plainto_tsquery('english', ${query})) AS rank
      FROM kb_chunks
      WHERE (tenant_id = ${tenantId}::uuid OR tenant_id IS NULL)
        AND kb_id = ANY(${kbIds}::uuid[])
        AND deleted_at IS NULL
        AND tsv IS NOT NULL
        AND tsv @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${topK}
    `);

    return (results as unknown as Array<{ id: string; rank: string | number }>).map((r) => ({
      id: r.id,
      rank: Number(r.rank),
    }));
  } catch (error) {
    log.warn("api", "FTS search failed, falling back to vector-only", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ============================================================================
// Reciprocal Rank Fusion
// ============================================================================

/**
 * Merge vector and FTS results using Reciprocal Rank Fusion.
 *
 * RRF score for document d:  Σ  weight_i / (k + rank_i)
 *
 * where rank_i is the 1-based position in each result list and k is a
 * smoothing constant (default 60) that reduces the impact of high rankings.
 *
 * Reference: Cormack, Clarke & Buettcher (2009)
 */
export function reciprocalRankFusion(
  vectorResults: Array<{ id: string; score: number }>,
  ftsResults: FtsResult[],
  options: { k?: number; vectorWeight?: number } = {}
): RankedResult[] {
  const k = options.k ?? 60;
  const vectorWeight = options.vectorWeight ?? 0.5;
  const ftsWeight = 1 - vectorWeight;

  // Build rank maps (1-based)
  const vectorRankMap = new Map<string, { rank: number; score: number }>();
  for (let i = 0; i < vectorResults.length; i++) {
    vectorRankMap.set(vectorResults[i].id, {
      rank: i + 1,
      score: vectorResults[i].score,
    });
  }

  const ftsRankMap = new Map<string, { rank: number; score: number }>();
  for (let i = 0; i < ftsResults.length; i++) {
    ftsRankMap.set(ftsResults[i].id, {
      rank: i + 1,
      score: ftsResults[i].rank,
    });
  }

  // Collect all unique IDs
  const allIds = new Set<string>();
  for (const r of vectorResults) allIds.add(r.id);
  for (const r of ftsResults) allIds.add(r.id);

  // Calculate RRF score for each document
  const results: RankedResult[] = [];
  for (const id of allIds) {
    const vectorEntry = vectorRankMap.get(id);
    const ftsEntry = ftsRankMap.get(id);

    let rrfScore = 0;
    if (vectorEntry) {
      rrfScore += vectorWeight / (k + vectorEntry.rank);
    }
    if (ftsEntry) {
      rrfScore += ftsWeight / (k + ftsEntry.rank);
    }

    results.push({
      id,
      score: rrfScore,
      vectorScore: vectorEntry?.score,
      ftsScore: ftsEntry?.score,
    });
  }

  // Sort by RRF score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

// ============================================================================
// Combined Hybrid Search
// ============================================================================

/**
 * Run hybrid search: takes pre-computed vector results, runs FTS in parallel,
 * and merges via RRF.
 *
 * Returns ranked IDs — the caller is responsible for fetching chunk details.
 */
export async function hybridSearch(
  options: HybridSearchOptions
): Promise<RankedResult[]> {
  const {
    tenantId,
    kbIds,
    vectorResults,
    query,
    ftsTopK,
    rrfK = 60,
    vectorWeight = 0.5,
  } = options;

  const effectiveFtsTopK = ftsTopK ?? vectorResults.length;

  // Run FTS (vector results are already provided by the caller)
  const ftsResults = await ftsSearch(tenantId, kbIds, query, effectiveFtsTopK);

  // If FTS returned nothing, fall through to vector-only
  if (ftsResults.length === 0) {
    return vectorResults.map((r, i) => ({
      id: r.id,
      score: r.score,
      vectorScore: r.score,
    }));
  }

  return reciprocalRankFusion(vectorResults, ftsResults, {
    k: rrfK,
    vectorWeight,
  });
}
