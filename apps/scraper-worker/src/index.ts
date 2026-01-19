import { Worker, Job, connection, QUEUE_NAMES, isFairnessSlotError, getFairnessConfig, DelayedError } from "@grounded/queue";
import { getEnvNumber, getEnvBool } from "@grounded/shared";
import { createWorkerLogger, createJobLogger } from "@grounded/logger/worker";
import { shouldSample, createSamplingConfig } from "@grounded/logger";
import { chromium, Browser } from "playwright";
import { processPageFetch } from "./processors/page-fetch";

const logger = createWorkerLogger("scraper-worker");

const CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);
const HEADLESS = getEnvBool("PLAYWRIGHT_HEADLESS", true);

// Initialize fairness config with worker concurrency
// This ensures the fairness scheduler knows how many total slots are available
getFairnessConfig(CONCURRENCY);

// Sampling config from environment variables with worker-specific defaults
// Workers log 100% by default (can reduce with LOG_SAMPLE_RATE env var)
const samplingConfig = createSamplingConfig({
  baseSampleRate: 1.0,  // Log all jobs by default
  slowRequestThresholdMs: 30000, // 30s is slow for a job
});

logger.info({ concurrency: CONCURRENCY, headless: HEADLESS }, "Starting Scraper Worker...");

// ============================================================================
// Browser Pool
// ============================================================================

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    logger.info("Launching browser...");
    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--no-sandbox",
      ],
    });
    logger.info("Browser launched");
  }
  return browser;
}

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
    concurrency: CONCURRENCY,
  }
);

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(): Promise<void> {
  logger.info("Shutting down...");

  await pageFetchWorker.close();

  if (browser) {
    await browser.close();
    browser = null;
  }

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info("Scraper Worker started successfully");
