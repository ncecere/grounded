-- Retention settings, runs and legal holds (migration 00027). The retention
-- rules themselves are SQL in internal/retention/rules.go: each kind's
-- candidate query serves both the dry-run report and the purge.

-- ---- settings ----------------------------------------------------------------------------

-- name: GetRetentionSettings :one
SELECT r.periods, r.revision, r.updated_at, r.updated_by,
       coalesce(u.display_name, '')::text AS updated_by_name, coalesce(u.email::text, '')::text AS updated_by_email
FROM retention_settings r
LEFT JOIN users u ON u.id = r.updated_by;

-- name: LockRetentionSettings :one
SELECT * FROM retention_settings FOR UPDATE;

-- name: SetRetentionPeriods :exec
UPDATE retention_settings
SET periods = @periods, revision = revision + 1, updated_by = @updated_by, updated_at = now();

-- ---- runs --------------------------------------------------------------------------------

-- name: InsertRetentionRun :one
INSERT INTO retention_runs (trigger, requested_by, kinds, status, started_at)
VALUES (@trigger, @requested_by, @kinds, @status, CASE WHEN @status::text = 'running' THEN now() END)
RETURNING *;

-- name: StartRetentionRun :one
UPDATE retention_runs SET status = 'running', started_at = now()
WHERE id = @id AND status = 'queued'
RETURNING *;

-- name: FinishRetentionRun :exec
UPDATE retention_runs SET status = @status, results = @results, error = @error, finished_at = now()
WHERE id = @id;

-- name: ListRetentionRuns :many
SELECT sqlc.embed(r), coalesce(u.display_name, '')::text AS requested_by_name, coalesce(u.email::text, '')::text AS requested_by_email
FROM retention_runs r
LEFT JOIN users u ON u.id = r.requested_by
ORDER BY r.created_at DESC, r.id DESC
LIMIT @page_size;

-- Runs are kept for 90 days; runs that deleted nothing, 7 days.
-- name: PruneRetentionRuns :execrows
DELETE FROM retention_runs
WHERE status IN ('ok', 'error')
  AND (created_at < now() - interval '90 days'
       OR (created_at < now() - interval '7 days' AND status = 'ok' AND trigger = 'schedule'
           AND NOT jsonb_path_exists(results, '$.*.deleted ? (@ > 0)')));

-- Queued runs whose job never ran (for example, the job was lost with a
-- database restore) are failed after a day, so the list doesn't show them
-- as waiting forever.
-- name: FailStaleRetentionRuns :execrows
UPDATE retention_runs SET status = 'error', error = 'The run did not start', finished_at = now()
WHERE status IN ('queued', 'running') AND created_at < now() - interval '1 day';

-- ---- legal holds -------------------------------------------------------------------------

-- name: InsertLegalHold :one
INSERT INTO legal_holds (scope_type, scope_id, scope_label, reason, covers_from, covers_to, created_by)
VALUES (@scope_type, @scope_id, @scope_label, @reason, @covers_from, @covers_to, @created_by)
RETURNING *;

-- name: LockLegalHold :one
SELECT * FROM legal_holds WHERE id = $1 FOR UPDATE;

-- name: ReleaseLegalHold :one
UPDATE legal_holds SET released_at = now(), released_by = @released_by, release_reason = @release_reason
WHERE id = @id AND released_at IS NULL
RETURNING *;

-- A page of holds, newest first, with who placed and released them and how
-- many conversations each covers (all, and those their users deleted, which
-- the hold keeps hidden but stored). status: active, released or all.
-- name: ListLegalHolds :many
SELECT h.*,
       coalesce(cu.display_name, '')::text AS created_by_name, coalesce(cu.email::text, '')::text AS created_by_email,
       coalesce(ru.display_name, '')::text AS released_by_name, coalesce(ru.email::text, '')::text AS released_by_email,
       cov.conversations, cov.deleted_conversations,
       coalesce(CASE h.scope_type
           WHEN 'user' THEN (SELECT coalesce(nullif(x.display_name, ''), x.email::text) FROM users x WHERE x.id = h.scope_id)
           WHEN 'team' THEN (SELECT t.name FROM teams t WHERE t.id = h.scope_id)
           WHEN 'agent' THEN (SELECT ag.name FROM agents ag WHERE ag.id = h.scope_id)
           WHEN 'conversation' THEN (SELECT 'Conversation' FROM conversations c WHERE c.id = h.scope_id)
       END, '')::text AS live_label,
       coalesce(CASE h.scope_type
           WHEN 'agent' THEN (SELECT t.name FROM agents ag JOIN teams t ON t.id = ag.team_id WHERE ag.id = h.scope_id)
           WHEN 'conversation' THEN (SELECT ag.name FROM conversations c JOIN agents ag ON ag.id = c.agent_id WHERE c.id = h.scope_id)
       END, '')::text AS scope_context
FROM legal_holds h
LEFT JOIN users cu ON cu.id = h.created_by
LEFT JOIN users ru ON ru.id = h.released_by
CROSS JOIN LATERAL (
    SELECT count(*)::bigint AS conversations,
           count(*) FILTER (WHERE c.deleted_at IS NOT NULL)::bigint AS deleted_conversations
    FROM conversations c
    JOIN agents a ON a.id = c.agent_id
    WHERE h.scope_id IN (c.id, c.agent_id, a.team_id, c.user_id)
      AND (h.covers_from IS NULL OR c.updated_at >= h.covers_from)
      AND (h.covers_to IS NULL OR c.created_at < h.covers_to)
) cov
WHERE (sqlc.narg(id)::uuid IS NULL OR h.id = sqlc.narg(id)::uuid)
  AND (@status::text = 'all' OR (@status::text = 'active') = (h.released_at IS NULL))
ORDER BY h.created_at DESC, h.id DESC
LIMIT @page_size;

-- name: CountActiveLegalHolds :one
SELECT count(*) FROM legal_holds WHERE released_at IS NULL;

-- ---- scope lookups -----------------------------------------------------------------------

-- name: LegalHoldUser :one
SELECT id, coalesce(nullif(display_name, ''), email::text)::text AS label
FROM users WHERE id = sqlc.narg(id)::uuid OR lower(email::text) = lower(sqlc.narg(email)::text)
LIMIT 1;

-- name: LegalHoldTeam :one
SELECT id, name AS label FROM teams WHERE id = sqlc.narg(id)::uuid OR slug = sqlc.narg(slug)::text LIMIT 1;

-- name: LegalHoldAgent :one
SELECT a.id, (a.name || ' (' || t.name || ')')::text AS label
FROM agents a JOIN teams t ON t.id = a.team_id
WHERE a.id = sqlc.narg(id)::uuid OR (t.slug = sqlc.narg(team_slug)::text AND a.slug = sqlc.narg(agent_slug)::text)
ORDER BY a.deleted_at IS NULL DESC
LIMIT 1;

-- name: LegalHoldConversation :one
SELECT c.id, ('Conversation with ' || a.name)::text AS label
FROM conversations c JOIN agents a ON a.id = c.agent_id
WHERE c.id = $1;

-- ---- deleted files -----------------------------------------------------------------------

-- name: InsertDeletedFiles :exec
INSERT INTO deleted_files (team_id, source_id, document_id, prefix, content_from)
VALUES (@team_id, @source_id, @document_id, @prefix, @content_from);

-- name: DeleteDeletedFiles :execrows
DELETE FROM deleted_files WHERE id = ANY(@ids::uuid[]);
