import { db } from "@grounded/db";
import { kbChunks, knowledgeBases, sourceRuns } from "@grounded/db/schema";
import { eq, inArray, isNull, and, sql } from "drizzle-orm";
import { generateEmbeddings } from "@grounded/embeddings";
import { getAIRegistry } from "@grounded/ai-providers";
import { getVectorStore } from "@grounded/vector-store";
import { log } from "@grounded/logger";
import type { EmbedChunksBatchJob } from "@grounded/shared";
import {
  markChunksEmbedInProgress,
  markChunksEmbedSucceeded,
  markChunksEmbedFailed,
} from "@grounded/queue";

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

  log.info("ingestion-worker", "Embedding chunks for KB", { chunkCount: chunkIds.length, kbId, requestId, traceId });

  // Mark chunks as in-progress if runId is provided (for per-chunk tracking)
  if (runId) {
    await markChunksEmbedInProgress(runId, chunkIds);
  }

  try {
    // Get the KB to check its embedding dimensions
    const kb = await db.query.knowledgeBases.findFirst({
      where: eq(knowledgeBases.id, kbId),
    });

    if (!kb) {
      // Mark all chunks as permanently failed - KB not found is non-retryable
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
      // Mark missing chunks as permanently failed
      if (runId) {
        await markChunksEmbedFailed(
          runId,
          chunkIds,
          "Chunks not found in database",
          "NOT_FOUND_CHUNKS",
          false
        );
      }
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

    // Generate embeddings using the KB's configured model if available
    const texts = chunks.map((c) => c.content);
    const embeddingResults = await generateEmbeddings(
      texts,
      kb.embeddingModelId || undefined // Use KB's model if set
    );

    // Validate embedding dimensions
    if (embeddingResults.length > 0) {
      const actualDimensions = embeddingResults[0].embedding.length;
      if (actualDimensions !== expectedDimensions) {
        // Dimension mismatch is a permanent error - configuration issue
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
      // Vector store not configured is a permanent error
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

    // Build vector records for the vector store
    // Note: We use chunk.id as the vector id so we can look up chunk details from app DB
    const vectorRecords = chunks.map((chunk, index) => ({
      id: chunk.id,
      tenantId,
      kbId,
      sourceId: chunk.sourceId,
      embedding: embeddingResults[index].embedding,
    }));

    // Upsert vectors to the vector store (handles delete + insert atomically)
    await vectorStore.upsert(vectorRecords);

    // Mark chunks as successfully embedded
    const successfulChunkIds = chunks.map((c) => c.id);
    if (runId) {
      await markChunksEmbedSucceeded(runId, successfulChunkIds, expectedDimensions);
    }

    // Update chunks_embedded counter if runId is provided
    if (runId) {
      await db
        .update(sourceRuns)
        .set({
          chunksEmbedded: sql`${sourceRuns.chunksEmbedded} + ${chunks.length}`,
        })
        .where(eq(sourceRuns.id, runId));
    }

    log.info("ingestion-worker", "Embedded chunks for KB", { chunkCount: chunks.length, dimensions: expectedDimensions, kbId });
  } catch (error) {
    // If we haven't already marked the failure, mark it as retryable
    // (specific errors above are marked as non-retryable)
    if (runId && !(error instanceof EmbeddingDimensionMismatchError)) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRetryable = !errorMessage.includes("not found") && !errorMessage.includes("not configured");

      // Only mark as failed if it's a retryable error (non-retryable errors were already marked above)
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
  }
}
