import { db } from "@grounded/db";
import { sourceRuns, sources } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { addSourceDiscoverUrlsJob } from "@grounded/queue";
import type { SourceRunStartJob } from "@grounded/shared";

export async function processSourceRunStart(data: SourceRunStartJob): Promise<void> {
  const { tenantId, sourceId, runId } = data;

  console.log(`Starting source run ${runId} for source ${sourceId}`);

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
  });

  console.log(`Source run ${runId} started, discovery queued`);
}
