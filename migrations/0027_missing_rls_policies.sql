-- ============================================================================
-- Add Missing RLS Policies
--
-- Several tables created in later migrations were missing RLS policies.
-- This migration enables RLS and adds appropriate policies for all of them.
-- ============================================================================

-- ============================================================================
-- System / Admin Tables (admin-only access)
-- ============================================================================

-- System settings (stores secrets like API keys)
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_settings_admin_only ON system_settings
  FOR ALL
  USING (current_setting('app.is_system_admin', true) = 'true');

-- Users table (self-access + admin)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_access ON users
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR id = current_setting('app.user_id', true)::uuid
    -- Allow access to users in the same tenant (needed for membership lookups)
    OR id IN (
      SELECT user_id FROM tenant_memberships
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
      AND deleted_at IS NULL
    )
  );

-- User identities (self-access + admin)
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_identities_access ON user_identities
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR user_id = current_setting('app.user_id', true)::uuid
  );

-- User credentials (self-access + admin)
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_credentials_access ON user_credentials
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR user_id = current_setting('app.user_id', true)::uuid
  );

-- System admins table (admin-only)
ALTER TABLE system_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_admins_access ON system_admins
  FOR ALL
  USING (
    current_setting('app.is_system_admin', true) = 'true'
    OR user_id = current_setting('app.user_id', true)::uuid
  );

-- ============================================================================
-- Model / AI Configuration Tables (admin-only)
-- ============================================================================

-- Model providers (global, admin-only)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'model_providers') THEN
    ALTER TABLE model_providers ENABLE ROW LEVEL SECURITY;
    CREATE POLICY model_providers_admin_only ON model_providers
      FOR ALL
      USING (current_setting('app.is_system_admin', true) = 'true');
  END IF;
END $$;

-- Model configurations (global, admin-only)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'model_configurations') THEN
    ALTER TABLE model_configurations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY model_configurations_admin_only ON model_configurations
      FOR ALL
      USING (current_setting('app.is_system_admin', true) = 'true');
  END IF;
END $$;

-- ============================================================================
-- Admin API Tokens (admin-only)
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_api_tokens') THEN
    ALTER TABLE admin_api_tokens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY admin_api_tokens_admin_only ON admin_api_tokens
      FOR ALL
      USING (current_setting('app.is_system_admin', true) = 'true');
  END IF;
END $$;

-- ============================================================================
-- Audit Logs (admin-only, append-only for non-admins)
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
    -- Admins can read all audit logs
    CREATE POLICY audit_logs_admin_read ON audit_logs
      FOR SELECT
      USING (current_setting('app.is_system_admin', true) = 'true');
    -- System can insert audit logs (via admin context)
    CREATE POLICY audit_logs_insert ON audit_logs
      FOR INSERT
      WITH CHECK (true);
    -- No updates or deletes allowed (immutable audit trail)
    CREATE POLICY audit_logs_no_update ON audit_logs
      FOR UPDATE
      USING (false);
    CREATE POLICY audit_logs_no_delete ON audit_logs
      FOR DELETE
      USING (false);
  END IF;
END $$;

-- ============================================================================
-- Agent Tools & Capabilities (tenant-scoped)
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tool_definitions') THEN
    ALTER TABLE tool_definitions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tool_definitions_isolation ON tool_definitions
      FOR ALL
      USING (
        current_setting('app.is_system_admin', true) = 'true'
        OR tenant_id = current_setting('app.tenant_id', true)::uuid
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_tools') THEN
    ALTER TABLE agent_tools ENABLE ROW LEVEL SECURITY;
    CREATE POLICY agent_tools_isolation ON agent_tools
      FOR ALL
      USING (
        current_setting('app.is_system_admin', true) = 'true'
        OR agent_id IN (
          SELECT id FROM agents
          WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_capabilities') THEN
    ALTER TABLE agent_capabilities ENABLE ROW LEVEL SECURITY;
    CREATE POLICY agent_capabilities_isolation ON agent_capabilities
      FOR ALL
      USING (
        current_setting('app.is_system_admin', true) = 'true'
        OR agent_id IN (
          SELECT id FROM agents
          WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mcp_connections') THEN
    ALTER TABLE mcp_connections ENABLE ROW LEVEL SECURITY;
    CREATE POLICY mcp_connections_isolation ON mcp_connections
      FOR ALL
      USING (
        current_setting('app.is_system_admin', true) = 'true'
        OR tenant_id = current_setting('app.tenant_id', true)::uuid
      );
  END IF;
END $$;

-- ============================================================================
-- Chat Endpoint Tokens (tenant-scoped)
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_endpoint_tokens') THEN
    ALTER TABLE chat_endpoint_tokens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY chat_endpoint_tokens_isolation ON chat_endpoint_tokens
      FOR ALL
      USING (
        current_setting('app.is_system_admin', true) = 'true'
        OR tenant_id = current_setting('app.tenant_id', true)::uuid
      );
  END IF;
END $$;

-- ============================================================================
-- Ingestion Staging (tenant-scoped)
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'source_run_page_contents') THEN
    ALTER TABLE source_run_page_contents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY source_run_page_contents_isolation ON source_run_page_contents
      FOR ALL
      USING (
        current_setting('app.is_system_admin', true) = 'true'
        OR tenant_id = current_setting('app.tenant_id', true)::uuid
      );
  END IF;
END $$;
