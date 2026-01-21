/**
 * Stage Job Queuer - Queues jobs for each stage of the ingestion pipeline
 */

import { log } from "@grounded/logger";
import { SourceRunStage } from "@grounded/shared";
import { queueScrapingJobs } from "./stage/queue-scraping";
import { queueProcessingJobs } from "./stage/queue-processing";
import { queueIndexingJobs } from "./stage/queue-indexing";
import { EMBED_BATCH_SIZE, queueEmbeddingJobs } from "./stage/queue-embedding";

export { queueScrapingJobs } from "./stage/queue-scraping";
export { queueProcessingJobs } from "./stage/queue-processing";
export { queueIndexingJobs } from "./stage/queue-indexing";
export { queueEmbeddingJobs, EMBED_BATCH_SIZE } from "./stage/queue-embedding";

/**
 * Queue jobs for a given stage.
 * Returns the number of jobs queued.
 */
export async function queueJobsForStage(
  stage: SourceRunStage,
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  switch (stage) {
    case SourceRunStage.SCRAPING:
      return queueScrapingJobs(runId, tenantId, requestId, traceId);
    case SourceRunStage.PROCESSING:
      return queueProcessingJobs(runId, tenantId, requestId, traceId);
    case SourceRunStage.INDEXING:
      return queueIndexingJobs(runId, tenantId, requestId, traceId);
    case SourceRunStage.EMBEDDING:
      return queueEmbeddingJobs(runId, tenantId, requestId, traceId);
    default:
      log.warn("ingestion-worker", "No job queuing logic for stage", { stage, runId });
      return 0;
  }
}
