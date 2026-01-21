import { db } from "@grounded/db";
import { sourceRuns, sourceRunPages, sources, sourceRunPageContents, kbChunks } from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  getFetchedHtml,
  deleteFetchedHtml,
  incrementStageProgress,
  addStageTransitionJob,
} from "@grounded/queue";
import {
  hashString,
  normalizeUrl,
  type PageProcessJob,
  SourceRunStage,
} from "@grounded/shared";
import { log } from "@grounded/logger";
import { extractContent } from "../services/extraction";

/**
 * Process a page in the PROCESSING stage.
 * 
 * In the sequential stage architecture:
 * 1. Gets HTML from Redis (staged by page-fetch) or from job data (uploads)
 * 2. Extracts content and creates page records
 * 3. Tracks stage progress via Redis-based counters
 * 4. Triggers stage transition to INDEXING when all pages are processed
 * 
 * NOTE: No direct job chaining - stage-job-queuer handles job creation for next stage.
 */
export async function processPageProcess(data: PageProcessJob): Promise<void> {
  const {
    tenantId,
    runId,
    url,
    html: jobHtml, // HTML may be in job data for uploads
    title: jobTitle,
    depth = 0,
    sourceType,
    uploadMetadata,
    requestId,
    traceId,
  } = data;
  const resolvedTenantId = tenantId ?? null;
  const normalizedUrl = normalizeUrl(url);

  log.info("ingestion-worker", "Processing page", { url, depth, sourceType, requestId, traceId });

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

  let html: string;
  let title: string | null;

  // Get HTML content - from Redis for web sources, from job data for uploads
  if (sourceType === "upload" || url.startsWith("upload://")) {
    // Uploads have HTML in the job data
    if (!jobHtml) {
      throw new Error(`Upload job missing HTML content for ${url}`);
    }
    html = jobHtml;
    title = jobTitle ?? uploadMetadata?.filename ?? null;
  } else {
    // Web sources have HTML staged in Redis by page-fetch
    const fetchedData = await getFetchedHtml(runId, url);
    if (!fetchedData) {
      // HTML not found in Redis - may have expired or never been stored
      log.error("ingestion-worker", "No fetched HTML found for URL", { url, runId });
      
      // Record as failed
      await recordPageFailure(resolvedTenantId, runId, url, normalizedUrl, "No fetched HTML found in Redis");
      
      // Track stage progress (failed)
      const stageProgress = await incrementStageProgress(runId, true);
      log.info("ingestion-worker", "Stage progress after failed page", { 
        runId, 
        completed: stageProgress.completed, 
        failed: stageProgress.failed,
        total: stageProgress.total,
        isComplete: stageProgress.isComplete,
      });

      // If stage is complete, trigger transition to INDEXING
      if (stageProgress.isComplete) {
        await addStageTransitionJob({
          tenantId: resolvedTenantId,
          runId,
          completedStage: SourceRunStage.PROCESSING,
          requestId,
          traceId,
        });
      }
      return;
    }
    html = fetchedData.html;
    title = fetchedData.title ?? jobTitle;
  }

  try {
    // Extract main content and structure
    const { mainContent, headings } = extractContent(html);
    const contentHash = await hashString(mainContent);

    // Check if content has changed (unless force reindex is enabled)
    if (!run.forceReindex) {
      const existingPage = await db.query.sourceRunPages.findFirst({
        where: and(
          resolvedTenantId === null
            ? isNull(sourceRunPages.tenantId)
            : eq(sourceRunPages.tenantId, resolvedTenantId),
          eq(sourceRunPages.normalizedUrl, normalizedUrl)
        ),
      });

      if (existingPage && existingPage.contentHash === contentHash) {
        // Content hash matches - but do chunks actually exist for this URL?
        const existingChunk = await db.query.kbChunks.findFirst({
          where: and(
            eq(kbChunks.sourceId, source.id),
            eq(kbChunks.normalizedUrl, normalizedUrl),
            isNull(kbChunks.deletedAt)
          ),
        });

        if (existingChunk) {
          // Content unchanged AND chunks exist - safe to skip
          await db.insert(sourceRunPages).values({
            tenantId: resolvedTenantId,
            sourceRunId: runId,
            url,
            normalizedUrl,
            title,
            contentHash,
            status: "skipped_unchanged",
            currentStage: "extract", // Marked as processed
          });

          log.debug("ingestion-worker", "Page unchanged with existing chunks, skipped", { url });
          
          // Clean up HTML from Redis (not needed anymore)
          if (sourceType !== "upload" && !url.startsWith("upload://")) {
            await deleteFetchedHtml(runId, url);
          }
          
          // Track stage progress (skipped pages count as completed)
          const stageProgress = await incrementStageProgress(runId, false);
          
          if (stageProgress.isComplete) {
            await addStageTransitionJob({
              tenantId: resolvedTenantId,
              runId,
              completedStage: SourceRunStage.PROCESSING,
              requestId,
              traceId,
            });
          }
          return;
        } else {
          // Content unchanged BUT no chunks exist - must reprocess
          log.info("ingestion-worker", "Page content unchanged but no chunks exist, reprocessing", { url, sourceId: source.id });
        }
      }
    } else {
      log.debug("ingestion-worker", "Force reindex enabled, processing page regardless of content hash", { url });
    }

    // Create page record
    const [page] = await db
      .insert(sourceRunPages)
      .values({
        tenantId: resolvedTenantId,
        sourceRunId: runId,
        url,
        normalizedUrl,
        title,
        httpStatus: 200,
        contentHash,
        status: "succeeded",
        currentStage: "extract", // Ready for indexing
      })
      .returning();

    // Store extracted content for indexing stage
    const [_content] = await db
      .insert(sourceRunPageContents)
      .values({
        tenantId: resolvedTenantId,
        sourceRunId: runId,
        sourceRunPageId: page.id,
        normalizedUrl,
        title,
        content: mainContent,
        contentHash,
        headings,
      })
      .returning();

    log.info("ingestion-worker", "Page processed and staged for indexing", { 
      url, 
      pageId: page.id,
      contentLength: mainContent.length,
    });

    // Clean up HTML from Redis (not needed anymore)
    if (sourceType !== "upload" && !url.startsWith("upload://")) {
      await deleteFetchedHtml(runId, url);
    }

    // Track stage progress (success)
    const stageProgress = await incrementStageProgress(runId, false);
    log.info("ingestion-worker", "Stage progress after processed page", { 
      runId, 
      completed: stageProgress.completed, 
      failed: stageProgress.failed,
      total: stageProgress.total,
      isComplete: stageProgress.isComplete,
    });

    // If stage is complete, trigger transition to INDEXING
    if (stageProgress.isComplete) {
      log.info("ingestion-worker", "PROCESSING stage complete, triggering transition to INDEXING", { runId });
      await addStageTransitionJob({
        tenantId: resolvedTenantId,
        runId,
        completedStage: SourceRunStage.PROCESSING,
        requestId,
        traceId,
      });
    }
  } catch (error) {
    log.error("ingestion-worker", "Error processing page", { 
      url, 
      error: error instanceof Error ? error.message : String(error) 
    });

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Record page failure
    await recordPageFailure(resolvedTenantId, runId, url, normalizedUrl, errorMessage, jobTitle);

    // Clean up HTML from Redis on failure too
    if (sourceType !== "upload" && !url.startsWith("upload://")) {
      await deleteFetchedHtml(runId, url);
    }

    // Track stage progress (failed)
    const stageProgress = await incrementStageProgress(runId, true);

    // If stage is complete, trigger transition to INDEXING
    if (stageProgress.isComplete) {
      await addStageTransitionJob({
        tenantId: resolvedTenantId,
        runId,
        completedStage: SourceRunStage.PROCESSING,
        requestId,
        traceId,
      });
    }
  }
}

/**
 * Record a page failure in the database.
 */
async function recordPageFailure(
  tenantId: string | null,
  runId: string,
  url: string,
  normalizedUrl: string,
  errorMessage: string,
  title?: string | null
): Promise<void> {
  await db.insert(sourceRunPages).values({
    tenantId,
    sourceRunId: runId,
    url,
    normalizedUrl,
    title: title ?? null,
    status: "failed",
    error: errorMessage,
    currentStage: "extract",
  });
}
