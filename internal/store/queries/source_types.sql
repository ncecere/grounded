-- name: ListSourceTypeSettings :many
SELECT * FROM source_type_settings ORDER BY type;

-- name: GetSourceTypeSetting :one
SELECT * FROM source_type_settings WHERE type = @type;

-- name: LockSourceTypeSetting :exec
-- Takes a lock for the type even before it has a row, so two changes are applied one after the other.
SELECT pg_advisory_xact_lock(hashtextextended('source_type:' || @type::text, 0));

-- name: SetSourceTypeSetting :one
INSERT INTO source_type_settings (type, enabled, updated_by) VALUES (@type, @enabled, @updated_by)
ON CONFLICT (type) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
RETURNING *;

-- name: CountSourcesByType :many
SELECT type, count(*)::bigint AS sources FROM data_sources GROUP BY type;
