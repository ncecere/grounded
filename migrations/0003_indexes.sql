-- ============================================================================
-- Additional indexes for performance
-- ============================================================================

-- GIN index for full-text search on kb_chunks
CREATE INDEX IF NOT EXISTS kb_chunks_tsv_gin_idx ON kb_chunks USING GIN(tsv);

-- Trigger to automatically update tsvector (drop first if exists)
DROP TRIGGER IF EXISTS kb_chunks_tsv_update ON kb_chunks;
CREATE TRIGGER kb_chunks_tsv_update
  BEFORE INSERT OR UPDATE ON kb_chunks
  FOR EACH ROW
  EXECUTE FUNCTION kb_chunks_tsv_trigger();

-- Note: embeddings indexes removed - vectors are now stored in separate postgres-vector database

-- Index for conversation memory lookups (if using Redis, this is optional)
-- But useful for analytics queries
CREATE INDEX IF NOT EXISTS chat_events_conversation_idx
  ON chat_events (agent_id, started_at DESC);
