/**
 * Page Process Queue Worker
 *
 * Handles jobs from the PAGE_PROCESS queue.
 * Processes fetched HTML content: extracts text, creates page records.
 */

import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { createJobLogger } from "@grounded/logger/worker";
import { getEnvNumber } from "@grounded/shared";
import {
  shouldSample,
  workerSamplingConfig,
} from "../bootstrap/helpers";
import { processPageProcess } from "../jobs";

// Default concurrency from environment
const DEFAULT_CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);

/**
 * Create a page process worker with the given concurrency.
 */
export function createPageProcessWorker(concurrency: number = DEFAULT_CONCURRENCY): Worker {
  return new Worker(
    QUEUE_NAMES.PAGE_PROCESS,
    async (job: Job) => {
      const event = createJobLogger(
        { service: "ingestion-worker", queue: QUEUE_NAMES.PAGE_PROCESS },
        job
      );
      event.setOperation("page_process");
      event.addFields({ url: job.data.url, depth: job.data.depth });

      try {
        await processPageProcess(job.data);
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
 * Default page process worker instance.
 */
export const pageProcessWorker = createPageProcessWorker();
