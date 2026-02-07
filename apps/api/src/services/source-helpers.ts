import { eq, and, isNull, sql } from "drizzle-orm";
import { sources, sourceRuns, kbChunks, uploads, knowledgeBases, agents, agentKbs, tenantMemberships, tenantKbSubscriptions } from "@grounded/db/schema";
import type { Database } from "@grounded/db";
import type { SourceConfig } from "@grounded/shared";
import { addSourceRunStartJob } from "@grounded/queue";
import { getVectorStore } from "@grounded/vector-store";
import { log } from "@grounded/logger";
import type { UpdateSource } from "../modules/sources/schema";

export {
  createSourceBaseSchema,
  createSourceWithKbIdSchema,
  updateSourceSchema,
  triggerRunSchema,
} from "../modules/sources/schema";
export type {
  CreateSourceBase,
  CreateSourceWithKbId,
  UpdateSource,
  TriggerRunInput,
} from "../modules/sources/schema";

// ============================================================================
// Types
// ============================================================================

export interface SourceStats {
  pageCount: number;
  chunkCount: number;
}

export interface TriggerRunResult {
  run: {
    id: string;
    sourceId: string;
    status: string;
    trigger: string;
    forceReindex: boolean;
    createdAt: Date;
  };
}

export interface TriggerRunError {
  error: string;
}

type SourceRunRecord = typeof sourceRuns.$inferSelect;

// ============================================================================
// Update Merging
// ============================================================================

/**
 * Merge source update data with existing config.
 * Handles partial config updates by merging with existing config.
 */
export function buildSourceUpdateData(
  existingConfig: SourceConfig,
  update: UpdateSource
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};

  if (update.name) {
    updateData.name = update.name;
  }

  if (update.enrichmentEnabled !== undefined) {
    updateData.enrichmentEnabled = update.enrichmentEnabled;
  }

  if (update.config) {
    updateData.config = { ...existingConfig, ...update.config };
  }

  return updateData;
}

// ============================================================================
// Stats Queries
// ============================================================================

/**
 * Calculate source statistics (page count and chunk count).
 * Used by both tenant sources and shared-kbs routes.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param sourceId - The source ID to get stats for
 * @returns Object with pageCount and chunkCount
 */
export async function calculateSourceStats(
  tx: Database,
  sourceId: string
): Promise<SourceStats> {
  // Count distinct normalizedUrls from non-deleted chunks (reflects current state)
  const pageResult = await tx
    .select({ count: sql<number>`count(distinct ${kbChunks.normalizedUrl})::int` })
    .from(kbChunks)
    .where(and(
      eq(kbChunks.sourceId, sourceId),
      isNull(kbChunks.deletedAt),
      sql`${kbChunks.normalizedUrl} IS NOT NULL`
    ));
  const pageCount = pageResult[0]?.count || 0;

  // Get chunk count for this source (only non-deleted chunks)
  const chunkResult = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(kbChunks)
    .where(and(eq(kbChunks.sourceId, sourceId), isNull(kbChunks.deletedAt)));
  const chunkCount = chunkResult[0]?.count || 0;

  return { pageCount, chunkCount };
}

// ============================================================================
// Cascade Soft Delete
// ============================================================================

/**
 * Soft-delete all data associated with a source:
 *   - kb_chunks (soft-delete)
 *   - uploads (soft-delete)
 *   - vectors in pgvector (hard-delete — so they can't answer questions)
 *
 * Does NOT soft-delete the source row itself (caller handles that).
 */
export async function cascadeSoftDeleteSource(
  tx: Database,
  sourceId: string
): Promise<void> {
  const now = new Date();

  // Soft-delete chunks
  await tx
    .update(kbChunks)
    .set({ deletedAt: now })
    .where(and(eq(kbChunks.sourceId, sourceId), isNull(kbChunks.deletedAt)));

  // Soft-delete uploads
  await tx
    .update(uploads)
    .set({ deletedAt: now })
    .where(and(eq(uploads.sourceId, sourceId), isNull(uploads.deletedAt)));

  // Hard-delete vectors so they can't be used in search
  try {
    const vectorStore = getVectorStore();
    if (vectorStore) {
      await vectorStore.deleteByMetadata({ sourceId });
    }
  } catch (err) {
    log.error("api", "Failed to delete vectors for source", {
      sourceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Backward-compatible alias for cascadeSoftDeleteSource.
 * @deprecated Use cascadeSoftDeleteSource instead
 */
export const cascadeSoftDeleteSourceChunks = cascadeSoftDeleteSource;

/**
 * Soft-delete all data associated with a knowledge base:
 *   - All sources + their chunks/uploads/vectors (via cascadeSoftDeleteSource)
 *   - The sources themselves
 *   - Tenant KB subscriptions
 *
 * Does NOT soft-delete the KB row itself (caller handles that).
 */
export async function cascadeSoftDeleteKb(
  tx: Database,
  kbId: string
): Promise<void> {
  const now = new Date();

  // Find all non-deleted sources for this KB
  const kbSources = await tx.query.sources.findMany({
    where: and(eq(sources.kbId, kbId), isNull(sources.deletedAt)),
    columns: { id: true },
  });

  // Cascade delete each source's data
  for (const source of kbSources) {
    await cascadeSoftDeleteSource(tx, source.id);
  }

  // Soft-delete the sources themselves
  if (kbSources.length > 0) {
    await tx
      .update(sources)
      .set({ deletedAt: now })
      .where(and(eq(sources.kbId, kbId), isNull(sources.deletedAt)));
  }

  // Soft-delete tenant KB subscriptions
  await tx
    .update(tenantKbSubscriptions)
    .set({ deletedAt: now })
    .where(and(eq(tenantKbSubscriptions.kbId, kbId), isNull(tenantKbSubscriptions.deletedAt)));
}

/**
 * Soft-delete all data associated with a tenant:
 *   - All KBs + their sources/chunks/uploads/vectors (via cascadeSoftDeleteKb)
 *   - The KBs themselves
 *   - All agents + agent_kbs
 *   - All memberships
 *   - All vectors for the tenant (bulk cleanup in case any were missed)
 *
 * Does NOT soft-delete the tenant row itself (caller handles that).
 */
export async function cascadeSoftDeleteTenant(
  tx: Database,
  tenantId: string
): Promise<void> {
  const now = new Date();

  // Find all non-deleted KBs for this tenant
  const tenantKbs = await tx.query.knowledgeBases.findMany({
    where: and(eq(knowledgeBases.tenantId, tenantId), isNull(knowledgeBases.deletedAt)),
    columns: { id: true },
  });

  // Cascade delete each KB's data
  for (const kb of tenantKbs) {
    await cascadeSoftDeleteKb(tx, kb.id);
  }

  // Soft-delete the KBs themselves
  if (tenantKbs.length > 0) {
    await tx
      .update(knowledgeBases)
      .set({ deletedAt: now })
      .where(and(eq(knowledgeBases.tenantId, tenantId), isNull(knowledgeBases.deletedAt)));
  }

  // Soft-delete agents and agent_kbs
  await tx
    .update(agentKbs)
    .set({ deletedAt: now })
    .where(
      and(
        sql`${agentKbs.agentId} IN (SELECT id FROM agents WHERE tenant_id = ${tenantId} AND deleted_at IS NULL)`,
        isNull(agentKbs.deletedAt)
      )
    );

  await tx
    .update(agents)
    .set({ deletedAt: now })
    .where(and(eq(agents.tenantId, tenantId), isNull(agents.deletedAt)));

  // Soft-delete memberships
  await tx
    .update(tenantMemberships)
    .set({ deletedAt: now })
    .where(and(eq(tenantMemberships.tenantId, tenantId), isNull(tenantMemberships.deletedAt)));

  // Bulk-delete all vectors for tenant (catches anything missed)
  try {
    const vectorStore = getVectorStore();
    if (vectorStore) {
      await vectorStore.deleteByMetadata({ tenantId });
    }
  } catch (err) {
    log.error("api", "Failed to delete vectors for tenant", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================================
// Run Management
// ============================================================================

/**
 * Check if a source has a running run.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param sourceId - The source ID to check
 * @returns The running run if one exists, null otherwise
 */
export async function findRunningRun(
  tx: Database,
  sourceId: string
): Promise<SourceRunRecord | undefined> {
  return tx.query.sourceRuns.findFirst({
    where: and(
      eq(sourceRuns.sourceId, sourceId),
      eq(sourceRuns.status, "running")
    ),
  });
}

/**
 * Create a new source run.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param params - Parameters for creating the run
 * @returns The created run
 */
export async function createSourceRun(
  tx: Database,
  params: {
    tenantId: string | null;
    sourceId: string;
    forceReindex: boolean;
    trigger?: "manual" | "scheduled";
  }
): Promise<TriggerRunResult["run"]> {
  const [run] = await tx
    .insert(sourceRuns)
    .values({
      tenantId: params.tenantId,
      sourceId: params.sourceId,
      trigger: params.trigger || "manual",
      status: "pending",
      forceReindex: params.forceReindex,
    })
    .returning();

  return run;
}

/**
 * Queue a source run job to be processed by the worker.
 *
 * @param params - Job parameters
 */
export async function queueSourceRunJob(params: {
  tenantId: string | null;
  sourceId: string;
  runId: string;
  requestId?: string;
  traceId?: string;
}): Promise<void> {
  await addSourceRunStartJob({
    tenantId: params.tenantId,
    sourceId: params.sourceId,
    runId: params.runId,
    requestId: params.requestId,
    traceId: params.traceId,
  });
}
