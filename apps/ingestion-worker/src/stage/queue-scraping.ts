import { db } from "@grounded/db";
import { sourceRuns, sources } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { log } from "@grounded/logger";
import type { FetchMode } from "@grounded/shared";
import {
  addPageFetchJob,
  redis,
  initializeStageProgress,
  registerRun,
} from "@grounded/queue";
import { createCrawlState } from "@grounded/crawl-state";
import { getStageManagerConfig } from "./config";
import { calculatePriority } from "./priority";

/**
 * Queue scraping jobs for a run's SCRAPING stage.
 * Gets URLs from crawl state (Redis) and queues fetch jobs.
 */
export async function queueScrapingJobs(
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  const config = getStageManagerConfig();

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

  const sourceConfig = source.config as { firecrawlEnabled?: boolean };
  const fetchMode: FetchMode = sourceConfig.firecrawlEnabled ? "firecrawl" : "auto";

  const crawlState = createCrawlState(redis, runId);
  const queuedUrls = await crawlState.getQueuedUrls();

  if (queuedUrls.length === 0) {
    log.info("ingestion-worker", "No URLs to fetch for scraping stage", { runId });
    return 0;
  }

  await registerRun(runId);
  log.debug("ingestion-worker", "Registered run with fairness scheduler", { runId });

  await initializeStageProgress(runId, queuedUrls.length);

  const priority = calculatePriority(queuedUrls.length);
  let queued = 0;

  for (let i = 0; i < queuedUrls.length; i += config.batchSize) {
    const batch = queuedUrls.slice(i, i + config.batchSize);

    for (const url of batch) {
      await addPageFetchJob({
        tenantId,
        runId,
        url,
        fetchMode,
        depth: 0,
        requestId,
        traceId,
      }, { priority });
      queued++;
    }
  }

  log.info("ingestion-worker", "Queued scraping jobs", { runId, queued, priority });
  return queued;
}
