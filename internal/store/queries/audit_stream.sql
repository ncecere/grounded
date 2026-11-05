-- Audit streaming (docs/specs/audit-streaming/DESIGN.md). Transaction IDs (xid8) travel as text.

-- name: GetAuditStreamSettings :one
SELECT * FROM audit_stream_settings WHERE singleton;

-- name: LockAuditStreamSettings :one
SELECT * FROM audit_stream_settings WHERE singleton FOR UPDATE;

-- name: SetAuditStreamSettings :one
UPDATE audit_stream_settings SET enabled = @enabled, revision = revision + 1, updated_by = @updated_by, updated_at = now()
WHERE singleton RETURNING *;

-- name: ListAuditStreamDestinations :many
SELECT id, name, kind, format, address, (auth_header IS NOT NULL)::boolean AS has_auth, ca_pem, enabled,
       (cursor_txid IS NOT NULL)::boolean AS started, sent_total, last_sent_at, last_error_class, failing_since, failures,
       next_attempt_at, revision, created_at, updated_at
FROM audit_stream_destinations ORDER BY created_at, id;

-- name: CountAuditStreamDestinations :one
SELECT count(*)::bigint FROM audit_stream_destinations;

-- name: GetAuditStreamDestination :one
SELECT id, name, kind, format, address, auth_header, ca_pem, enabled, coalesce(cursor_txid::text, '')::text AS cursor_txid, coalesce(cursor_id, 0)::bigint AS cursor_id,
       sent_total, last_sent_at, last_error_class, failing_since, failures, next_attempt_at, revision, created_at, updated_at
FROM audit_stream_destinations WHERE id = @id;

-- name: LockAuditStreamDestination :one
SELECT id, name, kind, format, address, auth_header, ca_pem, enabled, coalesce(cursor_txid::text, '')::text AS cursor_txid, coalesce(cursor_id, 0)::bigint AS cursor_id,
       sent_total, last_sent_at, last_error_class, failing_since, failures, next_attempt_at, revision, created_at, updated_at
FROM audit_stream_destinations WHERE id = @id FOR UPDATE;

-- name: InsertAuditStreamDestination :one
INSERT INTO audit_stream_destinations (name, kind, format, address, auth_header, ca_pem, created_by)
VALUES (@name, @kind, @format, @address, @auth_header, @ca_pem, @created_by)
RETURNING id;

-- name: UpdateAuditStreamDestination :exec
UPDATE audit_stream_destinations SET name = @name, format = @format, address = @address, auth_header = @auth_header, ca_pem = @ca_pem,
    revision = revision + 1, updated_at = now()
WHERE id = @id;

-- A destination switched on for the first time starts at the entries written from now on: its cursor is the oldest
-- transaction still running (every entry before it is finished), and the highest ID (nothing with that txid is sent twice).
-- name: SetAuditStreamDestinationEnabled :exec
UPDATE audit_stream_destinations SET enabled = @enabled, revision = revision + 1, updated_at = now(),
    failures = 0, failing_since = NULL, next_attempt_at = NULL, last_error_class = '',
    cursor_txid = CASE WHEN @enabled::boolean AND cursor_txid IS NULL THEN pg_snapshot_xmin(pg_current_snapshot()) ELSE cursor_txid END,
    cursor_id = CASE WHEN @enabled::boolean AND cursor_id IS NULL THEN 0 ELSE cursor_id END
WHERE id = @id;

-- name: DeleteAuditStreamDestination :execrows
DELETE FROM audit_stream_destinations WHERE id = @id;

-- Destinations due a delivery attempt (switched on, not backing off), while streaming is on.
-- name: DueAuditStreamDestinations :many
SELECT d.id FROM audit_stream_destinations d, audit_stream_settings s
WHERE s.singleton AND s.enabled AND d.enabled AND d.cursor_txid IS NOT NULL AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
ORDER BY d.id;

-- The next entries after a cursor, oldest transaction first, among finished transactions only. The cursor starts at the
-- oldest running transaction (inclusive, with id > cursor_id), so the bound is (txid, id) > (cursor_txid, cursor_id).
-- name: NextAuditStreamEntries :many
SELECT a.id, a.txid::text AS txid, a.occurred_at, a.actor_kind, a.actor_user_id, coalesce(u.email::text, '')::text AS actor_email,
       a.team_id, coalesce(t.slug, '')::text AS team_slug, a.action, a.target_type, a.target_id, a.request_id, a.client_ip,
       coalesce(a.metadata->>'apiKeyId', '')::text AS api_key_id
FROM audit_log a
LEFT JOIN users u ON u.id = a.actor_user_id
LEFT JOIN teams t ON t.id = a.team_id
WHERE a.txid IS NOT NULL
  AND (a.txid, a.id) > (sqlc.arg(cursor_txid)::text::xid8, sqlc.arg(cursor_id)::bigint)
  AND a.txid < pg_snapshot_xmin(pg_current_snapshot())
ORDER BY a.txid, a.id
LIMIT sqlc.arg(max_rows);

-- How far behind a destination is: the oldest committed entry it has not sent, including those held back because an older
-- transaction (in any database of the server) is still open, so a stalled stream shows as behind rather than idle.
-- name: AuditStreamOldestUnsent :one
SELECT coalesce(min(a.occurred_at), now())::timestamptz FROM audit_log a
WHERE a.txid IS NOT NULL AND (a.txid, a.id) > (sqlc.arg(cursor_txid)::text::xid8, sqlc.arg(cursor_id)::bigint);

-- name: AdvanceAuditStreamCursor :exec
UPDATE audit_stream_destinations SET cursor_txid = sqlc.arg(cursor_txid)::text::xid8, cursor_id = sqlc.arg(cursor_id)::bigint,
    sent_total = sent_total + sqlc.arg(sent)::bigint, last_sent_at = now(), failures = 0, failing_since = NULL,
    next_attempt_at = NULL, last_error_class = ''
WHERE id = sqlc.arg(id) AND enabled;

-- name: FailAuditStreamDestination :exec
UPDATE audit_stream_destinations SET failures = failures + 1, failing_since = coalesce(failing_since, now()),
    last_error_class = sqlc.arg(error_class), next_attempt_at = sqlc.arg(next_attempt_at)
WHERE id = sqlc.arg(id);

-- Destinations failing for longer than the given time (the admin overview's Needs attention).
-- name: FailingAuditStreamDestinations :many
SELECT id, name, failing_since::timestamptz AS failing_since, last_error_class FROM audit_stream_destinations
WHERE enabled AND failing_since IS NOT NULL AND failing_since < now() - sqlc.arg(after)::interval
ORDER BY failing_since;
