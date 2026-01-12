import postgres from "postgres";
import type {
  VectorStore,
  VectorStoreConfig,
  VectorRecord,
  SearchOptions,
  SearchResult,
  MetadataFilter,
  HealthCheckResult,
} from "../types";

/**
 * pgvector implementation of VectorStore.
 * Uses a separate PostgreSQL cluster with the pgvector extension.
 *
 * Note: This implementation uses the `vector` type without specifying dimensions,
 * allowing different KBs to use different embedding models with varying dimensions.
 * The trade-off is that HNSW/IVFFlat indexes cannot be used (they require fixed dimensions),
 * but the filtering indexes on tenant_id, kb_id, source_id provide adequate performance
 * for typical KB sizes.
 */
export class PgVectorStore implements VectorStore {
  readonly type = "pgvector" as const;
  private sql: postgres.Sql;
  private initialized = false;

  constructor(config: VectorStoreConfig) {
    // Build connection options
    const connectionUrl = config.url || this.buildConnectionUrl(config);

    this.sql = postgres(connectionUrl, {
      ssl: config.ssl,
      max: 10, // Connection pool size
      idle_timeout: 30,
      connect_timeout: 10,
    });
  }

  private buildConnectionUrl(config: VectorStoreConfig): string {
    const { host, port, database, user, password } = config;
    if (!host || !database || !user) {
      throw new Error("Vector store requires url or host/database/user configuration");
    }
    const portStr = port ? `:${port}` : "";
    const passwordStr = password ? `:${encodeURIComponent(password)}` : "";
    return `postgresql://${user}${passwordStr}@${host}${portStr}/${database}`;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Enable pgvector extension
      await this.sql`CREATE EXTENSION IF NOT EXISTS vector`;

      // Create vectors table with flexible vector type (no dimension specified)
      // This allows different KBs to use different embedding models with varying dimensions
      // tenant_id is nullable to support global/shared KBs
      await this.sql`
        CREATE TABLE IF NOT EXISTS vectors (
          id UUID PRIMARY KEY,
          tenant_id UUID,
          kb_id UUID NOT NULL,
          source_id UUID NOT NULL,
          embedding vector NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;

      // Ensure tenant_id is nullable (for existing tables that had NOT NULL constraint)
      await this.sql`
        ALTER TABLE vectors ALTER COLUMN tenant_id DROP NOT NULL
      `.catch(() => {
        // Ignore error if column is already nullable
      });

      // Create indexes for filtering - these provide fast lookups for multi-tenant queries
      await this.sql`
        CREATE INDEX IF NOT EXISTS vectors_tenant_kb_idx
        ON vectors(tenant_id, kb_id)
      `;

      await this.sql`
        CREATE INDEX IF NOT EXISTS vectors_source_idx
        ON vectors(source_id)
      `;

      // Note: HNSW/IVFFlat indexes require fixed dimensions, so we skip them
      // The filtering indexes above provide adequate performance for typical KB sizes
      // Similarity search will be performed within the filtered result set

      this.initialized = true;
      console.log("[VectorStore] pgvector initialized successfully");
    } catch (error) {
      console.error("[VectorStore] Failed to initialize pgvector:", error);
      throw error;
    }
  }

  async upsert(vectors: VectorRecord[]): Promise<void> {
    if (vectors.length === 0) return;

    // Process in batches to avoid query size limits
    const BATCH_SIZE = 100;
    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      const batch = vectors.slice(i, i + BATCH_SIZE);

      // Build values for batch insert
      const values = batch.map(v => ({
        id: v.id,
        tenant_id: v.tenantId,
        kb_id: v.kbId,
        source_id: v.sourceId,
        embedding: `[${v.embedding.join(",")}]`,
      }));

      await this.sql`
        INSERT INTO vectors ${this.sql(values)}
        ON CONFLICT (id) DO UPDATE SET
          embedding = EXCLUDED.embedding,
          created_at = NOW()
      `;
    }
  }

  async search(query: number[], options: SearchOptions): Promise<SearchResult[]> {
    const { tenantId, kbIds, sourceIds, topK = 10, minScore = 0 } = options;

    // Build the query vector string
    const queryVector = `[${query.join(",")}]`;

    // Build dynamic WHERE clause
    let results: Array<{ id: string; distance: number }>;

    // Include both tenant-owned chunks AND global KB chunks (tenant_id IS NULL)
    // The kbIds filter ensures we only get chunks from attached KBs
    if (kbIds && kbIds.length > 0 && sourceIds && sourceIds.length > 0) {
      results = await this.sql`
        SELECT
          id,
          embedding <=> ${queryVector}::vector AS distance
        FROM vectors
        WHERE (tenant_id = ${tenantId} OR tenant_id IS NULL)
          AND kb_id = ANY(${kbIds})
          AND source_id = ANY(${sourceIds})
        ORDER BY distance
        LIMIT ${topK}
      `;
    } else if (kbIds && kbIds.length > 0) {
      results = await this.sql`
        SELECT
          id,
          embedding <=> ${queryVector}::vector AS distance
        FROM vectors
        WHERE (tenant_id = ${tenantId} OR tenant_id IS NULL)
          AND kb_id = ANY(${kbIds})
        ORDER BY distance
        LIMIT ${topK}
      `;
    } else if (sourceIds && sourceIds.length > 0) {
      results = await this.sql`
        SELECT
          id,
          embedding <=> ${queryVector}::vector AS distance
        FROM vectors
        WHERE (tenant_id = ${tenantId} OR tenant_id IS NULL)
          AND source_id = ANY(${sourceIds})
        ORDER BY distance
        LIMIT ${topK}
      `;
    } else {
      results = await this.sql`
        SELECT
          id,
          embedding <=> ${queryVector}::vector AS distance
        FROM vectors
        WHERE tenant_id = ${tenantId}
        ORDER BY distance
        LIMIT ${topK}
      `;
    }

    // Convert distance to similarity score (cosine distance to similarity)
    // Cosine distance ranges from 0 (identical) to 2 (opposite)
    // We convert to similarity: 1 - (distance / 2)
    return results
      .map(r => ({
        id: r.id,
        score: 1 - (r.distance / 2),
        distance: r.distance,
      }))
      .filter(r => r.score >= minScore);
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.sql`
      DELETE FROM vectors
      WHERE id = ANY(${ids})
    `;
  }

  async deleteByMetadata(filter: MetadataFilter): Promise<void> {
    const { tenantId, kbId, sourceId } = filter;

    if (sourceId) {
      await this.sql`DELETE FROM vectors WHERE source_id = ${sourceId}`;
    } else if (kbId) {
      await this.sql`DELETE FROM vectors WHERE kb_id = ${kbId}`;
    } else if (tenantId) {
      await this.sql`DELETE FROM vectors WHERE tenant_id = ${tenantId}`;
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      // Simple query to verify connection
      const [result] = await this.sql`SELECT COUNT(*) as count FROM vectors`;
      const latencyMs = Date.now() - start;

      return {
        ok: true,
        type: this.type,
        latencyMs,
        vectorCount: parseInt(result.count as string, 10),
      };
    } catch (error) {
      return {
        ok: false,
        type: this.type,
        message: error instanceof Error ? error.message : "Unknown error",
        latencyMs: Date.now() - start,
      };
    }
  }

  async count(filter?: MetadataFilter): Promise<number> {
    let result: Array<{ count: string }>;

    if (filter?.sourceId) {
      result = await this.sql`SELECT COUNT(*) as count FROM vectors WHERE source_id = ${filter.sourceId}`;
    } else if (filter?.kbId) {
      result = await this.sql`SELECT COUNT(*) as count FROM vectors WHERE kb_id = ${filter.kbId}`;
    } else if (filter?.tenantId) {
      result = await this.sql`SELECT COUNT(*) as count FROM vectors WHERE tenant_id = ${filter.tenantId}`;
    } else {
      result = await this.sql`SELECT COUNT(*) as count FROM vectors`;
    }

    return parseInt(result[0].count, 10);
  }

  async close(): Promise<void> {
    await this.sql.end();
    this.initialized = false;
  }
}
