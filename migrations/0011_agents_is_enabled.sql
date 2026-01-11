-- Add isEnabled column to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Create index for filtering enabled agents
CREATE INDEX IF NOT EXISTS agents_is_enabled_idx ON agents (is_enabled) WHERE deleted_at IS NULL;
