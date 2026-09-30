-- name: InsertHealthCheck :one
-- status_since carries the current streak forward: the previous check's
-- status_since when the status is unchanged, otherwise this check's time.
INSERT INTO health_checks (subject_kind, subject_id, status, latency_ms, error_class, http_status, message, trigger, triggered_by, checked_at, status_since)
SELECT @subject_kind, @subject_id, @status, @latency_ms, sqlc.narg(error_class), sqlc.narg(http_status)::integer, @message, @trigger, sqlc.narg(triggered_by), @checked_at::timestamptz,
       COALESCE((SELECT CASE WHEN p.status = @status THEN p.status_since END
                 FROM health_checks p
                 WHERE p.subject_kind = @subject_kind AND p.subject_id = @subject_id
                 ORDER BY p.checked_at DESC, p.id DESC
                 LIMIT 1), @checked_at::timestamptz)
RETURNING *;

-- name: LatestHealthChecks :many
-- The latest check of every existing subject (subjects never checked are
-- absent), with the subject's name and whether it is enabled.
SELECT s.name AS subject_name, s.enabled AS subject_enabled, h.*
FROM health_subjects s
CROSS JOIN LATERAL (
    SELECT * FROM health_checks c
    WHERE c.subject_kind = s.subject_kind AND c.subject_id = s.subject_id
    ORDER BY c.checked_at DESC, c.id DESC
    LIMIT 1
) h
WHERE sqlc.narg(kind)::text IS NULL OR s.subject_kind = sqlc.narg(kind)::text
ORDER BY s.subject_kind, s.name, s.subject_id;

-- name: HealthSubjectExists :one
SELECT EXISTS (SELECT 1 FROM health_subjects WHERE subject_kind = @subject_kind AND subject_id = @subject_id);

-- name: HealthCheckHistory :many
-- A subject's checks, newest first.
SELECT * FROM health_checks
WHERE subject_kind = @subject_kind AND subject_id = @subject_id
ORDER BY checked_at DESC, id DESC
LIMIT @max_rows;

-- name: PruneHealthChecks :execrows
-- Removes checks older than the cutoff, except each subject's latest, and
-- every check of a subject that no longer exists.
DELETE FROM health_checks h
WHERE NOT EXISTS (SELECT 1 FROM health_subjects s WHERE s.subject_kind = h.subject_kind AND s.subject_id = h.subject_id)
   OR (h.checked_at < @cutoff::timestamptz
       AND EXISTS (SELECT 1 FROM health_checks n
                   WHERE n.subject_kind = h.subject_kind AND n.subject_id = h.subject_id
                     AND (n.checked_at, n.id) > (h.checked_at, h.id)));

