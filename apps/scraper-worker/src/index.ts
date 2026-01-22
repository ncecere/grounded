import { Worker, Job, connection, QUEUE_NAMES, isFairnessSlotError, DelayedError } from "@grounded/queue";
import { createWorkerLogger, createJobLogger } from "@grounded/logger/worker";
import { shouldSample, createSamplingConfig } from "@grounded/logger";
import { processPageFetch } from "./processors/page-fetch";
import { initializeBrowserPool, getBrowser, shutdownBrowserPool } from "./browser/pool";
import {
  initializeSettings,
  stopSettingsRefresh,
  getCurrentConcurrency,
  getHeadlessMode,
  DEFAULT_CONCURRENCY,
} from "./bootstrap";

const logger = createWorkerLogger("scraper-worker");

// Sampling config from environment variables with worker-specific defaults
// Workers log 100% by default (can reduce with LOG_SAMPLE_RATE env var)
const samplingConfig = createSamplingConfig({
  baseSampleRate: 1.0,  // Log all jobs by default
  slowRequestThresholdMs: 30000, // 30s is slow for a job
});

const HEADLESS = getHeadlessMode();
logger.info({ concurrency: DEFAULT_CONCURRENCY, headless: HEADLESS }, "Starting Scraper Worker...");

// ============================================================================
// Browser Pool Initialization
// ============================================================================

// Initialize browser pool with configuration
// The pool lazily launches the browser on first getBrowser() call
initializeBrowserPool({
  headless: HEADLESS,
});

// ============================================================================
// Page Fetch Worker
// ============================================================================

const pageFetchWorker = new Worker(
  QUEUE_NAMES.PAGE_FETCH,
  async (job: Job) => {
    const event = createJobLogger(
      { service: "scraper-worker", queue: QUEUE_NAMES.PAGE_FETCH },
      job
    );
    event.setOperation("page_fetch");
    event.addFields({ url: job.data.url, fetchMode: job.data.fetchMode, depth: job.data.depth });

    try {
      const browser = await getBrowser();
      await processPageFetch(job.data, browser);
      event.success();
    } catch (error) {
      // Handle fairness slot unavailable errors specially
      // Instead of counting this as a failure/retry, delay the job and try again
      if (isFairnessSlotError(error)) {
        // Don't log as error - this is expected behavior for fairness
        event.addFields({
          fairnessDelay: true,
          retryDelayMs: error.retryDelayMs,
          currentSlots: error.slotResult.currentSlots,
          maxAllowedSlots: error.slotResult.maxAllowedSlots,
          activeRunCount: error.slotResult.activeRunCount,
        });
        
        // Emit log before throwing (finally block won't run after DelayedError)
        if (shouldSample(event.getEvent(), samplingConfig)) {
          event.emit();
        }
        
        // Move job to delayed state - it will be retried after the delay
        // This doesn't count against the retry limit
        await job.moveToDelayed(Date.now() + error.retryDelayMs, job.token);
        
        // IMPORTANT: Throw DelayedError to tell BullMQ we already handled the job state
        // Without this, BullMQ would try to call moveToFinished which would fail
        // because moveToDelayed already released the lock
        throw new DelayedError();
      }
      
      if (error instanceof Error) {
        event.setError(error);
      } else {
        event.setError({ type: "UnknownError", message: String(error) });
      }
      throw error;
    } finally {
      if (shouldSample(event.getEvent(), samplingConfig)) {
        event.emit();
      }
    }
  },
  {
    connection,
    concurrency: DEFAULT_CONCURRENCY, // Use default initially, settings loaded async
  }
);

// ============================================================================
// Startup
// ============================================================================

// Start the worker and load settings
(async () => {
  try {
    // Load settings from API (will update fairness config and start periodic refresh)
    await initializeSettings();
    
    logger.info("Scraper Worker started successfully");
  } catch (error) {
    logger.error({ error }, "Failed to initialize settings, continuing with defaults");
  }
})();

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(): Promise<void> {
  logger.info("Shutting down...");

  // Stop settings refresh
  stopSettingsRefresh();

  // Close worker first (waits for active jobs to complete)
  await pageFetchWorker.close();

  // Then shutdown browser pool
  await shutdownBrowserPool();

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
