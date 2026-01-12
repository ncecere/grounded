-- Migration: Update embedding vector dimensions
--
-- NOTE: This migration is now a no-op. The embeddings table has been removed.
-- Vectors are now stored in a separate postgres-vector database.
-- See @kcb/vector-store package for vector storage and retrieval.

-- No operations needed - vectors are now stored in separate database
SELECT 1;
