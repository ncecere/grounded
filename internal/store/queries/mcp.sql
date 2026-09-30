-- The MCP server's platform switch (migrations/00035_mcp_server.sql, docs/mcp.md).

-- name: GetMCPSettings :one
SELECT * FROM mcp_settings;

-- name: LockMCPSettings :one
SELECT * FROM mcp_settings FOR UPDATE;

-- name: SetMCPSettings :one
UPDATE mcp_settings
SET enabled = @enabled, oauth_enabled = @oauth_enabled, revision = revision + 1, updated_by = @updated_by, updated_at = now()
RETURNING *;
