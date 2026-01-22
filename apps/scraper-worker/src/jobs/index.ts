/**
 * Jobs Index
 *
 * Central registration point for all scraper worker job handlers.
 * This module provides:
 * 1. Barrel exports of all job handler functions
 * 2. Job handler registry for dynamic dispatch by queue workers
 * 3. Job metadata for validation and documentation
 *
 * The scraper worker has a single job type: page-fetch.
 * The entry point uses this index for job registration verification.
 *
 * This follows the same pattern as the ingestion worker jobs index
 * to maintain consistency across workers.
 */

import type { Browser } from "playwright";
import type { PageFetchJob } from "@grounded/shared";
import { QUEUE_NAMES } from "@grounded/shared";

// ============================================================================
// Job Handler Exports
// ============================================================================

// Page fetch job handler
export { handlePageFetch, processPageFetch } from "./page-fetch";

// Re-import for registry (needed since we can't re-export and use in same module)
import { handlePageFetch } from "./page-fetch";

// ============================================================================
// Job Handler Types
// ============================================================================

/**
 * Page fetch job handler function signature.
 * Unlike ingestion worker jobs, page-fetch requires a browser instance
 * to be passed in addition to the job data.
 */
export type PageFetchHandler = (data: PageFetchJob, browser: Browser) => Promise<void>;

/**
 * Generic job handler function signature for registry.
 * The scraper worker only has one job type, but this provides
 * consistency with the ingestion worker pattern.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobHandler<T = any> = (data: T, browser: Browser) => Promise<void>;

/**
 * Job handler registry entry with metadata.
 */
export interface JobRegistration {
  /** Unique job name used in queue dispatch */
  name: string;
  /** Queue this job belongs to */
  queue: string;
  /** The handler function */
  handler: JobHandler;
  /** Description for documentation */
  description: string;
  /** Whether this job requires a browser instance */
  requiresBrowser: boolean;
}

// ============================================================================
// Page Fetch Queue Jobs
// ============================================================================

/**
 * Job handler for the PAGE_FETCH queue.
 * This is the primary (and only) job in the scraper worker.
 */
export const pageFetchJob = {
  name: "fetch",
  queue: QUEUE_NAMES.PAGE_FETCH,
  handler: handlePageFetch as JobHandler<PageFetchJob>,
  description: "Fetch page content from URLs using appropriate strategy (HTTP, Playwright, or Firecrawl)",
  requiresBrowser: true,
} as const;

// ============================================================================
// Job Registry
// ============================================================================

/**
 * Complete registry of all job handlers.
 * Used by queue workers for dispatch and by tests for validation.
 *
 * The scraper worker currently has only one job type (page-fetch),
 * but using a registry pattern allows for future extensibility
 * and maintains consistency with the ingestion worker.
 */
export const jobRegistry: ReadonlyArray<JobRegistration> = [
  pageFetchJob,
];

/**
 * Map of queue names to their job handlers for dispatch.
 * Queue workers use this to route jobs to the correct handler.
 */
export const jobsByQueue: Record<string, Record<string, JobHandler>> = {
  [QUEUE_NAMES.PAGE_FETCH]: {
    fetch: pageFetchJob.handler,
  },
};

// ============================================================================
// Job Lookup Utilities
// ============================================================================

/**
 * Get a job handler by queue and job name.
 * Returns undefined if the job is not found.
 *
 * @param queue - Queue name (e.g., "page-fetch")
 * @param jobName - Job name within the queue (e.g., "fetch")
 */
export function getJobHandler(queue: string, jobName: string): JobHandler | undefined {
  return jobsByQueue[queue]?.[jobName];
}

/**
 * Get the job handler for the page-fetch queue.
 * Convenience function since there's only one job type.
 */
export function getPageFetchHandler(): JobHandler<PageFetchJob> {
  return pageFetchJob.handler;
}

/**
 * Get all registered job names.
 * Useful for validation and documentation.
 *
 * @returns Array of fully qualified job names (queue:name format)
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

/**
 * Check if a job requires a browser instance.
 *
 * @param queue - Queue name
 * @param jobName - Job name within the queue
 */
export function jobRequiresBrowser(queue: string, jobName: string): boolean {
  const registration = jobRegistry.find(
    (job) => job.queue === queue && job.name === jobName
  );
  return registration?.requiresBrowser ?? false;
}

/**
 * Get job registration metadata by queue and job name.
 * Returns undefined if not found.
 */
export function getJobRegistration(
  queue: string,
  jobName: string
): JobRegistration | undefined {
  return jobRegistry.find(
    (job) => job.queue === queue && job.name === jobName
  );
}
