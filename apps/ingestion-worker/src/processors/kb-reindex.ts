import { db } from "@grounded/db";
import { kbChunks, knowledgeBases } from "@grounded/db/schema";
import { eq, isNull, and, count } from "drizzle-orm";
import { generateEmbeddings } from "@grounded/embeddings";
import { getVectorStore } from "@grounded/vector-store";
import { log } from "@grounded/logger";
import type { KbReindexJob } from "@grounded/shared";

const BATCH_SIZE = 50; // Process chunks in batches

export async function processKbReindex(data: KbReindexJob): Promise<void> {
  const { kbId, newEmbeddingModelId, newEmbeddingDimensions, requestId, traceId } = data;

  log.info("ingestion-worker", "Starting KB reindex", { kbId, newEmbeddingModelId, newEmbeddingDimensions, requestId, traceId });

  try {
    // Update status to in_progress
    await db
      .update(knowledgeBases)
      .set({ reindexStatus: "in_progress", reindexProgress: 0 })
      .where(eq(knowledgeBases.id, kbId));

    // Get total chunk count
    const [{ totalChunks }] = await db
      .select({ totalChunks: count() })
      .from(kbChunks)
      .where(and(eq(kbChunks.kbId, kbId), isNull(kbChunks.deletedAt)));

    if (totalChunks === 0) {
      log.info("ingestion-worker", "No chunks to reindex for KB", { kbId });
      await completeReindex(kbId, newEmbeddingModelId, newEmbeddingDimensions);
      return;
    }

    log.info("ingestion-worker", "Found chunks to reindex", { totalChunks });

    // Get vector store
    const vectorStore = getVectorStore();
    if (!vectorStore) {
      throw new Error("Vector store not configured");
    }

    let processedChunks = 0;
    let offset = 0;

    // Process in batches
    while (true) {
      // Check if reindex was cancelled
      const kb = await db.query.knowledgeBases.findFirst({
        where: eq(knowledgeBases.id, kbId),
      });

      if (!kb || kb.reindexStatus !== "in_progress") {
        log.info("ingestion-worker", "Reindex cancelled for KB", { kbId });
        return;
      }

      // Fetch batch of chunks
      const chunks = await db.query.kbChunks.findMany({
        where: and(eq(kbChunks.kbId, kbId), isNull(kbChunks.deletedAt)),
        limit: BATCH_SIZE,
        offset,
        orderBy: (kbChunks, { asc }) => [asc(kbChunks.createdAt)],
      });

      if (chunks.length === 0) {
        break;
      }

      // Generate new embeddings with the new model
      const texts = chunks.map((c) => c.content);
      const embeddingResults = await generateEmbeddings(texts, newEmbeddingModelId);

      // Validate dimensions
      if (embeddingResults.length > 0 && embeddingResults[0].embedding.length !== newEmbeddingDimensions) {
        throw new Error(
          `Dimension mismatch: expected ${newEmbeddingDimensions}, got ${embeddingResults[0].embedding.length}`
        );
      }

      // Build vector records - these will overwrite existing vectors with same ID
      const vectorRecords = chunks.map((chunk, index) => ({
        id: chunk.id,
        tenantId: chunk.tenantId || "", // Use empty string for global KBs
        kbId,
        sourceId: chunk.sourceId,
        embedding: embeddingResults[index].embedding,
      }));

      // Upsert to vector store (overwrites existing vectors)
      await vectorStore.upsert(vectorRecords);

      processedChunks += chunks.length;
      offset += BATCH_SIZE;

      // Update progress
      const progress = Math.min(99, Math.floor((processedChunks / totalChunks) * 100));
      await db
        .update(knowledgeBases)
        .set({ reindexProgress: progress })
        .where(eq(knowledgeBases.id, kbId));

      log.debug("ingestion-worker", "KB reindex progress", { kbId, processedChunks, totalChunks, progress });
    }

    // Complete the reindex
    await completeReindex(kbId, newEmbeddingModelId, newEmbeddingDimensions);
    log.info("ingestion-worker", "Completed reindex for KB", { kbId });
  } catch (error) {
    log.error("ingestion-worker", "Reindex failed for KB", { kbId, error: error instanceof Error ? error.message : String(error) });

    // Update KB with error status
    await db
      .update(knowledgeBases)
      .set({
        reindexStatus: "failed",
        reindexError: error instanceof Error ? error.message : "Unknown error",
      })
      .where(eq(knowledgeBases.id, kbId));

    throw error;
  }
}

async function completeReindex(
  kbId: string,
  newEmbeddingModelId: string,
  newEmbeddingDimensions: number
): Promise<void> {
  // Atomically update the KB to use the new model and clear reindex state
  await db
    .update(knowledgeBases)
    .set({
      // Switch to the new model
      embeddingModelId: newEmbeddingModelId,
      embeddingDimensions: newEmbeddingDimensions,
      // Clear reindex state
      reindexStatus: null,
      reindexProgress: null,
      reindexError: null,
      pendingEmbeddingModelId: null,
      pendingEmbeddingDimensions: null,
      reindexStartedAt: null,
    })
    .where(eq(knowledgeBases.id, kbId));
}
