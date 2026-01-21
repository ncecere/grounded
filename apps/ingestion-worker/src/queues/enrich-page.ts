/**
 * Enrich Page Queue Worker
 *
 * Handles jobs from the ENRICH_PAGE queue.
 * Generates summaries, keywords, and tags for page chunks using LLM.
 */

import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { createJobLogger } from "@grounded/logger/worker";
import { getEnvNumber } from "@grounded/shared";
import {
  shouldSample,
  workerSamplingConfig,
} from "../bootstrap/helpers";
import { processEnrichPage } from "../jobs";

// Default concurrency from environment (half of worker concurrency)
const DEFAULT_CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);
const ENRICH_CONCURRENCY = Math.max(1, Math.floor(DEFAULT_CONCURRENCY / 2));

/**
 * Create an enrich page worker with the given concurrency.
 */
export function createEnrichPageWorker(concurrency: number = ENRICH_CONCURRENCY): Worker {
  return new Worker(
    QUEUE_NAMES.ENRICH_PAGE,
    async (job: Job) => {
      const event = createJobLogger(
        { service: "ingestion-worker", queue: QUEUE_NAMES.ENRICH_PAGE },
        job
      );
      event.setOperation("enrich_page");
      event.addFields({ chunkCount: job.data.chunkIds?.length });

      try {
        await processEnrichPage(job.data);
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
 * Default enrich page worker instance.
 */
export const enrichPageWorker = createEnrichPageWorker();
