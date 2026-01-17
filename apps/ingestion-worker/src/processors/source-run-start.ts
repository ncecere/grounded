import { db } from "@grounded/db";
import { sourceRuns, sources } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { addSourceDiscoverUrlsJob } from "@grounded/queue";
import { log } from "@grounded/logger";
import type { SourceRunStartJob } from "@grounded/shared";

export async function processSourceRunStart(data: SourceRunStartJob): Promise<void> {
  const { tenantId, sourceId, runId, requestId, traceId } = data;

  log.info("ingestion-worker", "Starting source run", { runId, sourceId, requestId, traceId });

  // Update run status to running
  await db
    .update(sourceRuns)
    .set({
      status: "running",
      startedAt: new Date(),
    })
    .where(eq(sourceRuns.id, runId));

  // Get source config
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
  });

  if (!source) {
    throw new Error(`Source ${sourceId} not found`);
  }

  // Queue URL discovery
  await addSourceDiscoverUrlsJob({
    tenantId,
    runId,
    requestId,
    traceId,
  });

  log.info("ingestion-worker", "Source run started, discovery queued", { runId });
}
