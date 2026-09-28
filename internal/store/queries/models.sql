-- name: ListConnections :many
SELECT c.*, (SELECT count(*) FROM models m WHERE m.connection_id = c.id)::bigint AS model_count
FROM model_connections c
ORDER BY c.name;

-- name: GetConnection :one
SELECT * FROM model_connections WHERE id = $1;

-- name: LockConnection :one
SELECT * FROM model_connections WHERE id = $1 FOR UPDATE;

-- name: InsertConnection :one
INSERT INTO model_connections (id, name, description, base_url, api_key_ciphertext, api_key_hint, timeout_seconds, enabled, requests_per_minute,
                               max_concurrent_requests, created_by)
VALUES (@id, @name, @description, @base_url, @api_key_ciphertext, @api_key_hint, @timeout_seconds, @enabled, @requests_per_minute,
        @max_concurrent_requests, @created_by)
RETURNING *;

-- name: UpdateConnection :one
UPDATE model_connections
SET name = @name, description = @description, base_url = @base_url,
    api_key_ciphertext = @api_key_ciphertext, api_key_hint = @api_key_hint,
    timeout_seconds = @timeout_seconds, enabled = @enabled, requests_per_minute = @requests_per_minute,
    max_concurrent_requests = @max_concurrent_requests,
    revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: DeleteConnection :exec
DELETE FROM model_connections WHERE id = $1;

-- name: CountConnectionModels :one
SELECT count(*) FROM models WHERE connection_id = $1;

-- name: ListModels :many
SELECT * FROM models
WHERE (sqlc.narg(kind)::text IS NULL OR kind = sqlc.narg(kind)::text)
  AND (sqlc.narg(connection_id)::uuid IS NULL OR connection_id = sqlc.narg(connection_id)::uuid)
ORDER BY kind, display_name, key;

-- name: GetModel :one
SELECT * FROM models WHERE id = $1;

-- name: LockModel :one
SELECT * FROM models WHERE id = $1 FOR UPDATE;

-- name: InsertModel :one
INSERT INTO models (connection_id, key, upstream_model, display_name, description, kind, max_classification,
                    enabled, context_window, max_output_tokens, supports_tools, supports_vision,
                    dimensions, max_input_tokens, compat, moderation_provider, moderation_family,
                    moderation_timeout_seconds, created_by)
VALUES (@connection_id, @key, @upstream_model, @display_name, @description, @kind, @max_classification,
        @enabled, @context_window, @max_output_tokens, @supports_tools, @supports_vision,
        @dimensions, @max_input_tokens, @compat, @moderation_provider, @moderation_family,
        @moderation_timeout_seconds, @created_by)
RETURNING *;

-- name: UpdateModel :one
UPDATE models
SET upstream_model = @upstream_model, display_name = @display_name, description = @description,
    max_classification = @max_classification, enabled = @enabled,
    context_window = @context_window, max_output_tokens = @max_output_tokens,
    supports_tools = @supports_tools, supports_vision = @supports_vision,
    dimensions = @dimensions, max_input_tokens = @max_input_tokens, compat = @compat,
    moderation_provider = @moderation_provider, moderation_family = @moderation_family,
    moderation_timeout_seconds = @moderation_timeout_seconds,
    revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: DeleteModel :exec
DELETE FROM models WHERE id = $1;

-- name: CountModelProfiles :one
SELECT count(*) FROM embedding_profiles WHERE model_id = $1;

-- name: ListEmbeddingProfiles :many
SELECT sqlc.embed(p), sqlc.embed(m)
FROM embedding_profiles p
JOIN models m ON m.id = p.model_id
ORDER BY p.is_default DESC, p.name, p.key;

-- name: GetEmbeddingProfile :one
SELECT sqlc.embed(p), sqlc.embed(m)
FROM embedding_profiles p
JOIN models m ON m.id = p.model_id
WHERE p.id = $1;

-- name: LockEmbeddingProfile :one
SELECT * FROM embedding_profiles WHERE id = $1 FOR UPDATE;

-- name: InsertEmbeddingProfile :one
INSERT INTO embedding_profiles (key, name, description, model_id, dimensions, storage_type,
                                document_prefix, query_prefix, chunk_size, chunk_overlap, created_by,
                                output_dimensions, default_vector_weight, default_keyword_weight)
VALUES (@key, @name, @description, @model_id, @dimensions, @storage_type,
        @document_prefix, @query_prefix, @chunk_size, @chunk_overlap, @created_by,
        sqlc.narg(output_dimensions), sqlc.narg(default_vector_weight), sqlc.narg(default_keyword_weight))
RETURNING *;

-- name: UpdateEmbeddingProfile :one
UPDATE embedding_profiles
SET name = @name, description = @description, status = @status, is_default = @is_default,
    default_vector_weight = sqlc.narg(default_vector_weight), default_keyword_weight = sqlc.narg(default_keyword_weight),
    revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: ClearDefaultEmbeddingProfile :exec
UPDATE embedding_profiles
SET is_default = false, revision = revision + 1, updated_at = now()
WHERE is_default AND id <> @except_id;

-- name: CountEmbeddingProfiles :one
SELECT count(*) FROM embedding_profiles;

-- name: LockModelConfig :exec
SELECT pg_advisory_xact_lock(7378431002);

-- name: DeleteEmbeddingProfile :exec
DELETE FROM embedding_profiles WHERE id = $1;

-- Chat models teams may pick for agents: enabled, on an enabled connection.
-- name: ListUsableChatModels :many
SELECT m.* FROM models m
JOIN model_connections c ON c.id = m.connection_id
WHERE m.kind = 'chat' AND m.enabled AND c.enabled
ORDER BY m.display_name, m.key;

-- SystemOne models admins may choose (moderation providers, features):
-- enabled, on an enabled connection.
-- name: ListUsableSystemOneModels :many
SELECT m.* FROM models m
JOIN model_connections c ON c.id = m.connection_id
WHERE m.kind = 'systemone' AND m.enabled AND c.enabled
ORDER BY m.display_name, m.key;

-- name: ListUsableVisionModels :many
SELECT m.* FROM models m
JOIN model_connections c ON c.id = m.connection_id
WHERE m.kind = 'vision' AND m.enabled AND c.enabled
ORDER BY m.display_name, m.key;
