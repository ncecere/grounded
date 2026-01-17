-- Migration: Add Advanced RAG support
-- Adds rag_type column to agents table and new fields to retrieval_configs

-- Add rag_type column to agents table
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS rag_type TEXT NOT NULL DEFAULT 'simple';

-- Add constraint to ensure valid rag_type values
ALTER TABLE agents
ADD CONSTRAINT agents_rag_type_check CHECK (rag_type IN ('simple', 'advanced'));

-- Add history_turns column to retrieval_configs (for advanced RAG query rewriting)
ALTER TABLE retrieval_configs
ADD COLUMN IF NOT EXISTS history_turns INTEGER NOT NULL DEFAULT 5;

-- Add advanced_max_subqueries column to retrieval_configs (for advanced RAG)
ALTER TABLE retrieval_configs
ADD COLUMN IF NOT EXISTS advanced_max_subqueries INTEGER NOT NULL DEFAULT 3;

-- Add constraints for the new columns
ALTER TABLE retrieval_configs
ADD CONSTRAINT retrieval_configs_history_turns_check CHECK (history_turns >= 1 AND history_turns <= 20);

ALTER TABLE retrieval_configs
ADD CONSTRAINT retrieval_configs_advanced_max_subqueries_check CHECK (advanced_max_subqueries >= 1 AND advanced_max_subqueries <= 5);

COMMENT ON COLUMN agents.rag_type IS 'RAG mode: simple (standard retrieval) or advanced (multi-step reasoning with sub-queries)';
COMMENT ON COLUMN retrieval_configs.history_turns IS 'Number of conversation history turns to include for query rewriting in advanced RAG mode (1-20)';
COMMENT ON COLUMN retrieval_configs.advanced_max_subqueries IS 'Maximum number of sub-queries to generate in advanced RAG mode (1-5)';
