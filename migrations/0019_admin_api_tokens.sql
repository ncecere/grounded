-- Migration: Create admin_api_tokens table
-- This table stores API tokens for system administrators to use for automation

CREATE TABLE IF NOT EXISTS admin_api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    token_prefix TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

-- Index for token lookup (used during authentication)
CREATE INDEX IF NOT EXISTS admin_api_tokens_token_hash_idx ON admin_api_tokens(token_hash);

-- Index for listing tokens by creator
CREATE INDEX IF NOT EXISTS admin_api_tokens_created_by_idx ON admin_api_tokens(created_by);

COMMENT ON TABLE admin_api_tokens IS 'API tokens for system administrators to use for automation and CI/CD';
COMMENT ON COLUMN admin_api_tokens.token_hash IS 'SHA-256 hash of the full token';
COMMENT ON COLUMN admin_api_tokens.token_prefix IS 'First 8 characters of the token for identification';
