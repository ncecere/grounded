-- HNSW vector indexes for the vector database (postgres-vector).
-- Run against the 'vectors' database, NOT the main 'grounded' database.
--
-- Since the vectors table uses untyped vector (no fixed dimensions), we:
--   1. Add a dimensions column to track vector dimensions
--   2. Backfill from existing data
--   3. Create partial HNSW indexes per dimension value
--
-- HNSW dramatically speeds up approximate nearest-neighbor search from O(n)
-- sequential scan to O(log n) with high recall.

-- Step 1: Add dimensions column
ALTER TABLE vectors ADD COLUMN IF NOT EXISTS dimensions smallint;

-- Step 2: Backfill dimensions from existing vectors
UPDATE vectors
SET dimensions = vector_dims(embedding)
WHERE dimensions IS NULL;

-- Step 3: Create HNSW index for 768-dimension vectors (nomic-embed-text)
-- Using cosine distance operator class (<=>)
-- m=16, ef_construction=64 are good defaults for 768-dim with ~1k-100k vectors
CREATE INDEX IF NOT EXISTS vectors_hnsw_768
ON vectors USING hnsw ((embedding::vector(768)) vector_cosine_ops)
WHERE dimensions = 768;

-- Step 4: Create HNSW index for 1536-dimension vectors (OpenAI text-embedding-3-small)
-- Added proactively for when users configure OpenAI embeddings
CREATE INDEX IF NOT EXISTS vectors_hnsw_1536
ON vectors USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
WHERE dimensions = 1536;

-- Note: pgvector HNSW has a 2000 dimension limit, so text-embedding-3-large
-- (3072 dims) cannot use HNSW. Those queries fall back to sequential scan
-- with the existing tenant/kb filtering indexes.
