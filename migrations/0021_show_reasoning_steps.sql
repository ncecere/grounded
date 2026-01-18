-- Migration: Add show_reasoning_steps column to agents table
-- Controls whether reasoning steps are displayed in widget/published chat for advanced RAG mode

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS show_reasoning_steps BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN agents.show_reasoning_steps IS 'Whether to show reasoning steps in widget/published chat (only applies when rag_type is advanced)';
