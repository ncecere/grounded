-- Add LLM model configuration to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS llm_model_config_id UUID REFERENCES model_configurations(id) ON DELETE SET NULL;

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS agents_llm_model_config_idx ON agents(llm_model_config_id) WHERE llm_model_config_id IS NOT NULL;
