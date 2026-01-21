/**
 * Deletion Queue Worker
 *
 * Handles jobs from the DELETION queue.
 * Hard-deletes objects (KBs, sources, agents, tenants) and their related data.
 */

import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { createJobLogger } from "@grounded/logger/worker";
import {
  shouldSample,
  workerSamplingConfig,
} from "../bootstrap/helpers";
import { processHardDelete } from "../jobs";

// Fixed low concurrency for deletion jobs
const DELETION_CONCURRENCY = 2;

/**
 * Create a deletion worker with the given concurrency.
 */
export function createDeletionWorker(concurrency: number = DELETION_CONCURRENCY): Worker {
  return new Worker(
    QUEUE_NAMES.DELETION,
    async (job: Job) => {
      const event = createJobLogger(
        { service: "ingestion-worker", queue: QUEUE_NAMES.DELETION },
        job
      );
      event.setOperation("hard_delete");
      event.addFields({ objectType: job.data.objectType, objectId: job.data.objectId });

      try {
        await processHardDelete(job.data);
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
 * Default deletion worker instance.
 */
export const deletionWorker = createDeletionWorker();
