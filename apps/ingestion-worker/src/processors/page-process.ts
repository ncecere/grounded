import { db } from "@grounded/db";
import { kbChunks, sourceRuns, sourceRunPages, sources } from "@grounded/db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  addEmbedChunksBatchJob,
  addEnrichPageJob,
  addSourceRunFinalizeJob,
  addPageFetchJob,
  redis,
  waitForEmbedBackpressure,
  getEmbedBackpressureConfig,
} from "@grounded/queue";
import {
  hashString,
  normalizeUrl,
  CHUNK_SIZE_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  type PageProcessJob,
  type SourceConfig,
  type FetchMode,
} from "@grounded/shared";
import { log } from "@grounded/logger";
import { createCrawlState } from "@grounded/crawl-state";

export async function processPageProcess(data: PageProcessJob): Promise<void> {
  const { tenantId, runId, url, html, title, depth = 0, requestId, traceId } = data;

  log.info("ingestion-worker", "Processing page", { url, depth, requestId, traceId });

  // Initialize CrawlState for this run
  const crawlState = createCrawlState(redis, runId);

  // Get run and source
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  const source = await db.query.sources.findFirst({
    where: eq(sources.id, run.sourceId),
  });

  if (!source) {
    throw new Error(`Source ${run.sourceId} not found`);
  }

  const normalizedUrl = normalizeUrl(url);

  try {
    // Extract main content and structure
    const { mainContent, headings } = extractContent(html);
    const contentHash = await hashString(mainContent);

    // Check if content has changed (unless force reindex is enabled)
    if (!run.forceReindex) {
      const existingPage = await db.query.sourceRunPages.findFirst({
        where: and(
          eq(sourceRunPages.tenantId, tenantId),
          eq(sourceRunPages.normalizedUrl, normalizedUrl)
        ),
      });

      if (existingPage && existingPage.contentHash === contentHash) {
        // Content unchanged, skip
        await db.insert(sourceRunPages).values({
          tenantId,
          sourceRunId: runId,
          url,
          normalizedUrl,
          title,
          contentHash,
          status: "skipped_unchanged",
        });

        // Mark as processed in Redis
        await crawlState.markProcessed(url);

        log.debug("ingestion-worker", "Page unchanged, skipped", { url });
        await checkAndFinalize(runId, tenantId, crawlState);
        return;
      }
    } else {
      log.debug("ingestion-worker", "Force reindex enabled, processing page regardless of content hash", { url });
    }

    // Delete old chunks for this URL
    await db
      .update(kbChunks)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(kbChunks.tenantId, tenantId),
          eq(kbChunks.sourceId, source.id),
          eq(kbChunks.normalizedUrl, normalizedUrl)
        )
      );

    // Chunk the content
    const chunks = chunkText(mainContent, CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS);

    // Insert chunks
    const chunkIds: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const heading = findHeadingForChunk(chunk, headings);
      const chunkHash = await hashString(chunk);

      const [inserted] = await db
        .insert(kbChunks)
        .values({
          tenantId,
          kbId: source.kbId,
          sourceId: source.id,
          sourceRunId: runId,
          normalizedUrl,
          title,
          heading: heading?.text || null,
          sectionPath: heading?.path || null,
          chunkIndex: i,
          content: chunk,
          contentHash: chunkHash,
        })
        .returning();

      chunkIds.push(inserted.id);
    }

    // Record page success
    await db.insert(sourceRunPages).values({
      tenantId,
      sourceRunId: runId,
      url,
      normalizedUrl,
      title,
      httpStatus: 200,
      contentHash,
      status: "succeeded",
    });

    // Queue embedding job and track chunks to embed
    if (chunkIds.length > 0) {
      // Check for embed backpressure before queuing
      const backpressureConfig = getEmbedBackpressureConfig();
      if (!backpressureConfig.disabled) {
        const waitResult = await waitForEmbedBackpressure(async () => {
          // Get current embed lag from database (chunksToEmbed - chunksEmbedded)
          const currentRun = await db.query.sourceRuns.findFirst({
            where: eq(sourceRuns.id, runId),
            columns: { chunksToEmbed: true, chunksEmbedded: true },
          });
          const toEmbed = currentRun?.chunksToEmbed ?? 0;
          const embedded = currentRun?.chunksEmbedded ?? 0;
          return Math.max(0, toEmbed - embedded);
        });

        if (waitResult.waited) {
          log.info("ingestion-worker", "Embed backpressure wait completed", {
            url,
            waitCycles: waitResult.waitCycles,
            waitTimeMs: waitResult.waitTimeMs,
            timedOut: waitResult.timedOut,
            finalQueueDepth: waitResult.finalCheck.queueDepth,
            finalEmbedLag: waitResult.finalCheck.embedLag,
            requestId,
            traceId,
          });
        }
      }

      await addEmbedChunksBatchJob({
        tenantId,
        kbId: source.kbId,
        chunkIds,
        runId,
        requestId,
        traceId,
      });

      // Increment chunks_to_embed counter atomically
      await db
        .update(sourceRuns)
        .set({
          chunksToEmbed: sql`${sourceRuns.chunksToEmbed} + ${chunkIds.length}`,
        })
        .where(eq(sourceRuns.id, runId));
    }

    // Queue enrichment if enabled
    if (source.enrichmentEnabled) {
      await addEnrichPageJob({
        tenantId,
        kbId: source.kbId,
        chunkIds,
        requestId,
        traceId,
      });
    }

    log.info("ingestion-worker", "Page processed", { url, chunkCount: chunks.length });

    // For domain crawl mode, discover and queue new URLs atomically
    const config = source.config as SourceConfig;
    if (config.mode === "domain") {
      await discoverAndQueueLinks(tenantId, runId, url, html, depth, config, crawlState, requestId, traceId);
    }

    // Mark as processed in Redis
    await crawlState.markProcessed(url);

    // Check if all pages are done
    await checkAndFinalize(runId, tenantId, crawlState, requestId, traceId);
  } catch (error) {
    log.error("ingestion-worker", "Error processing page", { url, error: error instanceof Error ? error.message : String(error) });

    // Mark as failed in Redis
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await crawlState.markFailed(url, errorMessage);

    // Record page failure
    await db.insert(sourceRunPages).values({
      tenantId,
      sourceRunId: runId,
      url,
      normalizedUrl,
      title,
      status: "failed",
      error: errorMessage,
    });

    await checkAndFinalize(runId, tenantId, crawlState, requestId, traceId);
  }
}

interface Heading {
  level: number;
  text: string;
  position: number;
  path: string;
}

function extractContent(html: string): { mainContent: string; headings: Heading[] } {
  // Simple content extraction - in production use readability.js or similar

  // Remove scripts and styles
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

  // Extract headings
  const headings: Heading[] = [];
  const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
  let match;
  let position = 0;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = parseInt(match[1]);
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    if (text) {
      headings.push({
        level,
        text,
        position: match.index,
        path: buildHeadingPath(headings, level, text),
      });
    }
  }

  // Convert to text
  const mainContent = content
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { mainContent, headings };
}

function buildHeadingPath(
  existingHeadings: Heading[],
  level: number,
  text: string
): string {
  const pathParts: string[] = [];

  // Find parent headings
  for (let i = existingHeadings.length - 1; i >= 0; i--) {
    const h = existingHeadings[i];
    if (h.level < level) {
      pathParts.unshift(h.text);
      level = h.level;
    }
  }

  pathParts.push(text);
  return pathParts.join(" > ");
}

function findHeadingForChunk(
  chunk: string,
  headings: Heading[]
): Heading | null {
  // Simple heuristic: return the last heading that appears before this chunk's content
  // In reality, you'd track positions more carefully
  return headings.length > 0 ? headings[headings.length - 1] : null;
}

function chunkText(
  text: string,
  chunkSize: number,
  overlap: number
): string[] {
  // Simple character-based chunking with overlap
  // In production, use a proper tokenizer
  const charPerToken = 4; // Rough approximation
  const chunkChars = chunkSize * charPerToken;
  const overlapChars = overlap * charPerToken;

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkChars;

    // Try to break at sentence boundary
    if (end < text.length) {
      const searchStart = Math.max(start + chunkChars - 200, start);
      const searchEnd = Math.min(start + chunkChars + 200, text.length);
      const searchText = text.slice(searchStart, searchEnd);

      // Look for sentence endings
      const sentenceEnd = searchText.search(/[.!?]\s/);
      if (sentenceEnd > 0) {
        end = searchStart + sentenceEnd + 2;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    start = end - overlapChars;
  }

  return chunks;
}

/**
 * Extract links from HTML and queue new URLs for domain crawling.
 * Uses CrawlState for atomic URL deduplication - prevents race conditions.
 */
async function discoverAndQueueLinks(
  tenantId: string,
  runId: string,
  currentUrl: string,
  html: string,
  currentDepth: number,
  config: SourceConfig,
  crawlState: ReturnType<typeof createCrawlState>,
  requestId?: string,
  traceId?: string
): Promise<void> {
  const maxDepth = config.depth || 3;

  // Check if we've reached max depth
  if (currentDepth >= maxDepth) {
    log.debug("ingestion-worker", "Max depth reached, not discovering more links", { maxDepth, currentUrl });
    return;
  }

  // Extract all links from the page
  const links = extractLinks(html, currentUrl);

  if (links.length === 0) {
    return;
  }

  // Get the base domain from the starting URL
  const startingUrl = new URL(config.url!);
  const baseDomain = startingUrl.hostname;

  // Filter links to same domain only
  const sameDomainLinks = links.filter((link) => {
    try {
      const linkUrl = new URL(link);
      // Check if same domain (or subdomain if allowed)
      if (config.includeSubdomains) {
        return linkUrl.hostname === baseDomain || linkUrl.hostname.endsWith(`.${baseDomain}`);
      }
      return linkUrl.hostname === baseDomain;
    } catch {
      return false;
    }
  });

  // Apply include/exclude patterns
  const filteredLinks = sameDomainLinks.filter((link) => {
    try {
      const urlPath = new URL(link).pathname;

      // Check exclude patterns
      if (config.excludePatterns?.length) {
        for (const pattern of config.excludePatterns) {
          if (matchPattern(urlPath, pattern)) {
            return false;
          }
        }
      }

      // Check include patterns
      if (config.includePatterns?.length) {
        for (const pattern of config.includePatterns) {
          if (matchPattern(urlPath, pattern)) {
            return true;
          }
        }
        return false; // If include patterns exist, URL must match one
      }

      return true;
    } catch {
      return false;
    }
  });

  if (filteredLinks.length === 0) {
    log.debug("ingestion-worker", "No valid links found on page", { currentUrl });
    return;
  }

  // Queue URLs atomically using CrawlState
  // This is the KEY FIX: SADD is atomic, returns only truly new URLs
  const newUrls = await crawlState.queueUrls(filteredLinks);

  if (newUrls.length === 0) {
    log.debug("ingestion-worker", "All links from page already seen", { linkCount: filteredLinks.length, currentUrl });
    return;
  }

  log.info("ingestion-worker", "Discovered new URLs", { newUrlCount: newUrls.length, currentUrl, currentDepth });

  // Determine fetch mode
  const fetchMode: FetchMode = config.firecrawlEnabled ? "firecrawl" : "auto";

  // Queue new page fetch jobs
  for (const url of newUrls) {
    await addPageFetchJob({
      tenantId,
      runId,
      url,
      fetchMode,
      depth: currentDepth + 1,
      requestId,
      traceId,
    });
  }

  // Update PostgreSQL stats for UI display (non-critical, can be approximate)
  const progress = await crawlState.getProgress();
  await db
    .update(sourceRuns)
    .set({
      stats: sql`jsonb_set(COALESCE(stats, '{}'), '{pagesSeen}', ${progress.total}::text::jsonb)`,
    })
    .where(eq(sourceRuns.id, runId));

  log.info("ingestion-worker", "Queued new pages for crawling", { queuedCount: newUrls.length, depth: currentDepth + 1 });
}

/**
 * Extract all links from HTML
 */
function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["']/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];

    // Skip anchors, javascript, mailto, tel links
    if (
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("data:")
    ) {
      continue;
    }

    try {
      // Resolve relative URLs
      const absoluteUrl = new URL(href, baseUrl).href;
      // Remove hash/fragment
      const urlWithoutHash = absoluteUrl.split("#")[0];
      links.push(urlWithoutHash);
    } catch {
      // Invalid URL, skip
    }
  }

  return links;
}

/**
 * Match URL path against a glob pattern
 */
function matchPattern(path: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".") +
      "$"
  );
  return regex.test(path);
}

/**
 * Check if crawl is complete and trigger finalization.
 * Uses Redis-based completion check which is accurate regardless of race conditions.
 */
async function checkAndFinalize(
  runId: string,
  tenantId: string,
  crawlState: ReturnType<typeof createCrawlState>,
  requestId?: string,
  traceId?: string
): Promise<void> {
  // Get the run to check status
  const run = await db.query.sourceRuns.findFirst({
    where: eq(sourceRuns.id, runId),
  });

  if (!run) {
    log.error("ingestion-worker", "Run not found during finalization check", { runId });
    return;
  }

  // If already finished, skip
  if (run.finishedAt || run.status !== "running") {
    return;
  }

  // Use Redis-based completion check - this is accurate!
  const isComplete = await crawlState.isComplete();

  // Log progress
  const progress = await crawlState.getProgress();
  log.debug("ingestion-worker", "Run progress", {
    runId,
    completed: progress.processed + progress.failed,
    total: progress.total,
    percentComplete: progress.percentComplete,
    queued: progress.queued,
    fetching: progress.fetched,
  });

  if (!isComplete) {
    return;
  }

  // All URLs are in terminal state (processed or failed)
  log.info("ingestion-worker", "All pages complete for run, queueing finalize job", { runId });
  await addSourceRunFinalizeJob({ tenantId, runId, requestId, traceId });
}
