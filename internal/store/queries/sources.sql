-- name: InsertSource :one
INSERT INTO data_sources (team_id, name, description, type, config, classification, embedding_profile_id, created_by)
VALUES (@team_id, @name, @description, @type, @config, @classification, @embedding_profile_id, @created_by)
RETURNING *;

-- name: GetSource :one
SELECT * FROM data_sources WHERE id = $1;

-- name: LockSource :one
SELECT * FROM data_sources WHERE id = $1 FOR UPDATE;

-- name: ListTeamSources :many
SELECT * FROM data_sources WHERE team_id = @team_id ORDER BY lower(name), id;

-- name: ListPlatformSources :many
SELECT * FROM data_sources WHERE team_id IS NULL ORDER BY lower(name), id;

-- name: UpdateSource :one
UPDATE data_sources
SET name = @name, description = @description, classification = @classification, status = @status,
    config = @config, revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: DeleteSource :exec
DELETE FROM data_sources WHERE id = $1;

-- name: SourceDocumentStats :many
SELECT source_id, status, count(*)::bigint AS documents,
       coalesce(sum(size_bytes), 0)::bigint AS bytes,
       coalesce(sum(chunk_count), 0)::bigint AS chunks
FROM documents
WHERE source_id = ANY(@source_ids::uuid[])
GROUP BY source_id, status;

-- name: SourceKnowledgeBases :many
SELECT kb.id, kb.name FROM kb_sources ks JOIN knowledge_bases kb ON kb.id = ks.kb_id
WHERE ks.source_id = $1 ORDER BY kb.name;

-- The most sensitive data a team holds: its own sources and the shared
-- sources its knowledge bases attach.
-- name: MaxSourceRankForTeam :one
SELECT coalesce(max(cl.rank), -1)::int
FROM data_sources s JOIN classification_levels cl ON cl.key = s.classification
WHERE s.team_id = @team_id::uuid
   OR (s.team_id IS NULL AND EXISTS (
        SELECT 1 FROM kb_sources ks JOIN knowledge_bases kb ON kb.id = ks.kb_id
        WHERE ks.source_id = s.id AND kb.team_id = @team_id::uuid));

-- Knowledge bases whose team is approved below rank: raising a shared
-- source to rank would break ADR-0006 rule 2 for them.
-- name: SharedSourceImpact :many
SELECT t.id AS team_id, t.slug AS team_slug, t.name AS team_name, t.max_classification AS team_max_classification,
       kb.id AS kb_id, kb.name AS kb_name
FROM kb_sources ks
JOIN knowledge_bases kb ON kb.id = ks.kb_id
JOIN teams t ON t.id = kb.team_id
JOIN classification_levels cl ON cl.key = t.max_classification
WHERE ks.source_id = @source_id AND cl.rank < @rank::int
ORDER BY t.slug, lower(kb.name);

-- ---- documents ----------------------------------------------------------

-- Inserts a new upload or replaces the file behind an existing one (same
-- external_id), bumping the version and re-queueing processing.
-- name: UpsertUploadedDocument :one
INSERT INTO documents (id, source_id, team_id, external_id, title, filename, content_type, size_bytes, sha256, blob_key, uploaded_by)
VALUES (@id, @source_id, @team_id, @external_id, @title, @filename, @content_type, @size_bytes, @sha256, @blob_key, @uploaded_by)
ON CONFLICT (source_id, external_id) DO UPDATE
SET filename = EXCLUDED.filename, content_type = EXCLUDED.content_type, size_bytes = EXCLUDED.size_bytes,
    sha256 = EXCLUDED.sha256, blob_key = EXCLUDED.blob_key, uploaded_by = EXCLUDED.uploaded_by,
    version = documents.version + 1, status = 'pending', error_code = '', error_message = '',
    attempts = 0, updated_at = now()
RETURNING *, (xmax = 0) AS inserted;

-- name: SetDocumentTags :one
UPDATE documents SET tags = @tags WHERE id = @id RETURNING *;

-- name: SetDocumentsTags :exec
UPDATE documents SET tags = @tags WHERE id = ANY(@ids::uuid[]);

-- name: SetSourceDocumentTags :exec
UPDATE documents SET tags = @tags WHERE source_id = @source_id;

-- name: FindDocumentByExternalID :one
SELECT * FROM documents WHERE source_id = @source_id AND external_id = @external_id;

-- name: GetDocument :one
SELECT * FROM documents WHERE id = $1;

-- name: ListDocuments :many
SELECT * FROM documents
WHERE source_id = @source_id
  AND (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status)::text)
  AND (sqlc.narg(kind)::text IS NULL OR kind = sqlc.narg(kind)::text)
  AND (sqlc.narg(tag)::text IS NULL OR tags @> ARRAY[lower(sqlc.narg(tag)::text)])
  AND (sqlc.narg(before_created)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(before_created)::timestamptz, sqlc.narg(before_id)::uuid))
ORDER BY created_at DESC, id DESC
LIMIT @page_size;

-- name: SearchDocuments :many
-- ListDocuments filtered by text. A separate query (no "IS NULL OR") so the
-- planner can always use documents_search_idx, whose expression this repeats.
-- The search text is LIKE-escaped by the caller.
SELECT * FROM documents
WHERE source_id = @source_id
  AND (title || ' ' || url || ' ' || filename) ILIKE '%' || @search::text || '%' ESCAPE '\'
  AND (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status)::text)
  AND (sqlc.narg(kind)::text IS NULL OR kind = sqlc.narg(kind)::text)
  AND (sqlc.narg(tag)::text IS NULL OR tags @> ARRAY[lower(sqlc.narg(tag)::text)])
  AND (sqlc.narg(before_created)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(before_created)::timestamptz, sqlc.narg(before_id)::uuid))
ORDER BY created_at DESC, id DESC
LIMIT @page_size;

-- name: DeleteDocument :one
DELETE FROM documents WHERE id = $1 RETURNING *;

-- name: RetryDocument :one
UPDATE documents SET status = 'pending', error_code = '', error_message = '', attempts = 0, updated_at = now()
WHERE id = $1 AND status IN ('failed', 'skipped')
RETURNING *;

-- ---- ingestion dispatcher -------------------------------------------------

-- name: LockDispatcher :exec
SELECT pg_advisory_xact_lock(7378431003);

-- name: CountInflight :one
SELECT count(*) FROM documents WHERE status IN ('queued', 'processing');

-- The fair picker query lives in internal/ingest (sqlc cannot analyse it).

-- name: MarkQueued :many
UPDATE documents SET status = 'queued', updated_at = now()
WHERE id = ANY(@ids::uuid[]) AND status = 'pending'
RETURNING id;

-- name: StartProcessing :one
UPDATE documents SET status = 'processing', attempts = attempts + 1, updated_at = now()
WHERE id = $1 AND status IN ('queued', 'processing')
RETURNING *;

-- name: FinishDocument :exec
UPDATE documents
SET status = @status, error_code = @error_code, error_message = @error_message,
    title = CASE WHEN @title::text = '' THEN title ELSE @title::text END,
    kind = @kind, parser = @parser, pages = @pages, warnings = @warnings,
    chunk_count = @chunk_count, token_count = @token_count,
    processed_at = now(), updated_at = now()
WHERE id = @id;

-- name: RequeueDocument :exec
UPDATE documents SET status = 'queued', error_code = @error_code, error_message = @error_message, updated_at = now()
WHERE id = @id;

-- Backpressure: back to queued without counting the attempt (the job is
-- snoozed). updated_at moves, so RecoverStuckDocuments leaves it alone.
-- name: SnoozeDocument :exec
UPDATE documents SET status = 'queued', attempts = greatest(attempts - 1, 0),
    error_code = @error_code, error_message = @error_message, updated_at = now()
WHERE id = @id AND status = 'processing';

-- Documents stuck in queued/processing (e.g. job lost) go back to pending.
-- name: RecoverStuckDocuments :execrows
UPDATE documents SET status = 'pending', updated_at = now()
WHERE status IN ('queued', 'processing') AND updated_at < now() - make_interval(mins => @older_than_minutes::int);

-- ---- chunks ------------------------------------------------------------------

-- The first passages of a document, in order (the document sheet's previews).
-- name: ListDocumentChunks :many
SELECT c.ordinal, c.content, c.heading_path, c.page_start, c.page_end, c.token_count
FROM chunks c JOIN data_sources s ON s.id = c.source_id
WHERE c.document_id = @document_id AND c.profile_id = s.embedding_profile_id
ORDER BY c.ordinal
LIMIT @page_size;

-- The tags a source's documents use, for the documents filter.
-- name: ListSourceTags :many
SELECT DISTINCT t::text AS tag
FROM documents d, unnest(d.tags) AS t
WHERE d.source_id = @source_id
ORDER BY 1
LIMIT 200;

-- name: DeleteDocumentChunks :exec
DELETE FROM chunks WHERE document_id = $1;

-- Chunk inserts live in internal/ingest (multi-array unnest).

-- ---- usage ---------------------------------------------------------------------

-- name: InsertUsage :exec
INSERT INTO usage_events (kind, quantity, team_id, user_id, api_key_id, source_id, kb_id, document_id, model_id, agent_id, metadata)
VALUES (@kind, @quantity, @team_id, @user_id, @api_key_id, @source_id, @kb_id, @document_id, @model_id, @agent_id, @metadata);

-- ADR-0006 rule 6: published agents (live or disabled; not deleted) that
-- would break rule 4 (chat model ceiling) or rule 5 (audience ceiling) if
-- data at @classification reached them, through @source_id (in any of the
-- published version's KBs) or directly through @kb_id. Pass one of the two.
-- name: AgentRankImpact :many
SELECT a.id AS agent_id, a.name AS agent_name, t.id AS team_id, t.slug AS team_slug, t.name AS team_name,
       m.display_name AS model_name, m.max_classification AS model_max_classification,
       coalesce(g.principal_type, 'team')::text AS audience,
       (mcl.rank < nl.rank) AS model_blocks,
       (CASE coalesce(g.principal_type, 'team') WHEN 'team' THEN 0 WHEN 'all_authenticated' THEN 1 ELSE 2 END) >
       (CASE nl.max_audience WHEN 'team' THEN 0 WHEN 'all_authenticated' THEN 1 ELSE 2 END) AS audience_blocks
FROM agents a
JOIN teams t ON t.id = a.team_id
JOIN agent_versions v ON v.id = a.published_version_id
JOIN models m ON m.id = v.chat_model_id
JOIN classification_levels mcl ON mcl.key = m.max_classification
JOIN classification_levels nl ON nl.key = @classification::text
LEFT JOIN agent_audience_grants g ON g.agent_id = a.id
WHERE a.deleted_at IS NULL
  AND EXISTS (
      SELECT 1 FROM agent_version_kbs vk
      WHERE vk.version_id = v.id
        AND (vk.kb_id = sqlc.narg(kb_id)::uuid
             OR vk.kb_id IN (SELECT ks.kb_id FROM kb_sources ks WHERE ks.source_id = sqlc.narg(source_id)::uuid)))
  AND (mcl.rank < nl.rank
       OR (CASE coalesce(g.principal_type, 'team') WHEN 'team' THEN 0 WHEN 'all_authenticated' THEN 1 ELSE 2 END) >
          (CASE nl.max_audience WHEN 'team' THEN 0 WHEN 'all_authenticated' THEN 1 ELSE 2 END))
ORDER BY t.slug, lower(a.name);
