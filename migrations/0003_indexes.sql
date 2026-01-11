-- ============================================================================
-- Additional indexes for performance
-- ============================================================================

-- GIN index for full-text search on kb_chunks
CREATE INDEX IF NOT EXISTS kb_chunks_tsv_gin_idx ON kb_chunks USING GIN(tsv);

-- Trigger to automatically update tsvector
CREATE TRIGGER kb_chunks_tsv_update
  BEFORE INSERT OR UPDATE ON kb_chunks
  FOR EACH ROW
  EXECUTE FUNCTION kb_chunks_tsv_trigger();

-- HNSW index for vector similarity search (requires pgvector 0.5.0+)
-- Using cosine distance for OpenAI embeddings
CREATE INDEX IF NOT EXISTS embeddings_vector_hnsw_idx
  ON embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Composite index for efficient retrieval queries
CREATE INDEX IF NOT EXISTS embeddings_tenant_kb_vector_idx
  ON embeddings (tenant_id, kb_id);

-- Index for conversation memory lookups (if using Redis, this is optional)
-- But useful for analytics queries
CREATE INDEX IF NOT EXISTS chat_events_conversation_idx
  ON chat_events (agent_id, started_at DESC);
