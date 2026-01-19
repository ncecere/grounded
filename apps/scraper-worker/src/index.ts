import { Worker, Job, connection, QUEUE_NAMES, isFairnessSlotError, getFairnessConfig, updateFairnessConfigFromSettings, DelayedError } from "@grounded/queue";
import { getEnvNumber, getEnvBool, initSettingsClient, type WorkerSettings } from "@grounded/shared";
import { createWorkerLogger, createJobLogger } from "@grounded/logger/worker";
import { shouldSample, createSamplingConfig } from "@grounded/logger";
import { chromium, Browser } from "playwright";
import { processPageFetch } from "./processors/page-fetch";

const logger = createWorkerLogger("scraper-worker");

// Default concurrency from environment (used as fallback)
const DEFAULT_CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);
const HEADLESS = getEnvBool("PLAYWRIGHT_HEADLESS", true);

// Current concurrency (may be updated from API settings)
let currentConcurrency = DEFAULT_CONCURRENCY;

// Initialize fairness config with default worker concurrency
// This will be updated when we fetch settings from API
getFairnessConfig(DEFAULT_CONCURRENCY);

// Initialize settings client with callback to update fairness config
const settingsClient = initSettingsClient({
  onSettingsUpdate: (settings: WorkerSettings) => {
    logger.info({ 
      fairness: settings.fairness,
      scraperConcurrency: settings.scraper.concurrency,
    }, "Settings updated from API");
    
    // Update fairness scheduler config
    updateFairnessConfigFromSettings(settings.fairness);
    
    // Track concurrency changes (worker restart required to apply)
    if (settings.scraper.concurrency !== currentConcurrency) {
      logger.warn({
        oldConcurrency: currentConcurrency,
        newConcurrency: settings.scraper.concurrency,
      }, "Scraper concurrency changed in settings - restart worker to apply");
    }
  },
});

// Sampling config from environment variables with worker-specific defaults
// Workers log 100% by default (can reduce with LOG_SAMPLE_RATE env var)
const samplingConfig = createSamplingConfig({
  baseSampleRate: 1.0,  // Log all jobs by default
  slowRequestThresholdMs: 30000, // 30s is slow for a job
});

// Fetch settings from API at startup
async function initializeSettings(): Promise<void> {
  try {
    const settings = await settingsClient.fetchSettings();
    logger.info({ 
      fairness: settings.fairness,
      scraperConcurrency: settings.scraper.concurrency,
    }, "Loaded settings from API");
    
    // Update fairness config with API settings
    updateFairnessConfigFromSettings(settings.fairness);
    
    // Use concurrency from API settings
    currentConcurrency = settings.scraper.concurrency;
  } catch (error) {
    logger.warn({ error }, "Failed to load settings from API, using environment defaults");
  }
}

logger.info({ concurrency: DEFAULT_CONCURRENCY, headless: HEADLESS }, "Starting Scraper Worker...");

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
    concurrency: DEFAULT_CONCURRENCY, // Use default initially, settings loaded async
  }
);

// ============================================================================
// Startup
// ============================================================================

// Start the worker and load settings
(async () => {
  try {
    // Load settings from API (will update fairness config)
    await initializeSettings();
    
    // Start periodic settings refresh (every minute by default)
    settingsClient.startPeriodicRefresh();
    
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
  settingsClient.stopPeriodicRefresh();

  await pageFetchWorker.close();

  if (browser) {
    await browser.close();
    browser = null;
  }

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
