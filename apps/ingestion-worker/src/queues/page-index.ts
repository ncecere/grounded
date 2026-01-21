/**
 * Page Index Queue Worker
 *
 * Handles jobs from the PAGE_INDEX queue.
 * Chunks page content and creates kb_chunks records.
 */

import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { createJobLogger } from "@grounded/logger/worker";
import { getEnvNumber } from "@grounded/shared";
import {
  shouldSample,
  workerSamplingConfig,
} from "../bootstrap/helpers";
import { processPageIndex } from "../jobs";

// Default concurrency from environment
const DEFAULT_INDEX_CONCURRENCY = getEnvNumber("INDEX_WORKER_CONCURRENCY", 5);

/**
 * Create a page index worker with the given concurrency.
 */
export function createPageIndexWorker(concurrency: number = DEFAULT_INDEX_CONCURRENCY): Worker {
  return new Worker(
    QUEUE_NAMES.PAGE_INDEX,
    async (job: Job) => {
      const event = createJobLogger(
        { service: "ingestion-worker", queue: QUEUE_NAMES.PAGE_INDEX },
        job
      );
      event.setOperation("page_index");
      event.addFields({ pageId: job.data.pageId, contentId: job.data.contentId });

      try {
        await processPageIndex(job.data);
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
 * Default page index worker instance.
 */
export const pageIndexWorker = createPageIndexWorker();
