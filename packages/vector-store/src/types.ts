/**
 * Supported vector database types.
 * pgvector - PostgreSQL with pgvector extension
 * qdrant - Qdrant vector database (future)
 */
export type VectorStoreType = "pgvector" | "qdrant";

/**
 * Configuration for the vector store connection.
 * Note: Dimensions are not configured - the vector store accepts any dimension,
 * allowing different KBs to use different embedding models.
 */
export interface VectorStoreConfig {
  type: VectorStoreType;
  /** Connection URL (preferred) */
  url?: string;
  /** Individual connection params (alternative to url) */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** SSL configuration */
  ssl?: boolean | { rejectUnauthorized: boolean };
}

/**
 * A vector record to be stored.
 */
export interface VectorRecord {
  /** Unique identifier (typically matches kb_chunks.id) */
  id: string;
  /** Tenant ID for multi-tenancy filtering */
  tenantId: string | null;
  /** Knowledge base ID for filtering */
  kbId: string;
  /** Source ID for filtering/deletion */
  sourceId: string;
  /** The embedding vector */
  embedding: number[];
}

/**
 * Options for vector search.
 */
export interface SearchOptions {
  /** Filter by tenant ID (required for multi-tenancy) */
  tenantId: string;
  /** Filter by knowledge base IDs */
  kbIds?: string[];
  /** Filter by source IDs */
  sourceIds?: string[];
  /** Number of results to return */
  topK?: number;
  /** Minimum similarity score (0-1) */
  minScore?: number;
}

/**
 * A search result from vector similarity search.
 */
export interface SearchResult {
  /** The chunk ID */
  id: string;
  /** Similarity score (higher is more similar) */
  score: number;
  /** Distance (lower is more similar, for reference) */
  distance?: number;
}

/**
 * Filter for deleting vectors by metadata.
 */
export interface MetadataFilter {
  tenantId?: string;
  kbId?: string;
  sourceId?: string;
}

/**
 * Health check result.
 */
export interface HealthCheckResult {
  ok: boolean;
  type: VectorStoreType;
  message?: string;
  latencyMs?: number;
  vectorCount?: number;
}

/**
 * Abstract interface for vector store implementations.
 * Each provider (pgvector, qdrant, etc.) implements this interface.
 */
export interface VectorStore {
  /**
   * Get the store type.
   */
  readonly type: VectorStoreType;

  /**
   * Initialize the vector store (create tables, indexes, etc.).
   * Should be called once on application startup.
   */
  initialize(): Promise<void>;

  /**
   * Insert or update vectors.
   * Uses upsert semantics - existing vectors with same ID are replaced.
   */
  upsert(vectors: VectorRecord[]): Promise<void>;

  /**
   * Search for similar vectors.
   */
  search(query: number[], options: SearchOptions): Promise<SearchResult[]>;

  /**
   * Delete vectors by their IDs.
   */
  delete(ids: string[]): Promise<void>;

  /**
   * Delete vectors matching a metadata filter.
   * Useful for deleting all vectors for a source or knowledge base.
   */
  deleteByMetadata(filter: MetadataFilter): Promise<void>;

  /**
   * Perform a health check on the vector store connection.
   */
  healthCheck(): Promise<HealthCheckResult>;

  /**
   * Get total vector count (optionally filtered).
   */
  count(filter?: MetadataFilter): Promise<number>;

  /**
   * Close the connection.
   */
  close(): Promise<void>;
}
