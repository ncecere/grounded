/**
 * Embed Chunks Processor
 * 
 * Generates vector embeddings for chunks and stores them in pgvector.
 * 
 * In the sequential stage architecture:
 * 1. Processes batches of chunks from the EMBEDDING stage
 * 2. Tracks stage progress via Redis-based incrementStageProgress
 * 3. Triggers stage transition to COMPLETED when all chunks are embedded
 * 
 * NOTE: This processor handles batches of chunks (not individual chunks).
 * Stage progress is tracked per-batch, not per-chunk.
 */

import { db } from "@grounded/db";
import { kbChunks, knowledgeBases, sourceRuns } from "@grounded/db/schema";
import { eq, inArray, isNull, and, sql } from "drizzle-orm";
import { generateEmbeddings } from "@grounded/embeddings";
import { getAIRegistry } from "@grounded/ai-providers";
import { getVectorStore } from "@grounded/vector-store";
import { log } from "@grounded/logger";
import { SourceRunStage, type EmbedChunksBatchJob } from "@grounded/shared";
import {
  markChunksEmbedInProgress,
  markChunksEmbedSucceeded,
  markChunksEmbedFailed,
  incrementStageProgress,
  addStageTransitionJob,
} from "@grounded/queue";
import { isRunCanceled } from "../stage-manager";

// Note: This job handler was moved from processors/ to jobs/ as part of the
// ingestion worker modularization. The stage-manager import remains at the
// same level since stage-manager.ts is in the src/ directory.

export class EmbeddingDimensionMismatchError extends Error {
  constructor(expected: number, actual: number, kbId: string) {
    super(
      `Embedding dimension mismatch for KB ${kbId}: ` +
      `expected ${expected} dimensions but got ${actual}. ` +
      `The KB was created with a different embedding model. ` +
      `Either use the same model or re-create the KB with the new model.`
    );
    this.name = "EmbeddingDimensionMismatchError";
  }
}

export async function processEmbedChunks(data: EmbedChunksBatchJob): Promise<void> {
  const { tenantId, kbId, chunkIds, runId, requestId, traceId } = data;

  log.info("ingestion-worker", "Embedding chunks for KB", { 
    chunkCount: chunkIds.length, 
    kbId, 
    runId,
    requestId, 
    traceId 
  });

  // Check if run is canceled before processing
  if (runId && await isRunCanceled(runId)) {
    log.info("ingestion-worker", "Run canceled, skipping embed job", { runId, chunkCount: chunkIds.length });
    return;
  }

  // Mark chunks as in-progress if runId is provided
  if (runId) {
    await markChunksEmbedInProgress(runId, chunkIds);
  }

  let succeeded = false;

  try {
    // Get the KB to check its embedding dimensions
    const kb = await db.query.knowledgeBases.findFirst({
      where: eq(knowledgeBases.id, kbId),
    });

    if (!kb) {
      if (runId) {
        await markChunksEmbedFailed(
          runId,
          chunkIds,
          `Knowledge base ${kbId} not found`,
          "NOT_FOUND_KB",
          false
        );
      }
      throw new Error(`Knowledge base ${kbId} not found`);
    }

    const expectedDimensions = kb.embeddingDimensions;
    log.debug("ingestion-worker", "KB expects dimensional embeddings", { kbId, expectedDimensions });

    // Get chunks
    const chunks = await db.query.kbChunks.findMany({
      where: and(
        inArray(kbChunks.id, chunkIds),
        isNull(kbChunks.deletedAt)
      ),
    });

    if (chunks.length === 0) {
      log.debug("ingestion-worker", "No chunks found to embed");
      if (runId) {
        await markChunksEmbedFailed(
          runId,
          chunkIds,
          "Chunks not found in database",
          "NOT_FOUND_CHUNKS",
          false
        );
      }
      // Still need to track progress for this batch (failed)
      succeeded = false;
      return;
    }

    // Get the current default embedding model for tracking
    const registry = getAIRegistry();
    const defaultModel = await registry.getDefaultModel("embedding");

    // Warn if the current model dimensions don't match KB dimensions
    if (defaultModel && defaultModel.dimensions !== expectedDimensions) {
      log.warn("ingestion-worker", "Embedding model dimension mismatch", {
        currentModelId: defaultModel.modelId,
        currentDimensions: defaultModel.dimensions,
        kbId,
        expectedDimensions,
      });
    }

    // Generate embeddings
    const texts = chunks.map((c) => c.content);
    const embeddingResults = await generateEmbeddings(
      texts,
      kb.embeddingModelId || undefined
    );

    // Validate embedding dimensions
    if (embeddingResults.length > 0) {
      const actualDimensions = embeddingResults[0].embedding.length;
      if (actualDimensions !== expectedDimensions) {
        const error = new EmbeddingDimensionMismatchError(expectedDimensions, actualDimensions, kbId);
        if (runId) {
          await markChunksEmbedFailed(
            runId,
            chunkIds,
            error.message,
            "CONFIG_EMBEDDING_DIMENSION_MISMATCH",
            false
          );
        }
        throw error;
      }
    }

    // Get the vector store
    const vectorStore = getVectorStore();
    if (!vectorStore) {
      if (runId) {
        await markChunksEmbedFailed(
          runId,
          chunkIds,
          "Vector store not configured",
          "CONFIG_VECTOR_STORE_MISSING",
          false
        );
      }
      throw new Error("Vector store not configured. Set VECTOR_DB_URL or VECTOR_DB_HOST environment variables.");
    }

    // Build vector records
    const vectorRecords = chunks.map((chunk, index) => ({
      id: chunk.id,
      tenantId,
      kbId,
      sourceId: chunk.sourceId,
      embedding: embeddingResults[index].embedding,
    }));

    // Upsert vectors to the vector store
    await vectorStore.upsert(vectorRecords);

    // Mark chunks as successfully embedded
    const successfulChunkIds = chunks.map((c) => c.id);
    if (runId) {
      await markChunksEmbedSucceeded(runId, successfulChunkIds, expectedDimensions);
    }

    // Update chunks_embedded counter
    if (runId) {
      await db
        .update(sourceRuns)
        .set({
          chunksEmbedded: sql`${sourceRuns.chunksEmbedded} + ${chunks.length}`,
        })
        .where(eq(sourceRuns.id, runId));
    }

    succeeded = true;
    log.info("ingestion-worker", "Embedded chunks for KB", { 
      chunkCount: chunks.length, 
      dimensions: expectedDimensions, 
      kbId 
    });

  } catch (error) {
    // Mark as retryable error if not already marked
    if (runId && !(error instanceof EmbeddingDimensionMismatchError)) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRetryable = !errorMessage.includes("not found") && !errorMessage.includes("not configured");

      if (isRetryable) {
        await markChunksEmbedFailed(
          runId,
          chunkIds,
          errorMessage,
          "EMBED_ERROR",
          true
        );
      }
    }
    throw error;

  } finally {
    // Track stage progress for this batch
    // NOTE: Each embed job represents a batch, not individual chunks
    // Stage progress is initialized with the number of embed JOBS (batches), not chunks
    if (runId) {
      const stageProgress = await incrementStageProgress(runId, !succeeded);
      log.info("ingestion-worker", "Stage progress after embed batch", { 
        runId, 
        completed: stageProgress.completed, 
        failed: stageProgress.failed,
        total: stageProgress.total,
        isComplete: stageProgress.isComplete,
        batchSucceeded: succeeded,
      });

      // If stage is complete, trigger transition to COMPLETED (finalization)
      if (stageProgress.isComplete) {
        log.info("ingestion-worker", "EMBEDDING stage complete, triggering transition to COMPLETED", { runId });
        await addStageTransitionJob({
          tenantId: tenantId,
          runId,
          completedStage: SourceRunStage.EMBEDDING,
          requestId,
          traceId,
        });
      }
    }
  }
}
