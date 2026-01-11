-- ============================================================================
-- Row Level Security Policies
-- ============================================================================

-- Enable RLS on all tenant-owned tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_kb_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_run_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_kbs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_widget_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Tenant isolation policies
-- ============================================================================

-- Tenants: users can only see tenants they belong to
CREATE POLICY tenant_isolation ON tenants
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR id IN (
      SELECT tenant_id FROM tenant_memberships
      WHERE user_id = current_setting('app.user_id', true)::uuid
      AND deleted_at IS NULL
    )
  );

-- Tenant memberships
CREATE POLICY tenant_memberships_isolation ON tenant_memberships
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Knowledge bases: tenant-owned or published global
CREATE POLICY knowledge_bases_isolation ON knowledge_bases
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
    OR (
      is_global = true
      AND published_at IS NOT NULL
      AND (
        -- Allow read for subscribed tenants
        EXISTS (
          SELECT 1 FROM tenant_kb_subscriptions
          WHERE kb_id = knowledge_bases.id
          AND tenant_id = current_setting('app.tenant_id', true)::uuid
          AND deleted_at IS NULL
        )
      )
    )
  );

-- Standard tenant_id isolation for other tables
CREATE POLICY sources_isolation ON sources
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY source_runs_isolation ON source_runs
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY source_run_pages_isolation ON source_run_pages
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY kb_chunks_isolation ON kb_chunks
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY embeddings_isolation ON embeddings
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY uploads_isolation ON uploads
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY agents_isolation ON agents
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY agent_kbs_isolation ON agent_kbs
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR agent_id IN (
      SELECT id FROM agents
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY agent_widget_configs_isolation ON agent_widget_configs
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR agent_id IN (
      SELECT id FROM agents
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY retrieval_configs_isolation ON retrieval_configs
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR agent_id IN (
      SELECT id FROM agents
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY widget_tokens_isolation ON widget_tokens
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY chat_events_isolation ON chat_events
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY api_keys_isolation ON api_keys
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_quotas_isolation ON tenant_quotas
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_usage_isolation ON tenant_usage
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY tenant_kb_subscriptions_isolation ON tenant_kb_subscriptions
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY deletion_jobs_isolation ON deletion_jobs
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );
