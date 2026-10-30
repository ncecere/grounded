-- Contextual chunks (docs/contextual-chunks.md, ADR-0028, internal/contextual). Nothing here reads or writes chunks.

-- ---- settings -------------------------------------------------------------------

-- name: GetSourceContextual :one
SELECT * FROM source_contextual WHERE source_id = $1;

-- A source's row exists from its first save: lock it for the revision check.
-- name: EnsureSourceContextual :exec
INSERT INTO source_contextual (source_id) VALUES ($1) ON CONFLICT (source_id) DO NOTHING;

-- name: LockSourceContextual :one
SELECT * FROM source_contextual WHERE source_id = $1 FOR UPDATE;

-- name: UpdateSourceContextual :one
UPDATE source_contextual
SET enabled = @enabled, model_id = sqlc.narg(model_id), failure_policy = @failure_policy,
    max_calls = @max_calls, max_calls_per_day = @max_calls_per_day,
    revision = revision + 1, updated_by = sqlc.narg(updated_by), updated_at = now()
WHERE source_id = @source_id
RETURNING *;

-- The sources of a knowledge base that opted in, with their settings, for a set that is about to start.
-- name: KBContextualSources :many
SELECT s.id AS source_id, s.name, s.classification, s.team_id, s.embedding_profile_id,
       sc.model_id, sc.failure_policy
FROM kb_sources ks
JOIN data_sources s ON s.id = ks.source_id
JOIN source_contextual sc ON sc.source_id = s.id AND sc.enabled AND sc.model_id IS NOT NULL
WHERE ks.kb_id = $1
ORDER BY lower(s.name), s.id;

-- name: InsertSetContextual :exec
INSERT INTO set_contextual (source_id, profile_id, model_id, failure_policy, prompt_version)
VALUES (@source_id, @profile_id, @model_id, @failure_policy, @prompt_version)
ON CONFLICT (source_id, profile_id) DO NOTHING;

-- name: GetSetContextual :one
SELECT * FROM set_contextual WHERE source_id = @source_id AND profile_id = @profile_id;

-- name: DeleteSetContextual :exec
DELETE FROM set_contextual WHERE source_id = @source_id AND profile_id = @profile_id;

-- name: DeleteSetDocumentContextual :exec
DELETE FROM document_contextual WHERE source_id = @source_id AND profile_id = @profile_id;

-- name: SetProfileContextual :exec
UPDATE embedding_profiles SET contextual = @contextual WHERE id = @id;

-- Whether any set of the source still uses context (a snapshot of a profile some KB or migration needs).
-- name: SourceHasContextualSets :one
SELECT EXISTS (SELECT 1 FROM set_contextual WHERE source_id = $1);

-- ---- the cache ------------------------------------------------------------------

-- name: ContextualCacheFor :many
SELECT key, context FROM contextual_cache WHERE document_id = @document_id AND key = ANY(@keys::bytea[]);

-- name: InsertContextualCache :exec
INSERT INTO contextual_cache (document_id, key, source_id, context, tokens_in, tokens_out)
VALUES (@document_id, @key, @source_id, @context, sqlc.narg(tokens_in), sqlc.narg(tokens_out))
ON CONFLICT (document_id, key) DO NOTHING;

-- What a document no longer needs: every key but those its sections have now.
-- name: PruneContextualCache :execrows
DELETE FROM contextual_cache WHERE document_id = @document_id AND NOT (key = ANY(@keep::bytea[]));

-- name: DeleteSourceContextualCache :execrows
DELETE FROM contextual_cache WHERE source_id = $1;

-- name: CountSourceContextualCache :one
SELECT count(*)::bigint FROM contextual_cache WHERE source_id = $1;

-- ---- attempts (the ledger of calls) -----------------------------------------------

-- Serialises the cap check and the reservation of one source's calls (short transactions).
-- name: LockContextualCalls :exec
SELECT pg_advisory_xact_lock(hashtextextended('grounded.contextual_calls:' || @source_id::text, 0));

-- Attempts that count against a cap: a build's (this set) or today's live ones (this source).
-- name: CountContextualAttempts :one
SELECT count(*)::bigint FROM contextual_calls
WHERE source_id = @source_id
  AND ((@phase::text = 'build' AND phase = 'build' AND profile_id = @profile_id)
    OR (@phase::text = 'live' AND phase = 'live' AND created_at >= @since::timestamptz));

-- name: InsertContextualCall :one
INSERT INTO contextual_calls (source_id, profile_id, document_id, model_id, phase)
VALUES (@source_id, @profile_id, sqlc.narg(document_id), @model_id, @phase)
RETURNING id;

-- Only the winner of the started -> terminal transition may append usage.
-- Retrying a settlement must not change its outcome, timestamp or ledger.
-- name: SettleContextualCall :execrows
UPDATE contextual_calls
SET outcome = @outcome, tokens_in = sqlc.narg(tokens_in), tokens_out = sqlc.narg(tokens_out), finished_at = now()
WHERE id = @id AND outcome = 'started' AND finished_at IS NULL;

-- A request the gateway refused for load was not an attempt.
-- name: DeleteContextualCall :exec
DELETE FROM contextual_calls WHERE id = $1 AND outcome = 'started';

-- A set's attempts, for the migration page and the source's state.
-- name: ContextualCallStats :one
SELECT count(*)::bigint AS attempts,
       count(*) FILTER (WHERE outcome = 'ok')::bigint AS ok,
       count(*) FILTER (WHERE outcome IN ('refused', 'invalid'))::bigint AS unusable,
       count(*) FILTER (WHERE outcome IN ('error', 'timeout', 'cancelled', 'started'))::bigint AS unknown,
       coalesce(sum(tokens_in), 0)::bigint AS tokens_in,
       coalesce(sum(tokens_out), 0)::bigint AS tokens_out
FROM contextual_calls
WHERE source_id = @source_id AND (sqlc.narg(profile_id)::uuid IS NULL OR profile_id = sqlc.narg(profile_id)::uuid);

-- ---- marks ------------------------------------------------------------------------

-- name: UpsertDocumentContextual :exec
INSERT INTO document_contextual (document_id, profile_id, source_id, version, state, code, passages, contextual)
VALUES (@document_id, @profile_id, @source_id, @version, @state, @code, @passages, @contextual)
ON CONFLICT (document_id, profile_id) DO UPDATE
SET version = EXCLUDED.version, state = EXCLUDED.state, code = EXCLUDED.code, passages = EXCLUDED.passages,
    contextual = EXCLUDED.contextual, updated_at = now();

-- name: DeleteDocumentContextualMark :exec
DELETE FROM document_contextual WHERE document_id = @document_id AND profile_id = @profile_id;

-- How a set's documents were embedded.
-- name: ContextualMarkCounts :many
SELECT dc.state, count(*)::bigint AS documents, coalesce(sum(dc.passages), 0)::bigint AS passages,
       coalesce(sum(dc.contextual), 0)::bigint AS contextual
FROM document_contextual dc
JOIN documents d ON d.id = dc.document_id AND d.version = dc.version
WHERE dc.source_id = @source_id AND dc.profile_id = @profile_id
GROUP BY dc.state;

-- The profiles a source was snapshotted for, oldest first.
-- name: ListSetContextualFor :many
SELECT sc.profile_id, p.key AS profile_key
FROM set_contextual sc JOIN embedding_profiles p ON p.id = sc.profile_id
WHERE sc.source_id = $1
ORDER BY sc.created_at, sc.profile_id;

-- The sources of a knowledge base that have context in the sets of a profile.
-- name: KBSetContextual :many
SELECT sc.source_id, s.name, sc.model_id, sc.failure_policy
FROM set_contextual sc
JOIN kb_sources ks ON ks.source_id = sc.source_id AND ks.kb_id = @kb_id
JOIN data_sources s ON s.id = sc.source_id
WHERE sc.profile_id = @profile_id
ORDER BY lower(s.name), s.id;
