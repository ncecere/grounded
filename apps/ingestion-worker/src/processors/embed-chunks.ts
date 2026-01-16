import { db } from "@grounded/db";
import { kbChunks, knowledgeBases, sourceRuns } from "@grounded/db/schema";
import { eq, inArray, isNull, and, sql } from "drizzle-orm";
import { generateEmbeddings } from "@grounded/embeddings";
import { getAIRegistry } from "@grounded/ai-providers";
import { getVectorStore } from "@grounded/vector-store";
import type { EmbedChunksBatchJob } from "@grounded/shared";

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
  const { tenantId, kbId, chunkIds, runId } = data;

  console.log(`Embedding ${chunkIds.length} chunks for KB ${kbId}`);

  // Get the KB to check its embedding dimensions
  const kb = await db.query.knowledgeBases.findFirst({
    where: eq(knowledgeBases.id, kbId),
  });

  if (!kb) {
    throw new Error(`Knowledge base ${kbId} not found`);
  }

  const expectedDimensions = kb.embeddingDimensions;
  console.log(`KB ${kbId} expects ${expectedDimensions}-dimensional embeddings`);

  // Get chunks
  const chunks = await db.query.kbChunks.findMany({
    where: and(
      inArray(kbChunks.id, chunkIds),
      isNull(kbChunks.deletedAt)
    ),
  });

  if (chunks.length === 0) {
    console.log("No chunks found to embed");
    return;
  }

  // Get the current default embedding model for tracking
  const registry = getAIRegistry();
  const defaultModel = await registry.getDefaultModel("embedding");
  const modelId = defaultModel?.id || null;

  // Warn if the current model dimensions don't match KB dimensions
  if (defaultModel && defaultModel.dimensions !== expectedDimensions) {
    console.warn(
      `Warning: Current embedding model (${defaultModel.modelId}) has ${defaultModel.dimensions} dimensions, ` +
      `but KB ${kbId} was created with ${expectedDimensions} dimensions. ` +
      `Using KB's configured model if available.`
    );
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
      throw new EmbeddingDimensionMismatchError(expectedDimensions, actualDimensions, kbId);
    }
  }

  // Get the vector store
  const vectorStore = getVectorStore();
  if (!vectorStore) {
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

  // Update chunks_embedded counter if runId is provided
  if (runId) {
    await db
      .update(sourceRuns)
      .set({
        chunksEmbedded: sql`${sourceRuns.chunksEmbedded} + ${chunks.length}`,
      })
      .where(eq(sourceRuns.id, runId));
  }

  console.log(`Embedded ${chunks.length} chunks (${expectedDimensions}D) for KB ${kbId}`);
}
