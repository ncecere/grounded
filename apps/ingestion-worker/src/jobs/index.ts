/**
 * Jobs Index
 *
 * Central registration point for all ingestion worker job handlers.
 * This module provides:
 * 1. Barrel exports of all job handler functions
 * 2. Job handler registry for dynamic dispatch by queue workers
 * 3. Job metadata for validation and documentation
 *
 * Queue modules (in queues/) import these handlers and dispatch by job name.
 * The entry point uses this index for job registration verification.
 */

import type {
  SourceRunStartJob,
  SourceDiscoverUrlsJob,
  SourceRunFinalizeJob,
  StageTransitionJob,
  PageProcessJob,
  PageIndexJob,
  EmbedChunksBatchJob,
  EnrichPageJob,
  HardDeleteObjectJob,
  KbReindexJob,
} from "@grounded/shared";

// ============================================================================
// Job Handler Exports
// ============================================================================

// Source run job handlers
export { processSourceRunStart } from "./source-run-start";
export { processSourceDiscover } from "./source-discover";
export { processSourceFinalize } from "./source-finalize";
export { processStageTransition } from "./stage-transition";

// Page processing job handlers
export { processPageProcess } from "./page-process";
export { processPageIndex } from "./page-index";
export { processEmbedChunks } from "./embed-chunks";
export { processEnrichPage } from "./enrich-page";

// Utility job handlers
export { processHardDelete } from "./hard-delete";
export { processKbReindex } from "./kb-reindex";

// Re-import for registry (needed since we can't re-export and use in same module)
import { processSourceRunStart } from "./source-run-start";
import { processSourceDiscover } from "./source-discover";
import { processSourceFinalize } from "./source-finalize";
import { processStageTransition } from "./stage-transition";
import { processPageProcess } from "./page-process";
import { processPageIndex } from "./page-index";
import { processEmbedChunks } from "./embed-chunks";
import { processEnrichPage } from "./enrich-page";
import { processHardDelete } from "./hard-delete";
import { processKbReindex } from "./kb-reindex";

// ============================================================================
// Job Handler Types
// ============================================================================

/**
 * Generic job handler function signature.
 * The type parameter is contravariant, so use `any` for registry entries.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobHandler<T = any> = (data: T) => Promise<void>;

/**
 * Job handler registry entry with metadata.
 */
export interface JobRegistration {
  /** Unique job name used in queue dispatch */
  name: string;
  /** Queue this job belongs to */
  queue: string;
  /** The handler function (uses any for type flexibility in registry) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: JobHandler<any>;
  /** Description for documentation */
  description: string;
}

// ============================================================================
// Source Run Queue Jobs
// ============================================================================

/**
 * Job handlers for the SOURCE_RUN queue.
 * These handle the orchestration of source run lifecycle.
 */
export const sourceRunJobs = {
  /** Initialize a new source run */
  start: {
    name: "start",
    queue: "source-run",
    handler: processSourceRunStart as JobHandler<SourceRunStartJob>,
    description: "Initialize a new source run and queue discovery",
  },
  /** Discover URLs for scraping */
  discover: {
    name: "discover",
    queue: "source-run",
    handler: processSourceDiscover as JobHandler<SourceDiscoverUrlsJob>,
    description: "Discover URLs from source configuration (sitemap, domain crawl)",
  },
  /** Finalize a completed run */
  finalize: {
    name: "finalize",
    queue: "source-run",
    handler: processSourceFinalize as JobHandler<SourceRunFinalizeJob>,
    description: "Finalize run status and cleanup after all stages complete",
  },
  /** Transition between pipeline stages */
  "stage-transition": {
    name: "stage-transition",
    queue: "source-run",
    handler: processStageTransition as JobHandler<StageTransitionJob>,
    description: "Transition run from one pipeline stage to the next",
  },
} as const;

// ============================================================================
// Page Processing Queue Jobs
// ============================================================================

/**
 * Job handler for the PAGE_PROCESS queue.
 */
export const pageProcessJob = {
  name: "process",
  queue: "page-process",
  handler: processPageProcess as JobHandler<PageProcessJob>,
  description: "Extract content from fetched HTML and create page records",
} as const;

/**
 * Job handler for the PAGE_INDEX queue.
 */
export const pageIndexJob = {
  name: "index",
  queue: "page-index",
  handler: processPageIndex as JobHandler<PageIndexJob>,
  description: "Chunk page content and prepare for embedding",
} as const;

/**
 * Job handler for the EMBED_CHUNKS queue.
 */
export const embedChunksJob = {
  name: "embed",
  queue: "embed-chunks",
  handler: processEmbedChunks as JobHandler<EmbedChunksBatchJob>,
  description: "Generate embeddings for content chunks",
} as const;

/**
 * Job handler for the ENRICH_PAGE queue.
 */
export const enrichPageJob = {
  name: "enrich",
  queue: "enrich-page",
  handler: processEnrichPage as JobHandler<EnrichPageJob>,
  description: "Enrich page with AI-generated metadata (title, summary)",
} as const;

// ============================================================================
// Utility Queue Jobs
// ============================================================================

/**
 * Job handler for the DELETION queue.
 */
export const hardDeleteJob = {
  name: "hard-delete",
  queue: "deletion",
  handler: processHardDelete as JobHandler<HardDeleteObjectJob>,
  description: "Permanently delete resources and associated data",
} as const;

/**
 * Job handler for the KB_REINDEX queue.
 */
export const kbReindexJob = {
  name: "reindex",
  queue: "kb-reindex",
  handler: processKbReindex as JobHandler<KbReindexJob>,
  description: "Reindex all chunks in a knowledge base with new embeddings",
} as const;

// ============================================================================
// Job Registry
// ============================================================================

/**
 * Complete registry of all job handlers.
 * Used by queue workers for dispatch and by tests for validation.
 */
export const jobRegistry: ReadonlyArray<JobRegistration> = [
  // Source run jobs
  sourceRunJobs.start,
  sourceRunJobs.discover,
  sourceRunJobs.finalize,
  sourceRunJobs["stage-transition"],
  // Page processing jobs
  pageProcessJob,
  pageIndexJob,
  embedChunksJob,
  enrichPageJob,
  // Utility jobs
  hardDeleteJob,
  kbReindexJob,
];

/**
 * Map of queue names to their job handlers for dispatch.
 * Queue workers use this to route jobs to the correct handler.
 */
export const jobsByQueue: Record<string, Record<string, JobHandler>> = {
  "source-run": {
    start: sourceRunJobs.start.handler,
    discover: sourceRunJobs.discover.handler,
    finalize: sourceRunJobs.finalize.handler,
    "stage-transition": sourceRunJobs["stage-transition"].handler,
  },
  "page-process": {
    process: pageProcessJob.handler,
  },
  "page-index": {
    index: pageIndexJob.handler,
  },
  "embed-chunks": {
    embed: embedChunksJob.handler,
  },
  "enrich-page": {
    enrich: enrichPageJob.handler,
  },
  deletion: {
    "hard-delete": hardDeleteJob.handler,
  },
  "kb-reindex": {
    reindex: kbReindexJob.handler,
  },
};

/**
 * Get a job handler by queue and job name.
 * Returns undefined if the job is not found.
 */
export function getJobHandler(queue: string, jobName: string): JobHandler | undefined {
  return jobsByQueue[queue]?.[jobName];
}

/**
 * Get all registered job names.
 * Useful for validation and documentation.
 */
export function getRegisteredJobNames(): string[] {
  return jobRegistry.map((job) => `${job.queue}:${job.name}`);
}

/**
 * Get the count of registered job handlers.
 */
export function getJobCount(): number {
  return jobRegistry.length;
}
