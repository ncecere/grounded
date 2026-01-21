import { db } from "@grounded/db";
import { sourceRuns, kbChunks, sources } from "@grounded/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { log } from "@grounded/logger";
import {
  addEmbedChunksBatchJob,
  initializeChunkEmbedStatuses,
  initializeStageProgress,
} from "@grounded/queue";
import { calculatePriority } from "./priority";

export const EMBED_BATCH_SIZE = 50;

/**
 * Queue embedding jobs for a run's EMBEDDING stage.
 * Gets chunks that need embedding and queues them in batches.
 *
 * IMPORTANT: Stage progress is tracked by number of JOBS (batches), not chunks.
 * This ensures proper stage completion when all embed jobs finish.
 */
export async function queueEmbeddingJobs(
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  const source = await db.query.sources.findFirst({
    where: eq(sources.id, run.sourceId),
  });

  if (!source) {
    throw new Error(`Source ${run.sourceId} not found`);
  }

  const kbId = source.kbId;

  const chunks = await db.query.kbChunks.findMany({
    where: and(
      eq(kbChunks.sourceRunId, runId),
      isNull(kbChunks.deletedAt)
    ),
    columns: { id: true },
  });

  if (chunks.length === 0) {
    log.info("ingestion-worker", "No chunks to embed for embedding stage", { runId });
    return 0;
  }

  const chunkIds = chunks.map(chunk => chunk.id);
  const numJobs = Math.ceil(chunkIds.length / EMBED_BATCH_SIZE);

  await initializeStageProgress(runId, numJobs);
  await initializeChunkEmbedStatuses(runId, kbId, chunkIds);

  const priority = calculatePriority(chunkIds.length);
  let queued = 0;

  for (let i = 0; i < chunkIds.length; i += EMBED_BATCH_SIZE) {
    const batchChunkIds = chunkIds.slice(i, i + EMBED_BATCH_SIZE);

    await addEmbedChunksBatchJob({
      tenantId,
      kbId,
      chunkIds: batchChunkIds,
      runId,
      requestId,
      traceId,
    }, { priority });
    queued++;
  }

  log.info("ingestion-worker", "Queued embedding jobs", {
    runId,
    queued,
    totalChunks: chunkIds.length,
    priority,
  });
  return queued;
}
