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
INSERT INTO audit_exports (id, day, coverage_start, snapshot_at, watermark, previous_hash)
VALUES (@id, @day, @coverage_start, @snapshot_at, @watermark, @previous_hash);

-- name: FreezeAuditExportPage :many
INSERT INTO audit_export_facts (export_id, source_id, occurred_at, actor_kind, actor_user_id, team_id, action, target_type, target_id)
SELECT @export_id, a.id, a.occurred_at, a.actor_kind, a.actor_user_id, a.team_id,
       CASE WHEN a.action ~ '^[a-z_]{1,64}\.[a-z_]{1,64}$' THEN a.action ELSE 'redacted' END,
       CASE WHEN a.target_type ~ '^[a-z_]{1,64}$' THEN a.target_type ELSE 'redacted' END,
       CASE WHEN a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN lower(a.target_id) ELSE '' END
FROM audit_log a
WHERE a.id > @after_id AND a.id <= @watermark AND a.occurred_at >= @coverage_start AND a.occurred_at < @day_end
AND NOT EXISTS (SELECT 1 FROM audit_export_facts f WHERE f.source_id = a.id)
ORDER BY a.id LIMIT 256
RETURNING source_id;

-- name: ReadAuditExportPage :many
SELECT * FROM audit_export_facts WHERE export_id = @export_id AND source_id > @after_id ORDER BY source_id LIMIT 256;

-- name: PublishAuditExport :execrows
WITH ready AS MATERIALIZED (
 SELECT object_key FROM audit_export_uploads
 WHERE object_key = @object_key AND NOT deleting AND expires_at > clock_timestamp() FOR UPDATE
)
UPDATE audit_exports SET state = 'completed', object_key = @object_key,
    envelope = @envelope, envelope_hash = @envelope_hash
WHERE id = @id AND state = 'pending'
AND EXISTS (SELECT 1 FROM ready);

-- name: JournalAuditExportUpload :exec
INSERT INTO audit_export_uploads(object_key) VALUES (@object_key);
-- name: ExpiredAuditExportUploads :many
WITH candidates AS MATERIALIZED (
 SELECT u.object_key FROM audit_export_uploads u
 WHERE u.expires_at < clock_timestamp()
 AND NOT EXISTS (SELECT 1 FROM audit_exports e WHERE e.object_key=u.object_key)
 ORDER BY u.expires_at LIMIT 10 FOR UPDATE SKIP LOCKED
)
UPDATE audit_export_uploads SET deleting=true
WHERE object_key IN (SELECT object_key FROM candidates) RETURNING object_key;
-- name: ForgetAuditExportUpload :exec
DELETE FROM audit_export_uploads WHERE object_key = @object_key;

-- name: CountAuditExportCandidates :one
SELECT count(*)::bigint FROM (
 SELECT a.id FROM audit_log a
 WHERE a.id <= @watermark AND a.occurred_at >= @coverage_start AND a.occurred_at < @day_end
 AND NOT EXISTS (SELECT 1 FROM audit_export_facts f WHERE f.source_id=a.id)
 LIMIT 100001
) candidates;

-- External copies (docs/signed-daily-audit-export.md, "External copy"): completed exports not yet copied, oldest day first,
-- that are not backing off.
-- name: DueAuditExportCopies :many
SELECT id, day FROM audit_exports
WHERE state = 'completed' AND copied_at IS NULL AND (copy_next_at IS NULL OR copy_next_at <= now())
ORDER BY day LIMIT @max_rows;

-- name: MarkAuditExportCopied :exec
UPDATE audit_exports SET copied_at = now(), copy_error_class = '', copy_failures = 0, copy_next_at = NULL WHERE id = @id;

-- name: FailAuditExportCopy :exec
UPDATE audit_exports SET copy_error_class = @error_class, copy_failures = copy_failures + 1, copy_next_at = @next_at WHERE id = @id;

-- Exports whose copy has been failing for a while (Needs attention), oldest first.
-- name: FailingAuditExportCopies :many
SELECT day, copy_error_class FROM audit_exports
WHERE state = 'completed' AND copied_at IS NULL AND copy_failures >= @min_failures ORDER BY day;
