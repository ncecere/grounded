-- The MCP client in agents (migrations/00037_mcp_client.sql, docs/mcp-client.md).

-- ---- servers ------------------------------------------------------------------

-- name: ListMCPServers :many
SELECT s.*, cl.rank::int AS max_rank,
       (SELECT count(*) FROM mcp_server_tools t WHERE t.server_id = s.id AND t.gone_at IS NULL)::bigint AS tool_count,
       (SELECT count(*) FROM mcp_server_tools t WHERE t.server_id = s.id AND t.approved)::bigint AS approved_count
FROM mcp_servers s
JOIN classification_levels cl ON cl.key = s.max_classification
ORDER BY lower(s.name), s.id;

-- name: GetMCPServer :one
SELECT s.*, cl.rank::int AS max_rank,
       (SELECT count(*) FROM mcp_server_tools t WHERE t.server_id = s.id AND t.gone_at IS NULL)::bigint AS tool_count,
       (SELECT count(*) FROM mcp_server_tools t WHERE t.server_id = s.id AND t.approved)::bigint AS approved_count
FROM mcp_servers s
JOIN classification_levels cl ON cl.key = s.max_classification
WHERE s.id = @id;

-- name: LockMCPServer :one
SELECT * FROM mcp_servers WHERE id = @id FOR UPDATE;

-- name: InsertMCPServer :one
INSERT INTO mcp_servers (id, name, description, url, auth_header_name, auth_value_cipher, auth_value_hint,
                         max_classification, timeout_seconds, enabled, created_by, updated_by)
VALUES (@id, @name, @description, @url, sqlc.narg(auth_header_name), sqlc.narg(auth_value_cipher), @auth_value_hint,
        @max_classification, @timeout_seconds, @enabled, sqlc.narg(created_by), sqlc.narg(created_by))
RETURNING *;

-- name: UpdateMCPServer :one
UPDATE mcp_servers
SET name = @name, description = @description, url = @url, auth_header_name = sqlc.narg(auth_header_name),
    auth_value_cipher = sqlc.narg(auth_value_cipher), auth_value_hint = @auth_value_hint,
    max_classification = @max_classification, timeout_seconds = @timeout_seconds, enabled = @enabled,
    revision = revision + 1, updated_by = sqlc.narg(updated_by), updated_at = now()
WHERE id = @id
RETURNING *;

-- name: TouchMCPServerTools :exec
UPDATE mcp_servers SET tools_refreshed_at = now() WHERE id = @id;

-- name: DeleteMCPServer :exec
DELETE FROM mcp_servers WHERE id = @id;

-- name: MCPServerPublishedUses :many
-- The agents whose published (current) version uses a tool of the server.
SELECT DISTINCT a.id, a.name, t.slug AS team_slug, t.name AS team_name, v.version
FROM agents a
JOIN teams t ON t.id = a.team_id
JOIN agent_versions v ON v.id = a.published_version_id
JOIN agent_tools vt ON vt.version_id = a.published_version_id
JOIN mcp_server_tools st ON st.id = vt.tool_id
WHERE st.server_id = @server_id AND a.deleted_at IS NULL
ORDER BY a.name, a.id;

-- name: MCPServerToolPublishedUses :many
-- Per tool of the server, the agents whose published (current) version uses it.
SELECT vt.tool_id, a.id AS agent_id, a.name, t.slug AS team_slug, t.name AS team_name, v.version
FROM agents a
JOIN teams t ON t.id = a.team_id
JOIN agent_versions v ON v.id = a.published_version_id
JOIN agent_tools vt ON vt.version_id = a.published_version_id
JOIN mcp_server_tools st ON st.id = vt.tool_id
WHERE st.server_id = @server_id AND a.deleted_at IS NULL
ORDER BY lower(a.name), a.id;

-- ---- tools ----------------------------------------------------------------------

-- name: ListMCPServerTools :many
SELECT t.*, COALESCE(u.display_name, '')::text AS approved_by_name
FROM mcp_server_tools t
LEFT JOIN users u ON u.id = t.approved_by
WHERE t.server_id = @server_id
ORDER BY t.gone_at IS NOT NULL, lower(t.name), t.id;

-- name: GetMCPServerTool :one
SELECT * FROM mcp_server_tools WHERE id = @id AND server_id = @server_id;

-- name: LockMCPServerTool :one
SELECT * FROM mcp_server_tools WHERE id = @id AND server_id = @server_id FOR UPDATE;

-- name: UpsertMCPServerTool :one
-- A tool the server lists now: inserted, or refreshed (and brought back if
-- it was gone). The caller decides whether its approval stands.
INSERT INTO mcp_server_tools (server_id, name, title, description, input_schema, last_seen_at)
VALUES (@server_id, @name, @title, @description, @input_schema, now())
ON CONFLICT (server_id, name) DO UPDATE
SET title = EXCLUDED.title, description = EXCLUDED.description, input_schema = EXCLUDED.input_schema,
    last_seen_at = now(), gone_at = NULL,
    approved = mcp_server_tools.approved AND @keep_approval::boolean,
    approved_by = CASE WHEN @keep_approval::boolean THEN mcp_server_tools.approved_by END,
    approved_at = CASE WHEN @keep_approval::boolean THEN mcp_server_tools.approved_at END
RETURNING *;

-- name: MarkMCPServerToolsGone :many
-- Tools the server no longer lists: gone and unapproved.
UPDATE mcp_server_tools
SET gone_at = COALESCE(gone_at, now()), approved = false, approved_by = NULL, approved_at = NULL
WHERE server_id = @server_id AND NOT (name = ANY(@listed::text[])) AND gone_at IS NULL
RETURNING *;

-- name: SetMCPServerToolApproval :one
UPDATE mcp_server_tools
SET approved = @approved, approved_by = sqlc.narg(approved_by), approved_at = CASE WHEN @approved::boolean THEN now() END
WHERE id = @id AND server_id = @server_id
RETURNING *;

-- name: MCPToolsByIDs :many
-- Tools with their server, for agents: the editor's choices, publish checks
-- and answers.
SELECT t.id, t.server_id, t.name, t.title, t.description, t.input_schema, t.approved, t.gone_at,
       s.name AS server_name, s.url AS server_url, s.enabled AS server_enabled,
       s.max_classification AS server_max_classification, cl.rank::int AS server_max_rank, s.timeout_seconds AS server_timeout_seconds
FROM mcp_server_tools t
JOIN mcp_servers s ON s.id = t.server_id
JOIN classification_levels cl ON cl.key = s.max_classification
WHERE t.id = ANY(@ids::uuid[]);

-- name: ListUsableMCPTools :many
-- Approved tools of enabled servers (the agent editor's choices).
SELECT t.id, t.server_id, t.name, t.title, t.description, t.input_schema,
       s.name AS server_name, s.max_classification AS server_max_classification, cl.rank::int AS server_max_rank
FROM mcp_server_tools t
JOIN mcp_servers s ON s.id = t.server_id
JOIN classification_levels cl ON cl.key = s.max_classification
WHERE t.approved AND t.gone_at IS NULL AND s.enabled
ORDER BY lower(s.name), s.id, lower(t.name), t.id;

-- name: InsertAgentTool :exec
INSERT INTO agent_tools (version_id, tool_id) VALUES (@version_id, @tool_id);

-- name: MCPServerCallTarget :one
-- A server's settings at call time (the ceiling is checked on every call).
SELECT s.id, s.name, s.url, s.auth_header_name, s.auth_value_cipher, s.timeout_seconds, s.enabled, cl.rank::int AS max_rank
FROM mcp_servers s
JOIN classification_levels cl ON cl.key = s.max_classification
WHERE s.id = @id;
