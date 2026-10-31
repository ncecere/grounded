-- name: GetAuditExportSettings :one
SELECT * FROM audit_export_settings WHERE singleton;
-- name: LockAuditExportSettings :one
SELECT * FROM audit_export_settings WHERE singleton FOR UPDATE;
-- name: UpdateAuditExportSettings :one
UPDATE audit_export_settings SET enabled= @enabled, coverage_start= @coverage_start, revision=revision+1 WHERE singleton RETURNING *;
-- name: ListAuditExportRequests :many
SELECT * FROM audit_export_requests ORDER BY day DESC LIMIT 100;
-- name: GetAuditExportRequest :one
SELECT * FROM audit_export_requests WHERE id= @id;
-- name: LatestAuditExportRequest :one
SELECT * FROM audit_export_requests ORDER BY day DESC LIMIT 1;
-- name: CreateAuditExportRequest :one
INSERT INTO audit_export_requests(id,day) VALUES (@id,@day) RETURNING *;
-- name: RetryAuditExportRequest :one
UPDATE audit_export_requests SET state='pending', revision=revision+1, failure_code='', created_at=now(), lease=NULL, lease_until=NULL
WHERE id= @id AND revision= @revision AND state='failed' RETURNING *;
-- name: ClaimAuditExportRequest :one
UPDATE audit_export_requests SET lease= @lease, lease_until=now()+interval '3 minutes'
WHERE id= @id AND state='pending' AND (lease_until IS NULL OR lease_until < now()) RETURNING *;
-- name: FinishAuditExportRequest :execrows
UPDATE audit_export_requests SET state= @state, failure_code= @failure_code, export_id=sqlc.narg(export_id), revision=revision+1,lease=NULL,lease_until=NULL
WHERE id= @id AND lease= @lease AND lease_until>now() AND state='pending';
-- name: ExpireAuditExportRequests :exec
UPDATE audit_export_requests SET state='failed', failure_code='job_aborted', revision=revision+1, lease=NULL, lease_until=NULL
WHERE state='pending' AND (lease_until < now() OR (lease_until IS NULL AND created_at < now()-interval '5 minutes'));
