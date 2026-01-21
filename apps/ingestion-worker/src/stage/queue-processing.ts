import { log } from "@grounded/logger";
import {
  addPageProcessJob,
  getFetchedHtml,
  getFetchedHtmlUrls,
  initializeStageProgress,
} from "@grounded/queue";
import { getStageManagerConfig } from "./config";
import { calculatePriority } from "./priority";

/**
 * Queue processing jobs for a run's PROCESSING stage.
 * Gets URLs with fetched HTML from Redis and queues processing jobs.
 */
export async function queueProcessingJobs(
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  const config = getStageManagerConfig();

  const urlsWithHtml = await getFetchedHtmlUrls(runId);

  if (urlsWithHtml.length === 0) {
    log.info("ingestion-worker", "No pages to process for processing stage", { runId });
    return 0;
  }

  await initializeStageProgress(runId, urlsWithHtml.length);

  const priority = calculatePriority(urlsWithHtml.length);
  let queued = 0;

  for (let i = 0; i < urlsWithHtml.length; i += config.batchSize) {
    const batch = urlsWithHtml.slice(i, i + config.batchSize);

    for (const url of batch) {
      const fetchedData = await getFetchedHtml(runId, url);

      if (!fetchedData) {
        log.warn("ingestion-worker", "Fetched HTML not found for URL, skipping", { url, runId });
        continue;
      }

      await addPageProcessJob({
        tenantId,
        runId,
        url,
        html: "",
        title: fetchedData.title,
        depth: 0,
        sourceType: "web",
        requestId,
        traceId,
      }, { priority });
      queued++;
    }
  }

  log.info("ingestion-worker", "Queued processing jobs", { runId, queued, priority });
  return queued;
}
