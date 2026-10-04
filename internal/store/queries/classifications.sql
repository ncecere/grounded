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

-- name: ClassificationUsage :one
-- What refers to a level (AD-05: only an unused level can be deleted).
SELECT (SELECT count(*) FROM teams t WHERE t.max_classification = @key::text)::bigint AS teams,
       (SELECT count(*) FROM models m WHERE m.max_classification = @key::text)::bigint AS models,
       (SELECT count(*) FROM data_sources ds WHERE ds.classification = @key::text)::bigint AS sources,
       (SELECT count(*) FROM mcp_servers ms WHERE ms.max_classification = @key::text)::bigint AS mcp_servers;

-- name: DeleteClassification :exec
DELETE FROM classification_levels WHERE key = @key;
