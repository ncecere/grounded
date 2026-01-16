-- Migration: Add audit_logs table
-- Purpose: Track all auditable events in the system

-- Create the audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    ip_address INET,
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS audit_logs_tenant_idx ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_time_idx ON audit_logs(tenant_id, timestamp);

-- Add comment to table
COMMENT ON TABLE audit_logs IS 'Stores all auditable events for security and compliance tracking';
