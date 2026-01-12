import { getEnv } from "@kcb/shared";
import type { VectorStore, VectorStoreConfig, VectorStoreType } from "./types";
import { PgVectorStore } from "./providers/pgvector";

// Singleton instance
let vectorStoreInstance: VectorStore | null = null;

/**
 * Get the vector store configuration from environment variables.
 * Note: Dimensions are not configured here - the vector store supports
 * any dimension, allowing different KBs to use different embedding models.
 */
export function getVectorStoreConfig(): VectorStoreConfig | null {
  const type = getEnv("VECTOR_DB_TYPE", "pgvector") as VectorStoreType;

  // Try connection URL first
  const url = getEnv("VECTOR_DB_URL", "");
  if (url) {
    return {
      type,
      url,
      ssl: getEnv("VECTOR_DB_SSL", "false") === "true",
    };
  }

  // Fall back to individual params
  const host = getEnv("VECTOR_DB_HOST", "");
  if (host) {
    return {
      type,
      host,
      port: parseInt(getEnv("VECTOR_DB_PORT", "5432"), 10),
      database: getEnv("VECTOR_DB_NAME", "vectors"),
      user: getEnv("VECTOR_DB_USER", ""),
      password: getEnv("VECTOR_DB_PASSWORD", ""),
      ssl: getEnv("VECTOR_DB_SSL", "false") === "true",
    };
  }

  // No vector DB configured
  return null;
}

/**
 * Create a vector store instance from configuration.
 */
export function createVectorStore(config: VectorStoreConfig): VectorStore {
  switch (config.type) {
    case "pgvector":
      return new PgVectorStore(config);

    case "qdrant":
      // TODO: Implement Qdrant provider
      throw new Error("Qdrant vector store not yet implemented");

    default:
      throw new Error(`Unknown vector store type: ${config.type}`);
  }
}

/**
 * Get the singleton vector store instance.
 * Returns null if no vector database is configured.
 */
export function getVectorStore(): VectorStore | null {
  if (vectorStoreInstance) {
    return vectorStoreInstance;
  }

  const config = getVectorStoreConfig();
  if (!config) {
    console.warn("[VectorStore] No vector database configured. Set VECTOR_DB_URL or VECTOR_DB_HOST environment variables.");
    return null;
  }

  vectorStoreInstance = createVectorStore(config);
  return vectorStoreInstance;
}

/**
 * Initialize the vector store on application startup.
 * Creates tables, indexes, etc.
 * Returns false if no vector database is configured.
 */
export async function initializeVectorStore(): Promise<boolean> {
  const store = getVectorStore();
  if (!store) {
    console.warn("[VectorStore] Skipping initialization - no vector database configured.");
    return false;
  }

  await store.initialize();
  console.log(`[VectorStore] Initialized ${store.type} vector store`);
  return true;
}

/**
 * Check if the vector store is configured and available.
 */
export function isVectorStoreConfigured(): boolean {
  return getVectorStoreConfig() !== null;
}

/**
 * Reset the vector store instance (for testing).
 */
export async function resetVectorStore(): Promise<void> {
  if (vectorStoreInstance) {
    await vectorStoreInstance.close();
    vectorStoreInstance = null;
  }
}
