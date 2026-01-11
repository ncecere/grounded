-- Migration: Update embedding vector dimensions
-- This migration changes the vector column from 1536 to 768 dimensions
-- to support nomic-embed-text and other 768-dim embedding models.
--
-- NOTE: This will invalidate any existing embeddings. If you have existing
-- embeddings, you'll need to re-process your sources to regenerate them.

-- Step 1: Drop the HNSW index (required before altering column)
DROP INDEX IF EXISTS embeddings_hnsw_idx;

-- Step 2: Delete any existing embeddings (they're incompatible with new dimensions)
-- Uncomment if you have existing data and want to clear it:
-- TRUNCATE embeddings;

-- Step 3: Alter the column type to use 768 dimensions
-- Note: This will fail if there's existing data with wrong dimensions
-- If you have data, truncate first or drop/recreate the table
ALTER TABLE embeddings
  ALTER COLUMN embedding TYPE vector(768);

-- Step 4: Recreate the HNSW index for fast similarity search
CREATE INDEX embeddings_hnsw_idx ON embeddings
  USING hnsw (embedding vector_cosine_ops);

-- Step 5: Update the chunks schema custom type comment
COMMENT ON COLUMN embeddings.embedding IS 'Vector embedding (768 dimensions for nomic-embed-text)';
