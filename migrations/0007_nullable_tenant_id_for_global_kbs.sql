-- Migration: Allow nullable tenant_id for global KB sources
-- This enables sources and source_runs to belong to global knowledge bases (which have no tenant)

-- Step 1: Alter sources table to allow NULL tenant_id
ALTER TABLE sources
  ALTER COLUMN tenant_id DROP NOT NULL;

-- Step 2: Alter source_runs table to allow NULL tenant_id
ALTER TABLE source_runs
  ALTER COLUMN tenant_id DROP NOT NULL;

-- Step 3: Alter source_run_pages table to allow NULL tenant_id
ALTER TABLE source_run_pages
  ALTER COLUMN tenant_id DROP NOT NULL;

-- Step 4: Alter kb_chunks table to allow NULL tenant_id (for chunks from global KB sources)
ALTER TABLE kb_chunks
  ALTER COLUMN tenant_id DROP NOT NULL;

COMMENT ON COLUMN sources.tenant_id IS
  'Tenant that owns this source. NULL for sources belonging to global knowledge bases.';

COMMENT ON COLUMN source_runs.tenant_id IS
  'Tenant that owns this run. NULL for runs of global KB sources.';

COMMENT ON COLUMN kb_chunks.tenant_id IS
  'Tenant that owns this chunk. NULL for chunks from global knowledge bases.';
