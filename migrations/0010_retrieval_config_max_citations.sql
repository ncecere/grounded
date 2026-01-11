-- Add max_citations column to retrieval_configs
-- This controls how many source citations are shown to the user

ALTER TABLE retrieval_configs ADD COLUMN IF NOT EXISTS max_citations INTEGER NOT NULL DEFAULT 3;

-- Add a comment explaining the columns in human terms
COMMENT ON COLUMN retrieval_configs.top_k IS 'Number of sources used for context (how many sources the AI reads)';
COMMENT ON COLUMN retrieval_configs.candidate_k IS 'Number of sources searched (broader search pool)';
COMMENT ON COLUMN retrieval_configs.max_citations IS 'Number of sources shown to user (visible citations)';
