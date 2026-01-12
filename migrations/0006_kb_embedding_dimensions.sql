-- Migration: Add embedding dimension tracking to knowledge bases
-- This allows each KB to track which embedding model/dimensions it uses

-- Step 1: Add columns to knowledge_bases
ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS embedding_model_id UUID REFERENCES model_configurations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER NOT NULL DEFAULT 768;

-- Note: embeddings table model_id column removed - vectors are now stored in separate postgres-vector database

-- Step 2: Create index for efficient lookups
CREATE INDEX IF NOT EXISTS knowledge_bases_embedding_model_idx
  ON knowledge_bases (embedding_model_id);

-- Step 4: Add a comment explaining the dimension tracking
COMMENT ON COLUMN knowledge_bases.embedding_dimensions IS
  'Vector dimensions for this KB. Set when KB is created based on default embedding model. All embeddings in this KB must match this dimension.';

COMMENT ON COLUMN knowledge_bases.embedding_model_id IS
  'The embedding model used for this KB. Helps track which model generated the embeddings.';
