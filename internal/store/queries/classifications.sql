-- name: ListClassifications :many
SELECT * FROM classification_levels ORDER BY rank;

-- name: GetClassification :one
SELECT * FROM classification_levels WHERE key = $1;

-- name: InsertClassification :one
INSERT INTO classification_levels (key, name, description, rank, max_audience)
VALUES (@key, @name, @description, @rank, @max_audience)
RETURNING *;

-- name: UpdateClassification :one
UPDATE classification_levels
SET name         = @name,
    description  = @description,
    max_audience = @max_audience,
    anonymous_retention_hours = @retention_hours::int,
    conversation_retention_days = sqlc.narg(conversation_retention_days)::int,
    allowed_source_types = @allowed_source_types::text[],
    direct_retrieve = @direct_retrieve,
    revision     = revision + 1,
    updated_at   = now()
WHERE key = @key
RETURNING *;

-- name: LockClassificationConfig :exec
SELECT pg_advisory_xact_lock(7378431001);
