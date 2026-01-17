-- Migration: Add reindex tracking fields to knowledge_bases
-- This enables the "hot swap" reindex feature where users can change
-- the embedding model for a KB and re-embed all chunks in the background.

-- Add reindex status tracking
ALTER TABLE knowledge_bases
ADD COLUMN IF NOT EXISTS reindex_status TEXT DEFAULT NULL;

-- Add reindex progress (0-100 percentage)
ALTER TABLE knowledge_bases
ADD COLUMN IF NOT EXISTS reindex_progress INTEGER DEFAULT NULL;

-- Add reindex error message
ALTER TABLE knowledge_bases
ADD COLUMN IF NOT EXISTS reindex_error TEXT DEFAULT NULL;

-- Add pending embedding model (the model we're switching to)
ALTER TABLE knowledge_bases
ADD COLUMN IF NOT EXISTS pending_embedding_model_id UUID REFERENCES model_configurations(id) ON DELETE SET NULL;

-- Add pending embedding dimensions
ALTER TABLE knowledge_bases
ADD COLUMN IF NOT EXISTS pending_embedding_dimensions INTEGER DEFAULT NULL;

-- Add reindex started timestamp
ALTER TABLE knowledge_bases
ADD COLUMN IF NOT EXISTS reindex_started_at TIMESTAMPTZ DEFAULT NULL;

-- Add constraint to validate reindex_status values
ALTER TABLE knowledge_bases
ADD CONSTRAINT knowledge_bases_reindex_status_check 
CHECK (reindex_status IS NULL OR reindex_status IN ('pending', 'in_progress', 'failed'));

-- Add index for finding KBs that need reindexing
CREATE INDEX IF NOT EXISTS knowledge_bases_reindex_status_idx 
ON knowledge_bases (reindex_status) 
WHERE reindex_status IS NOT NULL;

COMMENT ON COLUMN knowledge_bases.reindex_status IS 'Status of embedding model reindex: pending, in_progress, failed, or NULL when idle';
COMMENT ON COLUMN knowledge_bases.reindex_progress IS 'Percentage of chunks re-embedded (0-100)';
COMMENT ON COLUMN knowledge_bases.reindex_error IS 'Error message if reindex failed';
COMMENT ON COLUMN knowledge_bases.pending_embedding_model_id IS 'The new embedding model to switch to after reindex completes';
COMMENT ON COLUMN knowledge_bases.pending_embedding_dimensions IS 'Dimensions of the pending embedding model';
COMMENT ON COLUMN knowledge_bases.reindex_started_at IS 'When the current reindex operation started';
