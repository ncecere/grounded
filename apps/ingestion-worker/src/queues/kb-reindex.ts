/**
 * KB Reindex Queue Worker
 *
 * Handles jobs from the KB_REINDEX queue.
 * Re-generates embeddings for all chunks in a knowledge base using a new model.
 */

import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { createJobLogger } from "@grounded/logger/worker";
import {
  shouldSample,
  workerSamplingConfig,
} from "../bootstrap/helpers";
import { processKbReindex } from "../jobs";

// Only one reindex at a time to avoid resource contention
const REINDEX_CONCURRENCY = 1;

/**
 * Create a KB reindex worker with the given concurrency.
 */
export function createKbReindexWorker(concurrency: number = REINDEX_CONCURRENCY): Worker {
  return new Worker(
    QUEUE_NAMES.KB_REINDEX,
    async (job: Job) => {
      const event = createJobLogger(
        { service: "ingestion-worker", queue: QUEUE_NAMES.KB_REINDEX },
        job
      );
      event.setOperation("kb_reindex");

      try {
        await processKbReindex(job.data);
        event.success();
      } catch (error) {
        if (error instanceof Error) {
          event.setError(error);
        } else {
          event.setError({ type: "UnknownError", message: String(error) });
        }
        throw error;
      } finally {
        if (shouldSample(event.getEvent(), workerSamplingConfig)) {
          event.emit();
        }
      }
    },
    {
      connection,
      concurrency,
    }
  );
}

/**
 * Default KB reindex worker instance.
 */
export const kbReindexWorker = createKbReindexWorker();
