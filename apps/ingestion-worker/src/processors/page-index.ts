import { db } from "@grounded/db";
import {
  sourceRuns,
  sourceRunPages,
  sourceRunPageContents,
  kbChunks,
  sources,
} from "@grounded/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  addEnrichPageJob,
  incrementStageProgress,
  addStageTransitionJob,
} from "@grounded/queue";
import {
  CHUNK_SIZE_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  hashString,
  type PageIndexJob,
  SourceRunStage,
} from "@grounded/shared";
import { log } from "@grounded/logger";

/**
 * Processes a page indexing job in the INDEXING stage.
 * 
 * In the sequential stage architecture:
 * 1. Reads staged content from sourceRunPageContents
 * 2. Soft-deletes old chunks for the URL
 * 3. Chunks the content into kb_chunks
 * 4. Tracks stage progress via Redis-based counters
 * 5. Triggers stage transition to EMBEDDING when all pages are indexed
 * 
 * NOTE: No direct embed job queuing - stage-job-queuer handles that after transition.
 */
export async function processPageIndex(data: PageIndexJob): Promise<void> {
  const { tenantId, runId, pageId, contentId, requestId, traceId } = data;
  const resolvedTenantId = tenantId ?? null;

  log.info("ingestion-worker", "Indexing page", { pageId, contentId, requestId, traceId });

  try {
    // Get the staged content
    const content = await db.query.sourceRunPageContents.findFirst({
      where: eq(sourceRunPageContents.id, contentId),
    });

    if (!content) {
      log.warn("ingestion-worker", "Staged content not found, marking as failed", { contentId });
      
      // Track stage progress (failed)
      const stageProgress = await incrementStageProgress(runId, true);
      
      if (stageProgress.isComplete) {
        await addStageTransitionJob({
          tenantId: resolvedTenantId,
          runId,
          completedStage: SourceRunStage.INDEXING,
          requestId,
          traceId,
        });
      }
      return;
    }

    // Get the page record
    const page = await db.query.sourceRunPages.findFirst({
      where: eq(sourceRunPages.id, pageId),
    });

    if (!page) {
      log.warn("ingestion-worker", "Page not found, marking as failed", { pageId });
      
      // Track stage progress (failed)
      const stageProgress = await incrementStageProgress(runId, true);
      
      if (stageProgress.isComplete) {
        await addStageTransitionJob({
          tenantId: resolvedTenantId,
          runId,
          completedStage: SourceRunStage.INDEXING,
          requestId,
          traceId,
        });
      }
      return;
    }

    // Get the run to find source and KB
    const run = await db.query.sourceRuns.findFirst({
      where: eq(sourceRuns.id, runId),
    });

    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    // Get the source to find KB
    const source = await db.query.sources.findFirst({
      where: eq(sources.id, run.sourceId),
    });

    if (!source) {
      throw new Error(`Source ${run.sourceId} not found`);
    }

    const kbId = source.kbId;

    // Update page stage to "index"
    await db
      .update(sourceRunPages)
      .set({ currentStage: "index" })
      .where(eq(sourceRunPages.id, pageId));

    // Soft-delete old chunks for this URL (if any exist from previous runs)
    await db
      .update(kbChunks)
      .set({ deletedAt: new Date() })
      .where(
        and(
          resolvedTenantId === null
            ? isNull(kbChunks.tenantId)
            : eq(kbChunks.tenantId, resolvedTenantId),
          eq(kbChunks.kbId, kbId),
          eq(kbChunks.normalizedUrl, content.normalizedUrl),
          isNull(kbChunks.deletedAt)
        )
      );

    // Parse headings from stored JSON
    const headings = (content.headings || []) as Array<{
      level: number;
      text: string;
      path: string;
      position: number;
    }>;

    // Chunk the content
    const chunks = chunkText(content.content, CHUNK_SIZE_TOKENS, CHUNK_OVERLAP_TOKENS);

    if (chunks.length === 0) {
      log.debug("ingestion-worker", "No chunks generated for page", { pageId, url: content.normalizedUrl });
      
      // Update page stage to complete
      await db
        .update(sourceRunPages)
        .set({ currentStage: "embed" })
        .where(eq(sourceRunPages.id, pageId));
      
      // Track stage progress (success with 0 chunks)
      const stageProgress = await incrementStageProgress(runId, false);
      
      if (stageProgress.isComplete) {
        await addStageTransitionJob({
          tenantId: resolvedTenantId,
          runId,
          completedStage: SourceRunStage.INDEXING,
          requestId,
          traceId,
        });
      }
      return;
    }

    // Insert chunks
    const chunkRecords = await Promise.all(
      chunks.map(async (chunkContent, index) => {
        const headingInfo = findHeadingForChunk(chunkContent, headings, index, chunks.length);
        const chunkHash = await hashString(chunkContent);
        return {
          tenantId: resolvedTenantId,
          kbId,
          sourceId: source.id,
          sourceRunId: runId,
          normalizedUrl: content.normalizedUrl,
          title: content.title,
          heading: headingInfo?.text || null,
          sectionPath: headingInfo?.path || null,
          content: chunkContent,
          contentHash: chunkHash,
          chunkIndex: index,
        };
      })
    );

    const insertedChunks = await db
      .insert(kbChunks)
      .values(chunkRecords)
      .returning({ id: kbChunks.id });

    const chunkIds = insertedChunks.map((c) => c.id);

    log.info("ingestion-worker", "Created chunks for page", {
      pageId,
      chunkCount: chunkIds.length,
      url: content.normalizedUrl,
    });

    // Update run: set stage and increment chunksToEmbed counter
    await db
      .update(sourceRuns)
      .set({
        stage: "indexing",
        chunksToEmbed: sql`${sourceRuns.chunksToEmbed} + ${chunkIds.length}`,
      })
      .where(eq(sourceRuns.id, runId));

    // Update page stage to "embed" (ready for embedding)
    await db
      .update(sourceRunPages)
      .set({ currentStage: "embed" })
      .where(eq(sourceRunPages.id, pageId));

    // Queue enrichment if enabled (enrichment can run in parallel with embedding)
    if (source.enrichmentEnabled) {
      await addEnrichPageJob({
        tenantId: resolvedTenantId,
        kbId,
        chunkIds,
        requestId,
        traceId,
      });
    }

    log.info("ingestion-worker", "Page indexed successfully", {
      pageId,
      contentId,
      chunkCount: chunkIds.length,
    });

    // Clean up staged content (no longer needed)
    await db
      .delete(sourceRunPageContents)
      .where(eq(sourceRunPageContents.id, contentId));

    // Track stage progress (success)
    const stageProgress = await incrementStageProgress(runId, false);
    log.info("ingestion-worker", "Stage progress after indexed page", { 
      runId, 
      completed: stageProgress.completed, 
      failed: stageProgress.failed,
      total: stageProgress.total,
      isComplete: stageProgress.isComplete,
    });

    // If stage is complete, trigger transition to EMBEDDING
    if (stageProgress.isComplete) {
      log.info("ingestion-worker", "INDEXING stage complete, triggering transition to EMBEDDING", { runId });
      await addStageTransitionJob({
        tenantId: resolvedTenantId,
        runId,
        completedStage: SourceRunStage.INDEXING,
        requestId,
        traceId,
      });
    }

  } catch (error) {
    log.error("ingestion-worker", "Error indexing page", { 
      pageId, 
      error: error instanceof Error ? error.message : String(error) 
    });

    // Update page with error
    await db
      .update(sourceRunPages)
      .set({ 
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      })
      .where(eq(sourceRunPages.id, pageId));

    // Track stage progress (failed)
    const stageProgress = await incrementStageProgress(runId, true);

    // If stage is complete, trigger transition to EMBEDDING
    if (stageProgress.isComplete) {
      await addStageTransitionJob({
        tenantId: resolvedTenantId,
        runId,
        completedStage: SourceRunStage.INDEXING,
        requestId,
        traceId,
      });
    }

    // Re-throw to let BullMQ handle retries
    throw error;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find the most relevant heading for a chunk based on position
 */
function findHeadingForChunk(
  chunk: string,
  headings: Array<{ level: number; text: string; path: string; position: number }>,
  chunkIndex: number,
  totalChunks: number
): { level: number; text: string; path: string; position: number } | null {
  if (headings.length === 0) return null;

  // Estimate chunk position in original text
  // This is approximate since we don't track exact positions
  const chunkProgress = chunkIndex / totalChunks;

  // Find the last heading that would appear before this chunk's content
  let bestHeading = headings[0];
  const estimatedPosition = Math.floor(chunkProgress * (headings[headings.length - 1]?.position || 0));

  for (const heading of headings) {
    if (heading.position <= estimatedPosition) {
      bestHeading = heading;
    } else {
      break;
    }
  }

  return bestHeading;
}

/**
 * Chunk text into overlapping segments
 */
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
