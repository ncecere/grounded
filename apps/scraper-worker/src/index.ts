import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { getEnvNumber, getEnvBool } from "@grounded/shared";
import { chromium, Browser } from "playwright";
import { processPageFetch } from "./processors/page-fetch";

const CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);
const HEADLESS = getEnvBool("PLAYWRIGHT_HEADLESS", true);

console.log("Starting Scraper Worker...");
console.log(`Concurrency: ${CONCURRENCY}`);
console.log(`Headless: ${HEADLESS}`);

// ============================================================================
// Browser Pool
// ============================================================================

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    console.log("Launching browser...");
    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--no-sandbox",
      ],
    });
    console.log("Browser launched");
  }
  return browser;
}

// ============================================================================
// Page Fetch Worker
// ============================================================================

const pageFetchWorker = new Worker(
  QUEUE_NAMES.PAGE_FETCH,
  async (job: Job) => {
    console.log(`Fetching page ${job.id}: ${job.data.url}`);
    const browser = await getBrowser();
    return processPageFetch(job.data, browser);
  },
  {
    connection,
    concurrency: CONCURRENCY,
  }
);

pageFetchWorker.on("completed", (job) => {
  console.log(`Page fetch ${job.id} completed`);
});

pageFetchWorker.on("failed", (job, err) => {
  console.error(`Page fetch ${job?.id} failed:`, err);
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(): Promise<void> {
  console.log("Shutting down...");

  await pageFetchWorker.close();

  if (browser) {
    await browser.close();
    browser = null;
  }

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("Scraper Worker started successfully");
