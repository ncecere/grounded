-- Add force_reindex column to source_runs
-- When true, the run will re-index all pages regardless of content hash

ALTER TABLE source_runs ADD COLUMN IF NOT EXISTS force_reindex BOOLEAN NOT NULL DEFAULT FALSE;
