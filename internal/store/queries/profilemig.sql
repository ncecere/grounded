-- Embedding profile migration (docs/phase5-deploy.md §5 P2, ADR-0007).

-- ---- embedding sets: a source's chunks and vectors for one profile ------------

-- Every profile a source is embedded with: its own, then its extra sets.
-- name: SourceEmbeddingProfiles :many
SELECT embedding_profile_id AS profile_id FROM data_sources WHERE id = @source_id
UNION
SELECT profile_id FROM source_embedding_sets WHERE source_id = @source_id AND status <> 'deleting';

-- name: GetEmbeddingSet :one
SELECT * FROM source_embedding_sets WHERE source_id = @source_id AND profile_id = @profile_id;

-- name: InsertEmbeddingSet :execrows
INSERT INTO source_embedding_sets (source_id, profile_id, status, ready_at)
VALUES (@source_id, @profile_id, @status, CASE WHEN @status::text = 'ready' THEN now() END)
ON CONFLICT (source_id, profile_id) DO UPDATE SET status = 'building', ready_at = NULL, updated_at = now()
WHERE source_embedding_sets.status = 'deleting';

-- Share-locks a set while a document's chunks are written to it (the
-- cleanup job marks it deleting first).
-- name: LockEmbeddingSetShared :one
SELECT status FROM source_embedding_sets WHERE source_id = @source_id AND profile_id = @profile_id FOR SHARE;

-- name: LockSourceProfileShared :one
SELECT embedding_profile_id FROM data_sources WHERE id = $1 FOR SHARE;

-- name: MarkEmbeddingSetDeleting :exec
UPDATE source_embedding_sets SET status = 'deleting', updated_at = now()
WHERE source_id = @source_id AND profile_id = @profile_id;

-- name: EmbeddingSetStatus :one
SELECT status FROM source_embedding_sets WHERE source_id = @source_id AND profile_id = @profile_id;

-- Serialises changes to migrations and embedding sets (start, cancel,
-- switch, switch back, attach, cleanup): they are rare.
-- name: LockProfileMigrations :exec
SELECT pg_advisory_xact_lock(hashtext('grounded.profile_migrations'));

-- name: MarkEmbeddingSetReady :exec
UPDATE source_embedding_sets SET status = 'ready', ready_at = coalesce(ready_at, now()), last_error = '', updated_at = now()
WHERE source_id = @source_id AND profile_id = @profile_id AND status = 'building';

-- name: SetEmbeddingSetError :exec
UPDATE source_embedding_sets SET last_error = @last_error, updated_at = now()
WHERE source_id = @source_id AND profile_id = @profile_id AND last_error <> @last_error;

-- name: DeleteEmbeddingSet :exec
DELETE FROM source_embedding_sets WHERE source_id = @source_id AND profile_id = @profile_id AND status = 'deleting';

-- The source's own profile moved to this set's profile: the set is now its
-- own chunks (no row).
-- name: DropEmbeddingSetRow :exec
DELETE FROM source_embedding_sets WHERE source_id = @source_id AND profile_id = @profile_id;

-- Every set, and the own profile of each source that has sets (a document
-- committed for the old profile just as a migration switched is embedded
-- for the new one).
-- name: ListEmbeddingSets :many
SELECT es.source_id, es.profile_id FROM source_embedding_sets es WHERE es.status <> 'deleting'
UNION
SELECT s.id, s.embedding_profile_id FROM data_sources s
WHERE EXISTS (SELECT 1 FROM source_embedding_sets es WHERE es.source_id = s.id);

-- Ready documents of a source without chunks for the profile, and not
-- waiting after a failure of their current version.
-- name: PendingSetDocuments :many
SELECT d.id, d.version, d.title, d.filename, d.external_id, d.blob_key, d.team_id, d.uploaded_by
FROM documents d
WHERE d.source_id = @source_id AND d.status = 'ready'
  AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id AND c.profile_id = @profile_id)
  AND NOT EXISTS (SELECT 1 FROM embedding_set_failures f WHERE f.document_id = d.id AND f.profile_id = @profile_id
                  AND f.version = d.version AND (f.permanent OR f.retry_after > now()))
ORDER BY d.id
LIMIT @max_rows;

-- A set's progress over the source's ready documents.
-- name: EmbeddingSetProgress :one
SELECT count(*)::bigint AS documents,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id AND c.profile_id = @profile_id))::bigint AS done,
       count(*) FILTER (WHERE f.permanent AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id AND c.profile_id = @profile_id))::bigint AS failed,
       count(*) FILTER (WHERE f.document_id IS NOT NULL AND NOT f.permanent
                        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id AND c.profile_id = @profile_id))::bigint AS waiting,
       coalesce(min(f.retry_after) FILTER (WHERE NOT f.permanent), now())::timestamptz AS next_retry
FROM documents d
LEFT JOIN embedding_set_failures f ON f.document_id = d.id AND f.profile_id = @profile_id AND f.version = d.version
WHERE d.source_id = @source_id AND d.status = 'ready';

-- A document's chunks for one profile, in order (copied to a profile with
-- the same chunk settings).
-- name: ProfileDocumentChunks :many
SELECT ordinal, content, heading_path, page_start, page_end, token_count
FROM chunks WHERE document_id = @document_id AND profile_id = @profile_id
ORDER BY ordinal;

-- name: GetDocumentDropped :one
SELECT dropped FROM document_blocks WHERE document_id = $1;

-- name: DeleteProfileDocumentChunks :exec
DELETE FROM chunks WHERE document_id = @document_id AND profile_id = @profile_id;

-- A document's chunks of every profile but one (the others are embedded
-- again from the new text).
-- name: DeleteOtherProfileChunks :execrows
DELETE FROM chunks WHERE document_id = @document_id AND profile_id <> @profile_id;

-- name: UpsertSetFailure :exec
INSERT INTO embedding_set_failures (document_id, profile_id, source_id, version, error_code, error_message, attempts, permanent, retry_after)
VALUES (@document_id, @profile_id, @source_id, @version, @error_code, @error_message, 1, @permanent, @retry_after)
ON CONFLICT (document_id, profile_id) DO UPDATE SET
    version = EXCLUDED.version, error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message,
    attempts = CASE WHEN embedding_set_failures.version = EXCLUDED.version THEN embedding_set_failures.attempts + 1 ELSE 1 END,
    permanent = EXCLUDED.permanent, retry_after = EXCLUDED.retry_after, failed_at = now();

-- name: GetSetFailureAttempts :one
SELECT attempts FROM embedding_set_failures WHERE document_id = @document_id AND profile_id = @profile_id AND version = @version;

-- name: DeleteSetFailure :exec
DELETE FROM embedding_set_failures WHERE document_id = @document_id AND profile_id = @profile_id;

-- name: ClearSetFailures :execrows
DELETE FROM embedding_set_failures WHERE source_id = ANY(@source_ids::uuid[]) AND profile_id = @profile_id;

-- name: ListSetFailures :many
SELECT f.document_id, f.source_id, f.error_code, f.error_message, f.attempts, f.failed_at,
       d.title, d.filename, d.url, s.name AS source_name
FROM embedding_set_failures f
JOIN documents d ON d.id = f.document_id AND d.version = f.version AND d.status = 'ready'
JOIN data_sources s ON s.id = f.source_id
WHERE f.source_id = ANY(@source_ids::uuid[]) AND f.profile_id = @profile_id AND f.permanent
ORDER BY f.failed_at DESC
LIMIT @max_rows;

-- ---- cleanup ------------------------------------------------------------------

-- Sets nothing needs any more: no KB with the source uses the profile, no
-- running migration of such a KB targets it, and no switched one (in its
-- grace period) can switch back to it.
-- name: UnneededEmbeddingSets :many
SELECT es.source_id, es.profile_id FROM source_embedding_sets es
JOIN data_sources s ON s.id = es.source_id
WHERE es.profile_id <> s.embedding_profile_id
  AND NOT EXISTS (SELECT 1 FROM kb_sources ks JOIN knowledge_bases kb ON kb.id = ks.kb_id
                  WHERE ks.source_id = es.source_id AND kb.embedding_profile_id = es.profile_id)
  AND NOT EXISTS (SELECT 1 FROM profile_migrations m JOIN kb_sources ks ON ks.kb_id = m.kb_id
                  WHERE ks.source_id = es.source_id
                    AND ((m.status = 'running' AND m.to_profile_id = es.profile_id)
                      OR (m.status = 'switched' AND m.from_profile_id = es.profile_id)))
ORDER BY es.created_at
LIMIT 50;

-- Deletes up to max_rows of a source's chunks for a profile (vectors go
-- with them: ON DELETE CASCADE).
-- name: DeleteSetChunksBatch :execrows
DELETE FROM chunks WHERE id IN (
    SELECT c.id FROM chunks c WHERE c.source_id = @source_id AND c.profile_id = @profile_id LIMIT @max_rows);

-- name: DeleteSetFailuresFor :exec
DELETE FROM embedding_set_failures WHERE source_id = @source_id AND profile_id = @profile_id;

-- Switched migrations whose grace period is over.
-- name: ExpiredSwitchedMigrations :many
SELECT * FROM profile_migrations WHERE status = 'switched' AND old_vectors_until <= now() ORDER BY old_vectors_until LIMIT 50;

-- ---- migrations -----------------------------------------------------------------

-- name: InsertProfileMigration :one
INSERT INTO profile_migrations (kb_id, team_id, from_profile_id, to_profile_id, grace_days, estimate, started_by)
VALUES (@kb_id, @team_id, @from_profile_id, @to_profile_id, @grace_days, @estimate, @started_by)
RETURNING *;

-- name: LockProfileMigration :one
SELECT * FROM profile_migrations WHERE id = $1 FOR UPDATE;

-- name: FinishProfileMigration :one
UPDATE profile_migrations SET status = @status, finished_by = @finished_by, finished_at = now(),
    revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: SwitchProfileMigration :one
UPDATE profile_migrations SET status = 'switched', switched_at = now(),
    old_vectors_until = now() + make_interval(days => grace_days), revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: EndGraceNow :exec
UPDATE profile_migrations SET old_vectors_until = now(), revision = revision + 1, updated_at = now()
WHERE id = @id;

-- name: SetMigrationAttention :exec
UPDATE profile_migrations SET attention_at = @attention_at, updated_at = now() WHERE id = @id;

-- The migration view: a migration with its KB, team and profile names.
-- name: ListProfileMigrationViews :many
SELECT sqlc.embed(m), kb.name AS kb_name, t.slug AS team_slug, t.name AS team_name,
       fp.name AS from_profile_name, tp.name AS to_profile_name,
       coalesce(u.display_name, '') AS started_by_name, coalesce(u.email, '') AS started_by_email
FROM profile_migrations m
JOIN knowledge_bases kb ON kb.id = m.kb_id
JOIN teams t ON t.id = m.team_id
JOIN embedding_profiles fp ON fp.id = m.from_profile_id
JOIN embedding_profiles tp ON tp.id = m.to_profile_id
LEFT JOIN users u ON u.id = m.started_by
WHERE (sqlc.narg(kb_id)::uuid IS NULL OR m.kb_id = sqlc.narg(kb_id))
  AND (sqlc.narg(id)::uuid IS NULL OR m.id = sqlc.narg(id))
  AND (NOT @active_only::bool OR m.status IN ('running', 'switched'))
ORDER BY m.started_at DESC, m.id
LIMIT @max_rows;

-- Running migrations of KBs that contain the source and target the profile.
-- name: RunningMigrationsForSet :many
SELECT m.id FROM profile_migrations m JOIN kb_sources ks ON ks.kb_id = m.kb_id
WHERE m.status = 'running' AND ks.source_id = @source_id AND m.to_profile_id = @profile_id;

-- name: RunningMigrationIDs :many
SELECT id FROM profile_migrations WHERE status = 'running' ORDER BY started_at;

-- The KB's running migration, if any (attaching a source during a migration).
-- name: RunningMigrationForKB :one
SELECT * FROM profile_migrations WHERE kb_id = $1 AND status = 'running';

-- ---- per-source figures -------------------------------------------------------------

-- Each source of a KB with its document figures and its state for a profile
-- (@step: new tokens per passage of that profile, for the estimate).
-- name: KBSourceFigures :many
SELECT s.id, s.name, s.embedding_profile_id, (s.team_id IS NULL)::bool AS shared,
       (SELECT count(*) FROM kb_sources o WHERE o.source_id = s.id AND o.kb_id <> @kb_id)::bigint AS other_kbs,
       coalesce(es.status, '')::text AS set_status, coalesce(es.last_error, '')::text AS set_error,
       coalesce(st.ready, 0)::bigint AS ready_documents, coalesce(st.passages, 0)::bigint AS passages,
       coalesce(st.tokens, 0)::bigint AS tokens, coalesce(st.cut, 0)::bigint AS cut_passages,
       coalesce(st.in_progress, 0)::bigint AS in_progress,
       coalesce(st.failed, 0)::bigint AS failed_documents
FROM kb_sources ks
JOIN data_sources s ON s.id = ks.source_id
LEFT JOIN source_embedding_sets es ON es.source_id = s.id AND es.profile_id = @profile_id
LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE d.status = 'ready') AS ready,
           sum(d.chunk_count) FILTER (WHERE d.status = 'ready') AS passages,
           sum(d.token_count) FILTER (WHERE d.status = 'ready') AS tokens,
           -- About how many passages of @step new tokens each the text makes.
           sum(greatest(1, ceil(d.token_count::numeric / greatest(@step::int, 1)))) FILTER (WHERE d.status = 'ready') AS cut,
           count(*) FILTER (WHERE d.status IN ('pending', 'queued', 'processing')) AS in_progress,
           count(*) FILTER (WHERE d.status = 'failed') AS failed
    FROM documents d WHERE d.source_id = s.id) st ON true
WHERE ks.kb_id = @kb_id
ORDER BY lower(s.name), s.id;

-- The KB's most sensitive source classification rank (-1: no sources).
-- name: KBMaxRank :one
SELECT coalesce(max(cl.rank), -1)::int FROM kb_sources ks
JOIN data_sources s ON s.id = ks.source_id
JOIN classification_levels cl ON cl.key = s.classification
WHERE ks.kb_id = $1;

-- Sources of a KB every one of whose KBs uses @profile_id: they move to it.
-- name: SourcesMovingTo :many
SELECT s.id, s.embedding_profile_id FROM kb_sources ks JOIN data_sources s ON s.id = ks.source_id
WHERE ks.kb_id = @kb_id AND s.embedding_profile_id <> @profile_id
  AND NOT EXISTS (SELECT 1 FROM kb_sources o JOIN knowledge_bases okb ON okb.id = o.kb_id
                  WHERE o.source_id = s.id AND okb.embedding_profile_id <> @profile_id);

-- name: SetSourceProfile :exec
UPDATE data_sources SET embedding_profile_id = @profile_id, updated_at = now() WHERE id = @id;

-- Documents' passage counts follow the source's own profile.
-- name: RecountSourceChunks :exec
UPDATE documents d SET chunk_count = c.n, token_count = c.tokens
FROM (SELECT ch.document_id, count(*)::int AS n, coalesce(sum(ch.token_count), 0)::int AS tokens
      FROM chunks ch WHERE ch.source_id = @source_id AND ch.profile_id = @profile_id GROUP BY ch.document_id) c
WHERE d.id = c.document_id AND d.source_id = @source_id;

-- name: SetKBProfile :one
UPDATE knowledge_bases SET embedding_profile_id = @profile_id, revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- KBs for the admin page: team, profile, figures and the active migration.
-- name: AdminKBList :many
SELECT kb.id, kb.name, kb.embedding_profile_id, t.slug AS team_slug, t.name AS team_name, p.name AS profile_name,
       (SELECT count(*) FROM kb_sources ks WHERE ks.kb_id = kb.id)::bigint AS sources,
       (SELECT coalesce(sum(d.chunk_count), 0) FROM kb_sources ks JOIN documents d ON d.source_id = ks.source_id
        WHERE ks.kb_id = kb.id AND d.status = 'ready')::bigint AS passages,
       m.id AS migration_id, coalesce(m.status, '')::text AS migration_status
FROM knowledge_bases kb
JOIN teams t ON t.id = kb.team_id
JOIN embedding_profiles p ON p.id = kb.embedding_profile_id
LEFT JOIN profile_migrations m ON m.kb_id = kb.id AND m.status IN ('running', 'switched')
ORDER BY lower(t.name), lower(kb.name), kb.id
LIMIT 1000;

-- A source can join a KB whose profile it has: its own, or a ready set.
-- name: SourceHasProfile :one
SELECT (EXISTS (SELECT 1 FROM data_sources ds WHERE ds.id = @source_id AND ds.embedding_profile_id = @profile_id)
     OR EXISTS (SELECT 1 FROM source_embedding_sets es WHERE es.source_id = @source_id AND es.profile_id = @profile_id AND es.status = 'ready'))::bool;
