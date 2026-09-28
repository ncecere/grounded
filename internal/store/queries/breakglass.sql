-- Break-glass (docs/phase5-deploy.md §5 P4, ADR-0024).

-- name: GetBreakGlassSettings :one
SELECT s.*, coalesce(u.display_name, '')::text AS updated_by_name, coalesce(u.email, '')::text AS updated_by_email
FROM break_glass_settings s
LEFT JOIN users u ON u.id = s.updated_by;

-- name: LockBreakGlassSettings :one
SELECT * FROM break_glass_settings FOR UPDATE;

-- name: SetBreakGlassSettings :exec
UPDATE break_glass_settings
SET approval_required = @approval_required, max_duration_minutes = @max_duration_minutes,
    approval_timeout_minutes = @approval_timeout_minutes,
    updated_by = @updated_by, revision = revision + 1, updated_at = now();

-- name: InsertBreakGlassSession :one
INSERT INTO break_glass_sessions (
    team_id, requested_by, reason, scopes, duration_minutes, status, requested_at,
    approval_deadline, started_at, expires_at
) VALUES (
    @team_id, @requested_by, @reason, @scopes, @duration_minutes, @status, @requested_at,
    @approval_deadline, @started_at, @expires_at
)
RETURNING *;

-- name: LockBreakGlassSession :one
SELECT * FROM break_glass_sessions WHERE id = $1 FOR UPDATE;

-- name: ApproveBreakGlassSession :one
UPDATE break_glass_sessions
SET status = 'active', decided_by = @decided_by, decided_at = @now, started_at = @now, expires_at = @expires_at,
    approval_deadline = NULL
WHERE id = @id AND status = 'pending'
RETURNING *;

-- name: CloseBreakGlassSession :one
-- Denies, cancels, ends or expires a session (the caller checked the move).
UPDATE break_glass_sessions
SET status = @status,
    decided_by = coalesce(sqlc.narg(decided_by)::uuid, decided_by),
    decided_at = CASE WHEN sqlc.narg(decided_by)::uuid IS NULL THEN decided_at ELSE @now END,
    decision_note = coalesce(sqlc.narg(decision_note)::text, decision_note),
    ended_by = sqlc.narg(ended_by)::uuid,
    ended_at = @now,
    approval_deadline = NULL
WHERE id = @id AND status IN ('pending', 'active')
RETURNING *;

-- name: DueBreakGlassSessions :many
-- Open sessions past their end or approval deadline, locked for the sweep
-- (another process sweeping at the same time skips them).
SELECT * FROM break_glass_sessions
WHERE (status = 'active' AND expires_at <= @now) OR (status = 'pending' AND approval_deadline <= @now)
ORDER BY requested_at
LIMIT 100
FOR UPDATE SKIP LOCKED;

-- name: ActiveBreakGlassGrant :one
-- The admin's active session for a team, checked on every content read.
SELECT id, team_id, requested_by, scopes, status, started_at, expires_at
FROM break_glass_sessions
WHERE requested_by = @admin_id AND team_id = @team_id AND status = 'active';

-- name: GetBreakGlassSession :one
SELECT sqlc.embed(b), t.slug AS team_slug, t.name AS team_name,
       coalesce(ru.display_name, '')::text AS requested_by_name, coalesce(ru.email, '')::text AS requested_by_email,
       coalesce(du.display_name, '')::text AS decided_by_name, coalesce(du.email, '')::text AS decided_by_email,
       coalesce(eu.display_name, '')::text AS ended_by_name, coalesce(eu.email, '')::text AS ended_by_email
FROM break_glass_sessions b
JOIN teams t ON t.id = b.team_id
JOIN users ru ON ru.id = b.requested_by
LEFT JOIN users du ON du.id = b.decided_by
LEFT JOIN users eu ON eu.id = b.ended_by
WHERE b.id = $1;

-- name: ListBreakGlassSessions :many
-- Sessions newest first. open: pending and active only; closed: the rest.
-- requested_by and team_id narrow the list.
SELECT sqlc.embed(b), t.slug AS team_slug, t.name AS team_name,
       coalesce(ru.display_name, '')::text AS requested_by_name, coalesce(ru.email, '')::text AS requested_by_email,
       coalesce(du.display_name, '')::text AS decided_by_name, coalesce(du.email, '')::text AS decided_by_email,
       coalesce(eu.display_name, '')::text AS ended_by_name, coalesce(eu.email, '')::text AS ended_by_email
FROM break_glass_sessions b
JOIN teams t ON t.id = b.team_id
JOIN users ru ON ru.id = b.requested_by
LEFT JOIN users du ON du.id = b.decided_by
LEFT JOIN users eu ON eu.id = b.ended_by
WHERE (sqlc.narg(open)::boolean IS NULL OR (b.status IN ('pending', 'active')) = sqlc.narg(open)::boolean)
  AND (sqlc.narg(requested_by)::uuid IS NULL OR b.requested_by = sqlc.narg(requested_by)::uuid)
  AND (sqlc.narg(team_id)::uuid IS NULL OR b.team_id = sqlc.narg(team_id)::uuid)
  AND (sqlc.narg(before_requested)::timestamptz IS NULL
       OR (b.requested_at, b.id) < (sqlc.narg(before_requested)::timestamptz, sqlc.narg(before_id)::uuid))
ORDER BY b.requested_at DESC, b.id DESC
LIMIT @page_size;

-- name: BreakGlassReadCounts :many
-- What a session read, by kind: every read and the distinct targets.
SELECT (metadata->>'kind')::text AS kind, count(*)::bigint AS reads, count(DISTINCT target_id)::bigint AS targets
FROM audit_log
WHERE action = 'breakglass.read' AND metadata->>'sessionId' = @session_id::text
GROUP BY 1
ORDER BY 1;

-- name: ListBreakGlassReads :many
-- A session's read log, newest first. Documents and sources are named (their
-- names are what the team shows its members); conversations never are.
SELECT a.id, a.occurred_at, a.target_type, a.target_id, (a.metadata->>'kind')::text AS kind,
       coalesce(CASE a.target_type
           WHEN 'document' THEN (SELECT coalesce(nullif(d.title, ''), nullif(d.filename, ''), d.url) FROM documents d
                                 WHERE a.target_id ~* '^[0-9a-f-]{36}$' AND d.id = a.target_id::uuid)
           WHEN 'data_source' THEN (SELECT s.name FROM data_sources s WHERE a.target_id ~* '^[0-9a-f-]{36}$' AND s.id = a.target_id::uuid)
           WHEN 'team' THEN (SELECT t.name FROM teams t WHERE a.target_id ~* '^[0-9a-f-]{36}$' AND t.id = a.target_id::uuid)
       END, '')::text AS target_label
FROM audit_log a
WHERE a.action = 'breakglass.read' AND a.metadata->>'sessionId' = @session_id::text
  AND (sqlc.narg(before_id)::bigint IS NULL OR a.id < sqlc.narg(before_id)::bigint)
ORDER BY a.id DESC
LIMIT @page_size;

-- name: ListTeamConversations :many
-- A team's conversations (with its agents, by anyone), most recent first:
-- read under a break-glass session only. No user identity.
SELECT c.id, c.agent_id, a.name AS agent_name, a.slug AS agent_slug, t.slug AS team_slug,
       (a.deleted_at IS NOT NULL)::bool AS agent_deleted, c.title, c.anonymous, c.created_at, c.updated_at,
       (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')::bigint AS questions
FROM conversations c
JOIN agents a ON a.id = c.agent_id
JOIN teams t ON t.id = a.team_id
WHERE a.team_id = @team_id AND c.deleted_at IS NULL
  AND (sqlc.narg(agent_id)::uuid IS NULL OR c.agent_id = sqlc.narg(agent_id)::uuid)
  AND (sqlc.narg(before_updated)::timestamptz IS NULL
       OR (c.updated_at, c.id) < (sqlc.narg(before_updated)::timestamptz, sqlc.narg(before_id)::uuid))
ORDER BY c.updated_at DESC, c.id DESC
LIMIT @page_size;

-- name: ConversationTeam :one
-- The team whose agent a (not deleted) conversation is with.
SELECT a.team_id FROM conversations c JOIN agents a ON a.id = c.agent_id
WHERE c.id = $1 AND c.deleted_at IS NULL;
