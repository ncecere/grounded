/**
 * Stage Job Queuer - Queues jobs for each stage of the ingestion pipeline
 * 
 * This module handles the job queuing logic for the sequential stage architecture.
 * Jobs are queued in batches and with priority based on run size.
 * 
 * Key responsibilities:
 * - SCRAPING: Queue page-fetch jobs for URLs in crawl state
 * - PROCESSING: Queue page-process jobs for URLs with fetched HTML in Redis
 * - INDEXING: Queue page-index jobs for pages ready for indexing
 * - EMBEDDING: Queue embed jobs for chunks, tracking job count (not chunk count)
 */

import { db } from "@grounded/db";
import { sourceRuns, sourceRunPages, sourceRunPageContents, kbChunks, sources } from "@grounded/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { log } from "@grounded/logger";
import { SourceRunStage, type FetchMode } from "@grounded/shared";
import {
  addPageFetchJob,
  addPageProcessJob,
  addPageIndexJob,
  addEmbedChunksBatchJob,
  redis,
  getFetchedHtmlUrls,
  getFetchedHtml,
  initializeStageProgress,
  initializeChunkEmbedStatuses,
  registerRun,
} from "@grounded/queue";
import { createCrawlState } from "@grounded/crawl-state";
import { getStageManagerConfig, calculatePriority } from "./stage-manager";

// ============================================================================
// Configuration
// ============================================================================

const EMBED_BATCH_SIZE = 50; // Chunks per embed job

// ============================================================================
// Job Queuing for Each Stage
// ============================================================================

/**
 * Queue scraping jobs for a run's SCRAPING stage.
 * Gets URLs from crawl state (Redis) and queues fetch jobs.
 */
export async function queueScrapingJobs(
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  const config = getStageManagerConfig();
  
  // Get source for fetch mode config
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
  
  const sourceConfig = source.config as { firecrawlEnabled?: boolean };
  const fetchMode: FetchMode = sourceConfig.firecrawlEnabled ? "firecrawl" : "auto";
  
  // Get URLs from crawl state (Redis) that are queued but not yet fetched
  const crawlState = createCrawlState(redis, runId);
  const queuedUrls = await crawlState.getQueuedUrls();
  
  if (queuedUrls.length === 0) {
    log.info("ingestion-worker", "No URLs to fetch for scraping stage", { runId });
    return 0;
  }
  
  // Register run with fairness scheduler for fair slot distribution
  // This must be done BEFORE queuing jobs so the scheduler knows about this run
  await registerRun(runId);
  log.debug("ingestion-worker", "Registered run with fairness scheduler", { runId });
  
  // Initialize stage progress in Redis
  await initializeStageProgress(runId, queuedUrls.length);
  
  const priority = calculatePriority(queuedUrls.length);
  let queued = 0;
  
  // Queue in batches
  for (let i = 0; i < queuedUrls.length; i += config.batchSize) {
    const batch = queuedUrls.slice(i, i + config.batchSize);
    
    for (const url of batch) {
      await addPageFetchJob({
        tenantId,
        runId,
        url,
        fetchMode,
        depth: 0,
        requestId,
        traceId,
      }, { priority });
      queued++;
    }
  }
  
  log.info("ingestion-worker", "Queued scraping jobs", { runId, queued, priority });
  return queued;
}

/**
 * Queue processing jobs for a run's PROCESSING stage.
 * Gets URLs with fetched HTML from Redis and queues processing jobs.
 */
export async function queueProcessingJobs(
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  const config = getStageManagerConfig();
  
  // Get URLs that have fetched HTML staged in Redis
  const urlsWithHtml = await getFetchedHtmlUrls(runId);
  
  if (urlsWithHtml.length === 0) {
    log.info("ingestion-worker", "No pages to process for processing stage", { runId });
    return 0;
  }
  
  // Initialize stage progress in Redis
  await initializeStageProgress(runId, urlsWithHtml.length);
  
  const priority = calculatePriority(urlsWithHtml.length);
  let queued = 0;
  
  // Queue in batches
  for (let i = 0; i < urlsWithHtml.length; i += config.batchSize) {
    const batch = urlsWithHtml.slice(i, i + config.batchSize);
    
    for (const url of batch) {
      // Get the HTML data from Redis for the job
      // Note: page-process will also retrieve this, but we need title for the job
      const fetchedData = await getFetchedHtml(runId, url);
      
      if (!fetchedData) {
        log.warn("ingestion-worker", "Fetched HTML not found for URL, skipping", { url, runId });
        continue;
      }
      
      await addPageProcessJob({
        tenantId,
        runId,
        url,
        html: "", // HTML will be retrieved from Redis by page-process
        title: fetchedData.title,
        depth: 0,
        sourceType: "web",
        requestId,
        traceId,
      }, { priority });
      queued++;
    }
  }
  
  log.info("ingestion-worker", "Queued processing jobs", { runId, queued, priority });
  return queued;
}

/**
 * Queue indexing jobs for a run's INDEXING stage.
 * Gets pages that were successfully processed and queues them for chunking/indexing.
 */
export async function queueIndexingJobs(
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  const config = getStageManagerConfig();
  
  // Get pages that need indexing (processed but not yet indexed)
  // Pages with currentStage = "extract" and status = "succeeded" are ready
  const pagesToIndex = await db.query.sourceRunPages.findMany({
    where: and(
      eq(sourceRunPages.sourceRunId, runId),
      eq(sourceRunPages.currentStage, "extract"),
      eq(sourceRunPages.status, "succeeded")
    ),
    columns: { id: true },
  });
  
  if (pagesToIndex.length === 0) {
    log.info("ingestion-worker", "No pages to index for indexing stage", { runId });
    return 0;
  }
  
  // Initialize stage progress in Redis
  await initializeStageProgress(runId, pagesToIndex.length);
  
  const priority = calculatePriority(pagesToIndex.length);
  let queued = 0;
  
  // Process in batches
  for (let i = 0; i < pagesToIndex.length; i += config.batchSize) {
    const batch = pagesToIndex.slice(i, i + config.batchSize);
    const pageIds = batch.map(p => p.id);
    
    // Get staged content for these pages
    const contents = await db.query.sourceRunPageContents.findMany({
      where: inArray(sourceRunPageContents.sourceRunPageId, pageIds),
    });
    
    for (const content of contents) {
      await addPageIndexJob({
        tenantId,
        runId,
        pageId: content.sourceRunPageId,
        contentId: content.id,
        sourceType: "web",
        requestId,
        traceId,
      }, { priority });
      queued++;
    }
  }
  
  log.info("ingestion-worker", "Queued indexing jobs", { runId, queued, priority });
  return queued;
}

/**
 * Queue embedding jobs for a run's EMBEDDING stage.
 * Gets chunks that need embedding and queues them in batches.
 * 
 * IMPORTANT: Stage progress is tracked by number of JOBS (batches), not chunks.
 * This ensures proper stage completion when all embed jobs finish.
 */
export async function queueEmbeddingJobs(
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  const config = getStageManagerConfig();
  
  // Get run to find KB
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
  
  const kbId = source.kbId;
  
  // Get all chunks that need embedding for this run
  const chunks = await db.query.kbChunks.findMany({
    where: and(
      eq(kbChunks.sourceRunId, runId),
      isNull(kbChunks.deletedAt)
    ),
    columns: { id: true },
  });
  
  if (chunks.length === 0) {
    log.info("ingestion-worker", "No chunks to embed for embedding stage", { runId });
    return 0;
  }
  
  const chunkIds = chunks.map(c => c.id);
  
  // Calculate number of embed jobs (batches)
  const numJobs = Math.ceil(chunkIds.length / EMBED_BATCH_SIZE);
  
  // Initialize stage progress in Redis with number of JOBS, not chunks
  await initializeStageProgress(runId, numJobs);
  
  // Initialize chunk embed status tracking
  await initializeChunkEmbedStatuses(runId, kbId, chunkIds);
  
  const priority = calculatePriority(chunkIds.length);
  let queued = 0;
  
  // Queue in batches of EMBED_BATCH_SIZE
  for (let i = 0; i < chunkIds.length; i += EMBED_BATCH_SIZE) {
    const batchChunkIds = chunkIds.slice(i, i + EMBED_BATCH_SIZE);
    
    await addEmbedChunksBatchJob({
      tenantId,
      kbId,
      chunkIds: batchChunkIds,
      runId,
      requestId,
      traceId,
    }, { priority });
    queued++;
  }
  
  log.info("ingestion-worker", "Queued embedding jobs", { 
    runId, 
    queued, // Number of jobs
    totalChunks: chunkIds.length,
    priority,
  });
  return queued;
}

/**
 * Queue jobs for a given stage.
 * Returns the number of jobs queued.
 */
export async function queueJobsForStage(
  stage: SourceRunStage,
  runId: string,
  tenantId: string | null,
  requestId?: string,
  traceId?: string
): Promise<number> {
  switch (stage) {
    case SourceRunStage.SCRAPING:
      return queueScrapingJobs(runId, tenantId, requestId, traceId);
    case SourceRunStage.PROCESSING:
      return queueProcessingJobs(runId, tenantId, requestId, traceId);
    case SourceRunStage.INDEXING:
      return queueIndexingJobs(runId, tenantId, requestId, traceId);
    case SourceRunStage.EMBEDDING:
      return queueEmbeddingJobs(runId, tenantId, requestId, traceId);
    default:
      log.warn("ingestion-worker", "No job queuing logic for stage", { stage, runId });
      return 0;
  }
}
