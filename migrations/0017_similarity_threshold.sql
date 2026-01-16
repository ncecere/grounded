-- Add similarity threshold to retrieval configs
-- This controls the minimum relevance score (0-1) for sources to be included in RAG context

ALTER TABLE retrieval_configs 
ADD COLUMN similarity_threshold REAL DEFAULT 0.5 NOT NULL;

COMMENT ON COLUMN retrieval_configs.similarity_threshold IS 'Minimum cosine similarity score (0-1) for chunks to be included in context. Higher = stricter matching.';
