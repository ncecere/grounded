import type { Browser } from "playwright";
import { db } from "@grounded/db";
import { sourceRuns, sourceRunPages, sources, tenantUsage } from "@grounded/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { addPageProcessJob, redis } from "@grounded/queue";
import { log } from "@grounded/logger";
import {
  normalizeUrl,
  getEnv,
  SCRAPE_TIMEOUT_MS,
  MAX_PAGE_SIZE_BYTES,
  type PageFetchJob,
  FetchMode,
  validateHtmlContentType,
  isContentTypeEnforcementEnabled,
  ContentError,
  ErrorCode,
} from "@grounded/shared";
import { createCrawlState } from "@grounded/crawl-state";

const FIRECRAWL_API_KEY = getEnv("FIRECRAWL_API_KEY", "");
const FIRECRAWL_API_URL = getEnv("FIRECRAWL_API_URL", "https://api.firecrawl.dev");

export async function processPageFetch(
  data: PageFetchJob,
  browser: Browser
): Promise<void> {
  const { tenantId, runId, url, fetchMode, depth = 0, requestId, traceId } = data;

  log.info("scraper-worker", "Fetching page", { url, fetchMode, depth, requestId, traceId });

  // Initialize CrawlState for this run
  const crawlState = createCrawlState(redis, runId);

  // Get run and source
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  // Check if run was canceled
  if (run.status === "canceled") {
    log.info("scraper-worker", "Run was canceled, skipping page fetch", { runId });
    return;
  }

  const source = await db.query.sources.findFirst({
    where: eq(sources.id, run.sourceId),
  });

  if (!source) {
    throw new Error(`Source ${run.sourceId} not found`);
  }

  let html: string;
  let title: string | null = null;

  try {
    // Try different fetch methods based on mode
    if (fetchMode === "firecrawl" || (fetchMode === "auto" && source.config.firecrawlEnabled)) {
      // Use Firecrawl
      const result = await fetchWithFirecrawl(url);
      html = result.html;
      title = result.title;
    } else if (fetchMode === "headless") {
      // Use Playwright directly
      const result = await fetchWithPlaywright(url, browser);
      html = result.html;
      title = result.title;
    } else {
      // Auto mode: try HTML first, fall back to Playwright
      try {
        const result = await fetchWithHttp(url);
        html = result.html;
        title = result.title;

        // Check if content looks like it needs JS rendering
        if (needsJsRendering(html)) {
          log.debug("scraper-worker", "Page needs JS rendering, using Playwright", { url });
          const playwrightResult = await fetchWithPlaywright(url, browser);
          html = playwrightResult.html;
          title = playwrightResult.title;
        }
      } catch (error) {
        // Fall back to Playwright
        log.debug("scraper-worker", "HTTP fetch failed, trying Playwright", { url, error: error instanceof Error ? error.message : String(error) });
        const result = await fetchWithPlaywright(url, browser);
        html = result.html;
        title = result.title;
      }
    }

    // Mark URL as fetched in Redis (atomic state transition)
    await crawlState.markFetched(url);

    // Update usage
    const currentMonth = new Date().toISOString().slice(0, 7);
    await db
      .update(tenantUsage)
      .set({
        scrapedPages: sql`${tenantUsage.scrapedPages} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenantUsage.tenantId, tenantId),
          eq(tenantUsage.month, currentMonth)
        )
      );

    // Queue page processing
    await addPageProcessJob({
      tenantId,
      runId,
      url,
      html,
      title,
      depth,
      requestId,
      traceId,
    });

    log.info("scraper-worker", "Page fetched successfully", { url });
  } catch (error) {
    log.error("scraper-worker", "Error fetching page", { url, error: error instanceof Error ? error.message : String(error) });

    // Mark as failed in Redis
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await crawlState.markFailed(url, errorMessage);

    // Record failure in PostgreSQL for history
    await db.insert(sourceRunPages).values({
      tenantId,
      sourceRunId: runId,
      url,
      normalizedUrl: normalizeUrl(url),
      title: null,
      status: "failed",
      error: errorMessage,
    });

    // Check if crawl is complete
    await checkAndFinalize(runId, tenantId, crawlState);
  }
}

async function fetchWithHttp(
  url: string
): Promise<{ html: string; title: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Grounded-Bot/1.0; +https://grounded.example.com/bot)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Validate content type (HTML allowlist enforcement)
    if (isContentTypeEnforcementEnabled()) {
      const contentType = response.headers.get("content-type");
      const validation = validateHtmlContentType(contentType);

      if (!validation.isValid) {
        log.info("scraper-worker", "Skipping non-HTML content", {
          url,
          contentType: validation.rawContentType,
          mimeType: validation.mimeType,
          category: validation.category,
          reason: validation.rejectionReason,
        });
        throw new ContentError(
          ErrorCode.CONTENT_UNSUPPORTED_TYPE,
          validation.rejectionReason || `Non-HTML content type: ${validation.mimeType}`,
          { metadata: { url, contentType: validation.rawContentType, mimeType: validation.mimeType } }
        );
      }

      // Log a warning for unknown/empty content types that we're allowing through
      if (validation.category === "unknown") {
        log.warn("scraper-worker", "Processing page with unknown content type", {
          url,
          contentType: validation.rawContentType,
        });
      }
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_PAGE_SIZE_BYTES) {
      throw new Error("Page too large");
    }

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;

    return { html, title };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithPlaywright(
  url: string,
  browser: Browser
): Promise<{ html: string; title: string | null }> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

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

async function fetchWithFirecrawl(
  url: string
): Promise<{ html: string; title: string | null }> {
  if (!FIRECRAWL_API_KEY) {
    throw new Error("Firecrawl API key not configured");
  }

  const response = await fetch(`${FIRECRAWL_API_URL}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
      waitFor: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firecrawl error: ${error}`);
  }

  const result = await response.json() as { data?: { html?: string; metadata?: { title?: string } } };

  return {
    html: result.data?.html || "",
    title: result.data?.metadata?.title || null,
  };
}

function needsJsRendering(html: string): boolean {
  // Heuristics to detect if page needs JS rendering
  const bodyContent = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
  const textContent = bodyContent.replace(/<[^>]+>/g, "").trim();

  // If body has very little text content, it might need JS
  if (textContent.length < 500) {
    return true;
  }

  // Check for common JS framework indicators
  const jsFrameworkIndicators = [
    "data-reactroot",
    "ng-app",
    "ng-controller",
    "__NEXT_DATA__",
    "__NUXT__",
    "id=\"app\"",
    "id=\"root\"",
  ];

  for (const indicator of jsFrameworkIndicators) {
    if (html.includes(indicator)) {
      // But only if there's not much visible content
      if (textContent.length < 1000) {
        return true;
      }
    }
  }

  return false;
}

async function checkAndFinalize(
  runId: string,
  tenantId: string,
  crawlState: ReturnType<typeof createCrawlState>
): Promise<void> {
  // Use Redis-based completion check
  const isComplete = await crawlState.isComplete();

  if (!isComplete) {
    // Log progress
    const progress = await crawlState.getProgress();
    log.debug("scraper-worker", "Run progress", {
      runId,
      completed: progress.processed + progress.failed,
      total: progress.total,
      percentComplete: progress.percentComplete,
      queued: progress.queued,
      fetching: progress.fetched,
    });
    return;
  }

  log.info("scraper-worker", "Crawl complete for run, will be finalized by page-process", { runId });
}
