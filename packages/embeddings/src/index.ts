import { embed, embedMany } from "ai";
import { getAIRegistry } from "@grounded/ai-providers";
import { getEnv, retry } from "@grounded/shared";

// ============================================================================
// Configuration (for fallback/defaults)
// ============================================================================

const EMBEDDING_BATCH_SIZE = parseInt(getEnv("EMBEDDING_BATCH_SIZE", "100"));

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  tokenCount: number;
}

// ============================================================================
// Embedding Functions
// ============================================================================

/**
 * Generate embedding for a single text.
 * @param text - Text to embed
 * @param modelConfigId - Optional specific model to use (defaults to configured default)
 * @throws Error if no embedding model is configured
 */
export async function generateEmbedding(
  text: string,
  modelConfigId?: string
): Promise<EmbeddingResult> {
  const registry = getAIRegistry();
  const model = await registry.getEmbeddingModel(modelConfigId);

  if (!model) {
    throw new Error("No embedding model configured. Please configure an embedding model in AI Models.");
  }

  const result = await retry(
    async () => {
      const response = await embed({
        model,
        value: text,
      });

      return {
        text,
        embedding: response.embedding,
        tokenCount: response.usage?.tokens || 0,
      };
    },
    { maxAttempts: 3, initialDelayMs: 1000 }
  );

  return result;
}

/**
 * Generate embeddings for multiple texts in batches.
 * @param texts - Array of texts to embed
 * @param modelConfigId - Optional specific model to use (defaults to configured default)
 * @throws Error if no embedding model is configured
 */
export async function generateEmbeddings(
  texts: string[],
  modelConfigId?: string
): Promise<EmbeddingResult[]> {
  const registry = getAIRegistry();
  const model = await registry.getEmbeddingModel(modelConfigId);

  if (!model) {
    throw new Error("No embedding model configured. Please configure an embedding model in AI Models.");
  }

  const results: EmbeddingResult[] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);

    const batchResult = await retry(
      async () => {
        const response = await embedMany({
          model,
          values: batch,
        });

        return response.embeddings.map((embedding, index) => ({
          text: batch[index],
          embedding,
          tokenCount: Math.ceil((response.usage?.tokens || 0) / batch.length),
        }));
      },
      { maxAttempts: 3, initialDelayMs: 1000 }
    );

    results.push(...batchResult);
  }

  return results;
}

/**
 * Calculate cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Get the configured embedding dimensions.
 * This is useful for vector database configuration.
 */
export async function getEmbeddingDimensions(modelConfigId?: string): Promise<number> {
  const registry = getAIRegistry();
  const models = await registry.listModels("embedding");

  if (modelConfigId) {
    const model = models.find(m => m.id === modelConfigId);
    return model?.dimensions || 1536;
  }

  const defaultModel = await registry.getDefaultModel("embedding");
  return defaultModel?.dimensions || 1536;
}
