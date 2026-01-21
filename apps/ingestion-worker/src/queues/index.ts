/**
 * Queues Index
 *
 * Exports all BullMQ Worker instances for the ingestion worker.
 * Each queue module creates a Worker that dispatches jobs to handlers from jobs/.
 *
 * Usage:
 * - Import workers directly for access to individual worker instances
 * - Call registerAllWorkers() to initialize all workers (no-op since workers
 *   are created on module load, but useful for explicit initialization)
 * - Call closeAllWorkers() for graceful shutdown
 */

import { Worker } from "@grounded/queue";
import { createSourceRunWorker, sourceRunWorker } from "./source-run";
import { createPageProcessWorker, pageProcessWorker } from "./page-process";
import { createPageIndexWorker, pageIndexWorker } from "./page-index";
import { createEmbedChunksWorker, embedChunksWorker } from "./embed-chunks";
import { createEnrichPageWorker, enrichPageWorker } from "./enrich-page";
import { createDeletionWorker, deletionWorker } from "./deletion";
import { createKbReindexWorker, kbReindexWorker } from "./kb-reindex";

// Re-export individual workers for direct access
export {
  sourceRunWorker,
  pageProcessWorker,
  pageIndexWorker,
  embedChunksWorker,
  enrichPageWorker,
  deletionWorker,
  kbReindexWorker,
};

// Re-export factory functions for custom configuration
export {
  createSourceRunWorker,
  createPageProcessWorker,
  createPageIndexWorker,
  createEmbedChunksWorker,
  createEnrichPageWorker,
  createDeletionWorker,
  createKbReindexWorker,
};

/**
 * All worker instances for iteration during shutdown.
 */
export const allWorkers: Worker[] = [
  sourceRunWorker,
  pageProcessWorker,
  pageIndexWorker,
  embedChunksWorker,
  enrichPageWorker,
  deletionWorker,
  kbReindexWorker,
];

/**
 * Register all workers (workers are created on import, this is a no-op).
 * Useful for explicit initialization in the entrypoint.
 */
export function registerAllWorkers(): void {
  // Workers are created on module import, no additional registration needed.
  // This function exists for explicit initialization semantics in the entrypoint.
}

/**
 * Close all workers gracefully.
 * Call this during shutdown to ensure all in-flight jobs complete.
 */
export async function closeAllWorkers(): Promise<void> {
  await Promise.all(allWorkers.map((worker) => worker.close()));
}
