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
    -- what a Test found about thinking off describes the settings it tested (#52)
    thinking_off_result = CASE WHEN compat IS DISTINCT FROM @compat OR upstream_model <> @upstream_model THEN NULL ELSE thinking_off_result END,
    thinking_off_checked_at = CASE WHEN compat IS DISTINCT FROM @compat OR upstream_model <> @upstream_model THEN NULL ELSE thinking_off_checked_at END,
    revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: SetModelThinkingOff :exec
-- What a Test found; not a change of the model, so its revision stays.
UPDATE models SET thinking_off_result = @result, thinking_off_checked_at = now() WHERE id = @id;

-- name: ClearModelThinkingOff :exec
UPDATE models SET thinking_off_result = NULL, thinking_off_checked_at = NULL WHERE id = @id;

-- name: DeleteModel :exec
DELETE FROM models WHERE id = $1;

-- name: CountModelProfiles :one
SELECT count(*) FROM embedding_profiles WHERE model_id = $1;

-- Real profiles: a candidate (a hidden copy made for an index preview) is in no list or picker.
-- name: ListEmbeddingProfiles :many
SELECT sqlc.embed(p), sqlc.embed(m)
FROM embedding_profiles p
JOIN models m ON m.id = p.model_id
WHERE p.candidate_of IS NULL
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
                                output_dimensions, default_vector_weight, default_keyword_weight, candidate_of, chunker_version, parent_tokens)
VALUES (@key, @name, @description, @model_id, @dimensions, @storage_type,
        @document_prefix, @query_prefix, @chunk_size, @chunk_overlap, @created_by,
        sqlc.narg(output_dimensions), sqlc.narg(default_vector_weight), sqlc.narg(default_keyword_weight), sqlc.narg(candidate_of), @chunker_version, @parent_tokens)
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

-- Real profiles (the first one becomes the default; a candidate does not count).
-- name: CountEmbeddingProfiles :one
SELECT count(*) FROM embedding_profiles WHERE candidate_of IS NULL;

-- name: LockModelConfig :exec
SELECT pg_advisory_xact_lock(7378431002);

-- A discarded index preview's hidden profile: retired, and still hidden (never deleted: it has migration history).
-- name: RetireCandidateProfile :exec
UPDATE embedding_profiles SET status = 'retired', revision = revision + 1, updated_at = now()
WHERE id = @id AND candidate_of IS NOT NULL AND status <> 'retired';

-- A switched index preview's profile becomes an ordinary one: a knowledge base uses it now.
-- name: PromoteCandidateProfile :exec
UPDATE embedding_profiles SET candidate_of = NULL, boilerplate_fuzzy = false, revision = revision + 1, updated_at = now()
WHERE id = @id AND candidate_of IS NOT NULL;

-- Discarded candidates whose vector table is still there and nothing holds any more: no passages, no set (the cleanup job
-- deleted them), and no migration that is still building or waiting.
-- name: DroppableCandidateProfiles :many
SELECT p.id FROM embedding_profiles p
WHERE p.candidate_of IS NOT NULL AND p.status = 'retired'
  AND to_regclass(format('public.emb_%s', replace(p.id::text, '-', ''))) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.profile_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM source_embedding_sets es WHERE es.profile_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM profile_migrations m WHERE m.to_profile_id = p.id AND m.status IN ('running', 'ready'))
ORDER BY p.id
LIMIT 20;

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

-- name: CountProfileMigrations :one
-- Profile migrations from or to a profile: deleting it would delete their
-- history (ON DELETE CASCADE), so it is retired instead (AD-15).
SELECT count(*)::bigint FROM profile_migrations
WHERE from_profile_id = @profile_id OR to_profile_id = @profile_id;
