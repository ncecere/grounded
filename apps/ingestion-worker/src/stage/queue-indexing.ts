import { db } from "@grounded/db";
import { sourceRunPages, sourceRunPageContents } from "@grounded/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { log } from "@grounded/logger";
import { addPageIndexJob, initializeStageProgress } from "@grounded/queue";
import { getStageManagerConfig } from "./config";
import { calculatePriority } from "./priority";

/**
 * Queue indexing jobs for a run's INDEXING stage.
 * Gets pages that were successfully processed and queues them for chunking/indexing.
 */
export async function queueIndexingJobs(
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  const config = getStageManagerConfig();

  const pagesToIndex = await db.query.sourceRunPages.findMany({
    where: and(
      eq(sourceRunPages.sourceRunId, runId),
      eq(sourceRunPages.currentStage, "extract"),
      eq(sourceRunPages.status, "succeeded")
    ),
    columns: { id: true },
  });

  if (pagesToIndex.length === 0) {
    log.info("ingestion-worker", "No pages to index for indexing stage", { runId });
    return 0;
  }

  await initializeStageProgress(runId, pagesToIndex.length);

  const priority = calculatePriority(pagesToIndex.length);
  let queued = 0;

  for (let i = 0; i < pagesToIndex.length; i += config.batchSize) {
    const batch = pagesToIndex.slice(i, i + config.batchSize);
    const pageIds = batch.map(page => page.id);

    const contents = await db.query.sourceRunPageContents.findMany({
      where: inArray(sourceRunPageContents.sourceRunPageId, pageIds),
    });

    for (const content of contents) {
      await addPageIndexJob({
        tenantId,
        runId,
        pageId: content.sourceRunPageId,
        contentId: content.id,
        sourceType: "web",
        requestId,
        traceId,
      }, { priority });
      queued++;
    }
  }

  log.info("ingestion-worker", "Queued indexing jobs", { runId, queued, priority });
  return queued;
}
