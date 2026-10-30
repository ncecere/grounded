-- Repeated-boilerplate suppression (ADR-0021, internal/ingest boilerplate*.go).

-- ---- settings and refresh state ----------------------------------------------

-- name: GetSourceBoilerplate :one
SELECT * FROM source_boilerplate WHERE source_id = $1;

-- name: GetSourceBoilerplateRev :one
SELECT rev FROM source_boilerplate WHERE source_id = $1;

-- Replaces a source's overrides (NULL = inherit) and asks for a refresh.
-- name: SetBoilerplateSettings :exec
INSERT INTO source_boilerplate (source_id, enabled, min_docs, ratio, fuzzy, requested_at)
VALUES (@source_id, @enabled, @min_docs, @ratio, @fuzzy, now())
ON CONFLICT (source_id) DO UPDATE
SET enabled = EXCLUDED.enabled, min_docs = EXCLUDED.min_docs, ratio = EXCLUDED.ratio, fuzzy = EXCLUDED.fuzzy, requested_at = now();

-- name: RequestBoilerplateRefresh :exec
INSERT INTO source_boilerplate (source_id, requested_at) VALUES ($1, now())
ON CONFLICT (source_id) DO UPDATE SET requested_at = now();

-- Due: a refresh was requested and not handled, or documents still wait
-- for the current classification (a refresh job ended before finishing).
-- name: SourcesDueForBoilerplate :many
SELECT sb.source_id FROM source_boilerplate sb
JOIN data_sources s ON s.id = sb.source_id AND s.status = 'active'
WHERE (sb.requested_at IS NOT NULL AND (sb.refreshed_at IS NULL OR sb.requested_at > sb.refreshed_at))
   OR EXISTS (SELECT 1 FROM document_blocks db JOIN documents d ON d.id = db.document_id AND d.status = 'ready'
              WHERE db.source_id = sb.source_id AND db.rev < sb.rev)
ORDER BY sb.requested_at NULLS LAST
LIMIT 500;

-- name: FinishBoilerplateRefresh :exec
UPDATE source_boilerplate
SET rev = @rev, documents = @documents, threshold = @threshold, refreshed_at = @refreshed_at
WHERE source_id = @source_id;

-- name: CountSourceInflight :one
-- Documents waiting for the daily OCR page limit don't hold the refresh up.
SELECT count(*) FROM documents WHERE source_id = $1 AND status IN ('pending', 'queued', 'processing') AND waiting_until IS NULL;

-- ---- classification ---------------------------------------------------------------

-- Documents counted: ready documents with recorded blocks.
-- name: CountSourceBlockDocuments :one
SELECT count(*) FROM document_blocks db
JOIN documents d ON d.id = db.document_id AND d.status = 'ready'
WHERE db.source_id = $1;

-- name: RepeatedBlocks :many
SELECT h::bigint AS block_hash, count(*)::int AS docs
FROM document_blocks db
JOIN documents d ON d.id = db.document_id AND d.status = 'ready',
     unnest(db.hashes) AS h
WHERE db.source_id = @source_id
GROUP BY h
HAVING count(*) >= @threshold::int;

-- The document that keeps each block: the shortest URL (usually the home
-- page or a section index), then the lowest ID, so the choice is stable.
-- name: CanonicalDocuments :many
SELECT DISTINCT ON (h) h::bigint AS block_hash, d.id AS document_id
FROM document_blocks db
JOIN documents d ON d.id = db.document_id AND d.status = 'ready',
     unnest(db.hashes) AS h
WHERE db.source_id = @source_id AND h = ANY(@hashes::bigint[])
ORDER BY h, length(d.external_id), d.external_id, d.id;

-- name: ListBoilerplateBlocks :many
SELECT block_hash, doc_count, sample, canonical_document_id, variants, member_of FROM source_boilerplate_blocks
WHERE source_id = $1;

-- name: DeleteBoilerplateBlocks :exec
DELETE FROM source_boilerplate_blocks WHERE source_id = $1;

-- Inserting the blocks lives in internal/ingest (multi-array unnest).

-- The boilerplate blocks among one document's hashes (ingestion).
-- name: BoilerplateBlocksIn :many
SELECT block_hash, canonical_document_id FROM source_boilerplate_blocks
WHERE source_id = @source_id AND block_hash = ANY(@hashes::bigint[]);

-- ---- documents -----------------------------------------------------------------

-- name: UpsertDocumentBlocks :exec
INSERT INTO document_blocks (document_id, source_id, hashes, dropped, rev)
VALUES (@document_id, @source_id, @hashes, @dropped, @rev)
ON CONFLICT (document_id) DO UPDATE
SET hashes = EXCLUDED.hashes, dropped = EXCLUDED.dropped, rev = EXCLUDED.rev;

-- name: DeleteDocumentBlocks :exec
DELETE FROM document_blocks WHERE document_id = $1;

-- Near-duplicate matching (#23): the eligible blocks of a document and their sketches, or (version 0) none.
-- name: SetDocumentSketches :exec
UPDATE document_blocks
SET sketch_version = @sketch_version, fuzzy_hashes = @fuzzy_hashes, sketches = @sketches
WHERE document_id = @document_id
  AND (sketch_version <> @sketch_version OR fuzzy_hashes <> @fuzzy_hashes OR sketches <> @sketches);

-- Ready documents with recorded blocks but no sketches yet (near-duplicate matching was switched on after they
-- were processed).
-- name: DocumentsMissingSketches :many
SELECT d.id, d.blob_key FROM document_blocks db
JOIN documents d ON d.id = db.document_id AND d.status = 'ready'
WHERE db.source_id = @source_id AND db.sketch_version < @sketch_version
ORDER BY d.id
LIMIT @max_rows;

-- Ready documents processed before blocks were recorded.
-- name: DocumentsMissingBlocks :many
SELECT d.id, d.blob_key FROM documents d
WHERE d.source_id = @source_id AND d.status = 'ready'
  AND NOT EXISTS (SELECT 1 FROM document_blocks db WHERE db.document_id = d.id)
ORDER BY d.id
LIMIT @max_rows;

-- Documents chunked under an older classification revision.
-- name: StaleDocumentBlocks :many
SELECT db.document_id, db.hashes, db.dropped, d.version, d.blob_key, d.title, d.team_id, d.uploaded_by
FROM document_blocks db
JOIN documents d ON d.id = db.document_id AND d.status = 'ready'
WHERE db.source_id = @source_id AND db.rev < @rev
ORDER BY db.document_id
LIMIT @max_rows;

-- name: SetDocumentBlocksRev :exec
UPDATE document_blocks SET rev = @rev WHERE document_id = ANY(@document_ids::uuid[]);

-- name: DocumentChunkKeys :many
SELECT id, content, heading_path, page_start, page_end FROM chunks WHERE document_id = @document_id AND profile_id = @profile_id;

-- name: SetDocumentChunkStats :exec
UPDATE documents SET chunk_count = @chunk_count, token_count = @token_count, updated_at = now()
WHERE id = @id;

-- ---- reporting -----------------------------------------------------------------------

-- name: BoilerplateSummaries :many
SELECT sb.source_id, sb.enabled, sb.min_docs, sb.ratio, sb.fuzzy, sb.rev, sb.documents, sb.threshold,
       sb.requested_at, sb.refreshed_at,
       (SELECT count(*) FROM source_boilerplate_blocks b WHERE b.source_id = sb.source_id AND b.member_of IS NULL)::bigint AS blocks,
       (SELECT count(*) FROM document_blocks db
        WHERE db.source_id = sb.source_id AND cardinality(db.dropped) > 0)::bigint AS pages,
       EXISTS (SELECT 1 FROM document_blocks db JOIN documents d ON d.id = db.document_id AND d.status = 'ready'
               WHERE db.source_id = sb.source_id AND db.rev < sb.rev) AS stale
FROM source_boilerplate sb
WHERE sb.source_id = ANY(@source_ids::uuid[]);

-- name: TopBoilerplateBlocks :many
SELECT block_hash, doc_count, sample, variants FROM source_boilerplate_blocks
WHERE source_id = @source_id AND member_of IS NULL
ORDER BY doc_count DESC, sample
LIMIT @max_rows;

-- A ready document without stored parsed text is processed again from its
-- stored original.
-- name: ReprocessDocument :exec
UPDATE documents SET status = 'pending', updated_at = now()
WHERE id = @id AND version = @version AND status = 'ready';

-- ---- index preview with near-duplicate matching (#23) ----------------------------------------------------------

-- The blocks a candidate profile's set drops, among one document's hashes.
-- name: SetBoilerplateBlocksIn :many
SELECT block_hash, canonical_document_id FROM set_boilerplate_blocks
WHERE source_id = @source_id AND profile_id = @profile_id AND block_hash = ANY(@hashes::bigint[]);

-- name: InsertSetBoilerplate :exec
INSERT INTO set_boilerplate (source_id, profile_id, documents, threshold)
VALUES (@source_id, @profile_id, @documents, @threshold)
ON CONFLICT (source_id, profile_id) DO NOTHING;

-- name: GetSetBoilerplate :one
SELECT * FROM set_boilerplate WHERE source_id = @source_id AND profile_id = @profile_id;

-- name: SetCandidateBoilerplateFuzzy :exec
UPDATE embedding_profiles SET boilerplate_fuzzy = true WHERE id = @id AND candidate_of IS NOT NULL;

-- A source's own override of near-duplicate matching, keeping the others (the switch of a preview with it on).
-- name: SetSourceBoilerplateFuzzy :execrows
INSERT INTO source_boilerplate (source_id, fuzzy, requested_at) VALUES (@source_id, true, now())
ON CONFLICT (source_id) DO UPDATE SET fuzzy = true, requested_at = now()
WHERE source_boilerplate.fuzzy IS DISTINCT FROM true;
