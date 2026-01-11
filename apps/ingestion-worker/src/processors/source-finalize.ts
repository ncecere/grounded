import { db } from "@kcb/db";
import { sourceRuns, sourceRunPages } from "@kcb/db/schema";
import { eq } from "drizzle-orm";
import type { SourceRunFinalizeJob } from "@kcb/shared";

export async function processSourceFinalize(data: SourceRunFinalizeJob): Promise<void> {
  const { runId } = data;

  console.log(`Finalizing source run ${runId}`);

  // Get run
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  // Calculate final stats - simple count queries to avoid SQL issues
  const allPages = await db
    .select()
    .from(sourceRunPages)
    .where(eq(sourceRunPages.sourceRunId, runId));

  const stats = {
    total: allPages.length,
    succeeded: allPages.filter(p => p.status === 'succeeded').length,
    failed: allPages.filter(p => p.status === 'failed').length,
    skipped: allPages.filter(p => p.status === 'skipped_unchanged').length,
  };

  console.log(`Stats for run ${runId}:`, stats);

  // Determine final status
  // Skipped pages count as successful (content unchanged from previous run)
  const successfulPages = stats.succeeded + stats.skipped;

  let finalStatus: "succeeded" | "partial" | "failed";
  if (successfulPages > 0 && stats.failed === 0) {
    finalStatus = "succeeded";
  } else if (successfulPages > 0 && stats.failed > 0) {
    finalStatus = "partial";
  } else {
    finalStatus = "failed";
  }

  const finishedAt = new Date();

  console.log(`Updating run ${runId} with status ${finalStatus}`);

  try {
    // Update run
    await db
      .update(sourceRuns)
      .set({
        status: finalStatus,
        finishedAt,
        stats: {
          pagesSeen: stats.total,
          pagesIndexed: stats.succeeded,
          pagesFailed: stats.failed,
          tokensEstimated: run.stats?.tokensEstimated || 0,
        },
      })
      .where(eq(sourceRuns.id, runId));
    console.log(`Run ${runId} updated successfully`);
  } catch (e) {
    console.error(`Error updating run ${runId}:`, e);
    throw e;
  }

  // Note: sources table doesn't have lastRunAt column yet - skip this update for now
  // TODO: Add migration to add lastRunAt column to sources table

  console.log(
    `Source run ${runId} finalized: ${finalStatus} (${stats.succeeded}/${stats.total} pages)`
  );
}
