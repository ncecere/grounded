-- Publishing (docs/phase4-publishing.md §3, §5-§7).

-- ---- platform settings -------------------------------------------------------------

-- name: GetPlatformSettings :one
SELECT * FROM platform_settings;

-- name: LockPlatformSettings :one
SELECT * FROM platform_settings FOR UPDATE;

-- name: SetPublicAgentsEnabled :one
UPDATE platform_settings
SET public_agents_enabled = @enabled, updated_by = @updated_by, revision = revision + 1, updated_at = now()
RETURNING *;

-- ---- audiences -------------------------------------------------------------------

-- name: SetAudienceGrant :exec
INSERT INTO agent_audience_grants (agent_id, principal_type, principal_id, created_by)
VALUES (@agent_id, @principal_type, NULL, @created_by)
ON CONFLICT (agent_id) DO UPDATE
SET principal_type = excluded.principal_type, created_by = excluded.created_by, created_at = now()
WHERE agent_audience_grants.principal_type <> excluded.principal_type;

-- The directory: published, active agents of active teams that the user
-- may chat with. group_key: team (a team of the user), organisation
-- (all_authenticated elsewhere) or public (public elsewhere, only when
-- public_enabled).
-- name: DirectoryAgents :many
SELECT a.*, t.slug AS team_slug, t.name AS team_name,
       coalesce(g.principal_type, 'team')::text AS audience,
       (CASE WHEN tm.user_id IS NOT NULL THEN 'team'
             WHEN g.principal_type = 'all_authenticated' THEN 'organisation'
             ELSE 'public' END)::text AS group_key,
       sn.short_name
FROM agents a
JOIN teams t ON t.id = a.team_id
LEFT JOIN agent_audience_grants g ON g.agent_id = a.id
LEFT JOIN team_members tm ON tm.team_id = a.team_id AND tm.user_id = @user_id
LEFT JOIN agent_short_names sn ON sn.agent_id = a.id
WHERE a.deleted_at IS NULL AND a.published_version_id IS NOT NULL AND a.status = 'active' AND t.status = 'active'
  AND (tm.user_id IS NOT NULL
       OR g.principal_type = 'all_authenticated'
       OR (g.principal_type = 'public' AND @public_enabled::bool))
  AND (sqlc.narg(search)::text IS NULL
       OR a.name ILIKE '%' || sqlc.narg(search)::text || '%'
       OR a.description ILIKE '%' || sqlc.narg(search)::text || '%'
       OR t.name ILIKE '%' || sqlc.narg(search)::text || '%')
  AND (sqlc.narg(team)::text IS NULL OR t.slug = sqlc.narg(team)::text OR t.id::text = sqlc.narg(team)::text)
ORDER BY lower(a.name), a.id
LIMIT 500;

-- ---- short names -------------------------------------------------------------------

-- name: GetShortName :one
SELECT * FROM agent_short_names WHERE agent_id = $1;

-- name: AgentByShortName :one
SELECT a.* FROM agent_short_names sn JOIN agents a ON a.id = sn.agent_id
WHERE sn.short_name = $1 AND a.deleted_at IS NULL;

-- name: ShortNameOwner :one
SELECT agent_id FROM agent_short_names WHERE short_name = $1;

-- name: DeleteShortName :execrows
DELETE FROM agent_short_names WHERE agent_id = $1;

-- name: InsertShortName :exec
INSERT INTO agent_short_names (short_name, agent_id, created_by) VALUES (@short_name, @agent_id, @created_by);

-- ---- publishable keys ----------------------------------------------------------------

-- name: InsertPublishableKey :one
INSERT INTO publishable_keys (agent_id, team_id, name, prefix, secret_hash, pepper_id, allowed_origins, rate_limits, created_by)
VALUES (@agent_id, @team_id, @name, @prefix, @secret_hash, @pepper_id, @allowed_origins, @rate_limits, @created_by)
RETURNING *;

-- name: ListPublishableKeys :many
SELECT * FROM publishable_keys WHERE agent_id = $1 AND revoked_at IS NULL ORDER BY created_at, id;

-- name: GetPublishableKey :one
SELECT * FROM publishable_keys WHERE id = $1 AND revoked_at IS NULL;

-- name: LockPublishableKey :one
SELECT * FROM publishable_keys WHERE id = $1 AND revoked_at IS NULL FOR UPDATE;

-- name: PublishableKeyByPrefix :one
SELECT * FROM publishable_keys WHERE prefix = $1 AND revoked_at IS NULL;

-- name: UpdatePublishableKey :one
UPDATE publishable_keys
SET name = @name, allowed_origins = @allowed_origins, rate_limits = @rate_limits, enabled = @enabled,
    revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: RevokePublishableKey :exec
UPDATE publishable_keys SET revoked_at = now(), enabled = false, revision = revision + 1, updated_at = now() WHERE id = $1;

-- name: TouchPublishableKey :exec
UPDATE publishable_keys SET last_used_at = now()
WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

-- ---- anonymous sessions ----------------------------------------------------------------

-- name: InsertAnonSession :one
INSERT INTO anon_sessions (token_digest, agent_id, channel, publishable_key_id, ip_prefix, user_agent_hash, expires_at)
VALUES (@token_digest, @agent_id, @channel, @publishable_key_id, @ip_prefix, @user_agent_hash, @expires_at)
RETURNING *;

-- name: GetAnonSession :one
SELECT * FROM anon_sessions WHERE token_digest = $1 AND expires_at > now();

-- name: TouchAnonSession :exec
UPDATE anon_sessions SET last_seen_at = now(), expires_at = @expires_at WHERE id = @id;

-- name: SetAnonSessionConversation :exec
UPDATE anon_sessions SET conversation_id = @conversation_id WHERE id = @id;

-- name: InsertAnonConversation :one
INSERT INTO conversations (agent_id, user_id, anonymous, anon_session_id, title, last_version_id)
VALUES (@agent_id, NULL, true, @anon_session_id, @title, @last_version_id)
RETURNING *;

-- ---- guardrails ----------------------------------------------------------------------

-- Public (anonymous and widget) usage of an agent since a time.
-- name: AgentPublicUsageSince :one
SELECT coalesce(sum(quantity) FILTER (WHERE kind = 'query'), 0)::bigint AS queries,
       coalesce(sum(quantity) FILTER (WHERE kind IN ('chat_tokens_in', 'chat_tokens_out')), 0)::bigint AS tokens
FROM usage_events
WHERE agent_id = @agent_id AND occurred_at >= @since
  AND kind IN ('query', 'chat_tokens_in', 'chat_tokens_out')
  AND metadata ->> 'channel' IN ('public', 'widget');

-- Live published agents with their audience and published rank (a level's
-- max_audience may not be narrowed below them).
-- name: PublishedAgentAudiences :many
SELECT a.id, a.name, t.slug AS team_slug, v.effective_rank, coalesce(g.principal_type, 'team')::text AS audience
FROM agents a
JOIN teams t ON t.id = a.team_id
JOIN agent_versions v ON v.id = a.published_version_id
LEFT JOIN agent_audience_grants g ON g.agent_id = a.id
WHERE a.deleted_at IS NULL AND coalesce(g.principal_type, 'team') <> 'team';
