-- name: LockAuditExports :exec
SELECT pg_advisory_xact_lock(7260390034);

-- name: GetAuditExportByDay :one
SELECT * FROM audit_exports WHERE day = @day;

-- name: GetAuditExport :one
SELECT * FROM audit_exports WHERE id = @id;

-- name: LatestAuditExport :one
SELECT * FROM audit_exports ORDER BY day DESC LIMIT 1;

-- name: AuditExportSnapshot :one
SELECT now()::timestamptz AS snapshot_at, COALESCE(max(id), 0)::bigint AS watermark FROM audit_log;

-- name: CreateAuditExport :exec
INSERT INTO audit_exports (id, day, snapshot_at, watermark, previous_hash)
VALUES (@id, @day, @snapshot_at, @watermark, @previous_hash);

-- name: FreezeAuditExportPage :many
INSERT INTO audit_export_facts (export_id, source_id, occurred_at, actor_kind, actor_user_id, team_id, action, target_type, target_id)
SELECT @export_id, a.id, a.occurred_at, a.actor_kind, a.actor_user_id, a.team_id,
       CASE WHEN a.action ~ '^[a-z_]{1,64}\.[a-z_]{1,64}$' THEN a.action ELSE 'redacted' END,
       CASE WHEN a.target_type ~ '^[a-z_]{1,64}$' THEN a.target_type ELSE 'redacted' END,
       CASE WHEN a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN lower(a.target_id) ELSE '' END
FROM audit_log a
WHERE a.id > @after_id AND a.id <= @watermark AND a.occurred_at >= @day_start AND a.occurred_at < @day_end
ORDER BY a.id LIMIT 256
RETURNING source_id;

-- name: ReadAuditExportPage :many
SELECT * FROM audit_export_facts WHERE export_id = @export_id AND source_id > @after_id ORDER BY source_id LIMIT 256;

-- name: PublishAuditExport :execrows
UPDATE audit_exports SET state = 'completed', object_key = @object_key,
    envelope = @envelope, envelope_hash = @envelope_hash
WHERE id = @id AND state = 'pending';
