// Types
export type {
  VectorStoreType,
  VectorStoreConfig,
  VectorRecord,
  SearchOptions,
  SearchResult,
  MetadataFilter,
  HealthCheckResult,
  VectorStore,
} from "./types";

// Registry/Factory
export {
  getVectorStoreConfig,
  createVectorStore,
  getVectorStore,
  initializeVectorStore,
  isVectorStoreConfigured,
  resetVectorStore,
} from "./registry";

// Providers (for direct instantiation if needed)
export { PgVectorStore } from "./providers/pgvector";
