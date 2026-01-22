/**
 * Page Fetch Job Handler
 *
 * This module provides the job handler function for the page-fetch queue.
 * It wraps the page fetch processor and provides the interface expected
 * by the jobs index for registry.
 *
 * The actual processing logic is in processors/page-fetch.ts.
 * This separation allows:
 * 1. Processor to focus on business logic
 * 2. Job handler to focus on job dispatch interface
 * 3. Tests to verify both layers independently
 */

import type { Browser } from "playwright";
import type { PageFetchJob } from "@grounded/shared";
import { processPageFetch } from "../processors/page-fetch";

/**
 * Process a page fetch job.
 *
 * This handler wraps the processor function and provides the signature
 * expected by the job registry. The browser instance is injected by
 * the worker at runtime from the browser pool.
 *
 * @param data - The page fetch job data
 * @param browser - Playwright browser instance from the pool
 */
export async function handlePageFetch(
  data: PageFetchJob,
  browser: Browser
): Promise<void> {
  return processPageFetch(data, browser);
}

// Re-export the processor for backward compatibility
export { processPageFetch } from "../processors/page-fetch";
