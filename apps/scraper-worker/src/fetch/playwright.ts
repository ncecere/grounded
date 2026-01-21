import type { Browser } from "playwright";
import { log } from "@grounded/logger";
import {
  SCRAPE_TIMEOUT_MS,
  isPlaywrightDownloadsDisabled,
  shouldLogBlockedDownloads,
  createBlockedDownloadInfo,
} from "@grounded/shared";

export async function fetchWithPlaywright(
  url: string,
  browser: Browser
): Promise<{ html: string; title: string | null }> {
  // Determine download configuration
  const downloadsDisabled = isPlaywrightDownloadsDisabled();
  const logBlockedDownloads = shouldLogBlockedDownloads();

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
    // Disable downloads during crawl to prevent disk consumption and slow page loading
    acceptDownloads: !downloadsDisabled,
  });

  const page = await context.newPage();

  // Set up download event handler for logging blocked downloads
  if (downloadsDisabled && logBlockedDownloads) {
    page.on("download", async (download) => {
      const downloadInfo = createBlockedDownloadInfo(
        url,
        download.url(),
        download.suggestedFilename()
      );
      log.info("scraper-worker", "Blocked download during crawl", {
        ...downloadInfo,
        reason: "downloads_disabled",
      });
      // Cancel the download
      await download.cancel();
    });
  }

  try {
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: SCRAPE_TIMEOUT_MS,
    });

    // Wait for any dynamic content
    await page.waitForTimeout(1000);

    const html = await page.content();
    const title = await page.title();

    return { html, title: title || null };
  } finally {
    await page.close();
    await context.close();
  }
}
