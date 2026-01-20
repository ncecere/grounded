-- Migration: Fix RLS policies to allow tenants to read global KB data
-- Global KB chunks, sources, and source_runs have tenant_id = NULL
-- Tenants should be able to read this data if they have access to the parent KB

-- Drop and recreate kb_chunks policy to allow reading global KB chunks
DROP POLICY IF EXISTS kb_chunks_isolation ON kb_chunks;
CREATE POLICY kb_chunks_isolation ON kb_chunks
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
    OR (
      -- Allow read access to chunks from published global KBs
      tenant_id IS NULL
      AND EXISTS (
        SELECT 1 FROM knowledge_bases kb
        WHERE kb.id = kb_chunks.kb_id
        AND kb.is_global = true
        AND kb.published_at IS NOT NULL
        AND kb.deleted_at IS NULL
      )
    )
  );

-- Drop and recreate sources policy to allow reading global KB sources
DROP POLICY IF EXISTS sources_isolation ON sources;
CREATE POLICY sources_isolation ON sources
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
    OR (
      -- Allow read access to sources from published global KBs
      tenant_id IS NULL
      AND EXISTS (
        SELECT 1 FROM knowledge_bases kb
        WHERE kb.id = sources.kb_id
        AND kb.is_global = true
        AND kb.published_at IS NOT NULL
        AND kb.deleted_at IS NULL
      )
    )
  );

-- Drop and recreate source_runs policy to allow reading global KB source runs
DROP POLICY IF EXISTS source_runs_isolation ON source_runs;
CREATE POLICY source_runs_isolation ON source_runs
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
    OR (
      -- Allow read access to source runs from published global KBs
      tenant_id IS NULL
      AND EXISTS (
        SELECT 1 FROM sources s
        JOIN knowledge_bases kb ON kb.id = s.kb_id
        WHERE s.id = source_runs.source_id
        AND kb.is_global = true
        AND kb.published_at IS NOT NULL
        AND kb.deleted_at IS NULL
      )
    )
  );

-- Drop and recreate source_run_pages policy to allow reading global KB source run pages
DROP POLICY IF EXISTS source_run_pages_isolation ON source_run_pages;
CREATE POLICY source_run_pages_isolation ON source_run_pages
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
    OR (
      -- Allow read access to pages from published global KBs
      tenant_id IS NULL
      AND EXISTS (
        SELECT 1 FROM source_runs sr
        JOIN sources s ON s.id = sr.source_id
        JOIN knowledge_bases kb ON kb.id = s.kb_id
        WHERE sr.id = source_run_pages.source_run_id
        AND kb.is_global = true
        AND kb.published_at IS NOT NULL
        AND kb.deleted_at IS NULL
      )
    )
  );

-- Drop and recreate uploads policy to allow reading global KB uploads
DROP POLICY IF EXISTS uploads_isolation ON uploads;
CREATE POLICY uploads_isolation ON uploads
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
    OR (
      -- Allow read access to uploads from published global KBs
      tenant_id IS NULL
      AND EXISTS (
        SELECT 1 FROM knowledge_bases kb
        WHERE kb.id = uploads.kb_id
        AND kb.is_global = true
        AND kb.published_at IS NOT NULL
        AND kb.deleted_at IS NULL
      )
    )
  );
