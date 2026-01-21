/**
 * Source Run Queue Worker
 *
 * Handles jobs from the SOURCE_RUN queue:
 * - start: Initialize a new source run
 * - discover: Discover URLs for scraping
 * - finalize: Finalize a completed run
 * - stage-transition: Transition between pipeline stages
 */

import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { createJobLogger } from "@grounded/logger/worker";
import { getEnvNumber } from "@grounded/shared";
import {
  shouldSample,
  workerSamplingConfig,
} from "../bootstrap/helpers";
import {
  processSourceRunStart,
  processSourceDiscover,
  processSourceFinalize,
  processStageTransition,
} from "../jobs";

// Default concurrency from environment
const DEFAULT_CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);

/**
 * Create a source run worker with the given concurrency.
 * Use this for custom configuration; otherwise use the default export.
 */
export function createSourceRunWorker(concurrency: number = DEFAULT_CONCURRENCY): Worker {
  return new Worker(
    QUEUE_NAMES.SOURCE_RUN,
    async (job: Job) => {
      const event = createJobLogger(
        { service: "ingestion-worker", queue: QUEUE_NAMES.SOURCE_RUN },
        job
      );
      event.setOperation(job.name);

      try {
        switch (job.name) {
          case "start":
            await processSourceRunStart(job.data);
            break;
          case "discover":
            await processSourceDiscover(job.data);
            break;
          case "finalize":
            await processSourceFinalize(job.data);
            break;
          case "stage-transition":
            await processStageTransition(job.data);
            break;
          default:
            throw new Error(`Unknown job name: ${job.name}`);
        }
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
 * Default source run worker instance.
 */
export const sourceRunWorker = createSourceRunWorker();
