import { db } from "@kcb/db";
import { kbChunks, embeddings, knowledgeBases } from "@kcb/db/schema";
import { eq, inArray, isNull, and } from "drizzle-orm";
import { generateEmbeddings } from "@kcb/embeddings";
import { getAIRegistry } from "@kcb/ai-providers";
import type { EmbedChunksBatchJob } from "@kcb/shared";

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
  const { tenantId, kbId, chunkIds } = data;

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

  // Insert embeddings with model tracking
  const embeddingValues = chunks.map((chunk, index) => ({
    tenantId,
    kbId,
    chunkId: chunk.id,
    embedding: embeddingResults[index].embedding,
    modelId, // Track which model generated this embedding
  }));

  // Delete existing embeddings for these chunks
  await db
    .delete(embeddings)
    .where(inArray(embeddings.chunkId, chunkIds));

  // Insert new embeddings
  await db.insert(embeddings).values(embeddingValues);

  console.log(`Embedded ${chunks.length} chunks (${expectedDimensions}D) for KB ${kbId}`);
}
