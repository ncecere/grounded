import { db } from "@grounded/db";
import { sourceRunPages } from "@grounded/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Calculate job priority based on run size (smaller runs = higher priority)
 * Lower numbers = higher priority in BullMQ
 */
export function calculatePriority(totalItems: number): number {
  // Cap at 10000 to prevent extremely large runs from getting infinite depriority
  return Math.min(totalItems, 10000);
}

/**
 * Get the total size of a run for priority calculation
 */
export async function getRunSize(runId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(sourceRunPages)
    .where(eq(sourceRunPages.sourceRunId, runId));
  return Number(result[0]?.count || 0);
}
