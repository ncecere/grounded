/**
 * Embed Chunks Queue Worker
 *
 * Handles jobs from the EMBED_CHUNKS queue.
 * Generates vector embeddings for chunks and stores them in pgvector.
 */

import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { createJobLogger } from "@grounded/logger/worker";
import { getEnvNumber } from "@grounded/shared";
import {
  shouldSample,
  workerSamplingConfig,
} from "../bootstrap/helpers";
import { processEmbedChunks } from "../jobs";

// Default concurrency from environment
const DEFAULT_EMBED_CONCURRENCY = getEnvNumber("EMBED_WORKER_CONCURRENCY", 4);

/**
 * Create an embed chunks worker with the given concurrency.
 */
export function createEmbedChunksWorker(concurrency: number = DEFAULT_EMBED_CONCURRENCY): Worker {
  return new Worker(
    QUEUE_NAMES.EMBED_CHUNKS,
    async (job: Job) => {
      const event = createJobLogger(
        { service: "ingestion-worker", queue: QUEUE_NAMES.EMBED_CHUNKS },
        job
      );
      event.setOperation("embed_chunks");
      event.addFields({ chunkCount: job.data.chunkIds?.length });

      try {
        await processEmbedChunks(job.data);
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
 * Default embed chunks worker instance.
 */
export const embedChunksWorker = createEmbedChunksWorker();
