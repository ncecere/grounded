-- Maintenance mode (docs/phase5-deploy.md §5 P5).

-- name: GetMaintenance :one
SELECT m.*,
       coalesce(su.display_name, '')::text AS started_by_name, coalesce(su.email, '')::text AS started_by_email,
       coalesce(uu.display_name, '')::text AS updated_by_name, coalesce(uu.email, '')::text AS updated_by_email
FROM maintenance_mode m
LEFT JOIN users su ON su.id = m.started_by
LEFT JOIN users uu ON uu.id = m.updated_by;

-- name: LockMaintenance :one
SELECT * FROM maintenance_mode FOR UPDATE;

-- name: SetMaintenance :exec
UPDATE maintenance_mode
SET enabled = @enabled, reason = @reason, planned_end_at = @planned_end_at,
    started_by = @started_by, started_at = @started_at,
    updated_by = @updated_by, revision = revision + 1, updated_at = now();

-- A document whose job starts during maintenance goes back to pending (a
-- 'processing' one is a retry after a crash); the dispatcher queues it again
-- once maintenance ends.
-- name: ParkDocument :execrows
UPDATE documents SET status = 'pending', updated_at = now()
WHERE id = $1 AND status IN ('queued', 'processing');
