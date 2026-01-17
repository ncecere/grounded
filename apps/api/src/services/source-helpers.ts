import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import { sources, sourceRuns, kbChunks } from "@grounded/db/schema";
import { sourceConfigSchema, type SourceConfig } from "@grounded/shared";
import { addSourceRunStartJob } from "@grounded/queue";

// ============================================================================
// Validation Schemas (shared between sources and shared-kbs routes)
// ============================================================================

/**
 * Base schema for creating a source (without kbId - provided by route param in shared-kbs)
 */
export const createSourceBaseSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["web"]),
  config: sourceConfigSchema,
  enrichmentEnabled: z.boolean().default(false),
});

/**
 * Schema for creating a source with kbId (used by tenant sources route)
 */
export const createSourceWithKbIdSchema = createSourceBaseSchema.extend({
  kbId: z.string().uuid(),
});

/**
 * Schema for updating a source (shared between routes)
 */
export const updateSourceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: sourceConfigSchema.partial().optional(),
  enrichmentEnabled: z.boolean().optional(),
});

/**
 * Schema for triggering a source run
 */
export const triggerRunSchema = z.object({
  forceReindex: z.boolean().optional().default(false),
});

// ============================================================================
// Types
// ============================================================================

export type CreateSourceBase = z.infer<typeof createSourceBaseSchema>;
export type CreateSourceWithKbId = z.infer<typeof createSourceWithKbIdSchema>;
export type UpdateSource = z.infer<typeof updateSourceSchema>;
export type TriggerRunInput = z.infer<typeof triggerRunSchema>;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  sourceId: string
): Promise<SourceStats> {
  // Get total unique page count across all runs for this source
  // Count distinct normalized URLs that succeeded
  const pageResult = await tx.execute(sql`
    SELECT COUNT(DISTINCT srp.normalized_url)::int as count
    FROM source_run_pages srp
    JOIN source_runs sr ON sr.id = srp.source_run_id
    WHERE sr.source_id = ${sourceId}
      AND srp.status = 'succeeded'
  `);
  // db.execute returns array directly or { rows: [...] } depending on driver
  const pageRows = Array.isArray(pageResult)
    ? pageResult
    : (pageResult as { rows?: unknown[] }).rows || [];
  const pageCount = (pageRows[0] as { count?: number })?.count || 0;

  // Get chunk count for this source
  const chunkResult = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(kbChunks)
    .where(and(eq(kbChunks.sourceId, sourceId), isNull(kbChunks.deletedAt)));
  const chunkCount = chunkResult[0]?.count || 0;

  return { pageCount, chunkCount };
}

// ============================================================================
// Cascade Delete
// ============================================================================

/**
 * Soft-delete all chunks associated with a source.
 * Used when soft-deleting a source.
 *
 * @param tx - Database transaction (withRequestRLS context)
 * @param sourceId - The source ID whose chunks should be deleted
 */
export async function cascadeSoftDeleteSourceChunks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  sourceId: string
): Promise<void> {
  await tx
    .update(kbChunks)
    .set({ deletedAt: new Date() })
    .where(and(eq(kbChunks.sourceId, sourceId), isNull(kbChunks.deletedAt)));
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  sourceId: string
): Promise<unknown> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
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
    tenantId: params.tenantId as string, // Cast needed for queue types
    sourceId: params.sourceId,
    runId: params.runId,
    requestId: params.requestId,
    traceId: params.traceId,
  });
}
