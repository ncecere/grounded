-- OCR for scanned documents (docs/ocr.md): Admin -> Parsing, documents
-- waiting for the daily OCR page limit, and retrying scanned documents.

-- name: GetParsingSettings :one
SELECT * FROM parsing_settings WHERE singleton;

-- name: LockParsingSettings :one
SELECT * FROM parsing_settings WHERE singleton FOR UPDATE;

-- name: InsertParsingSettings :one
INSERT INTO parsing_settings (ocr_enabled, ocr_backend, vision_model_id, languages, updated_by)
VALUES (@ocr_enabled, @ocr_backend, @vision_model_id, @languages, @updated_by)
ON CONFLICT (singleton) DO NOTHING
RETURNING *;

-- name: UpdateParsingSettings :one
UPDATE parsing_settings
SET ocr_enabled = @ocr_enabled, ocr_backend = @ocr_backend, vision_model_id = @vision_model_id,
    languages = @languages, updated_by = @updated_by, revision = revision + 1, updated_at = now()
WHERE singleton
RETURNING *;

-- Documents skipped as scanned, per team (NULL: platform-shared sources).
-- name: CountNeedsOCRByTeam :many
SELECT d.team_id, coalesce(t.slug, '')::text AS team_slug, coalesce(t.name, '')::text AS team_name, count(*)::bigint AS documents
FROM documents d LEFT JOIN teams t ON t.id = d.team_id
WHERE d.error_code = 'needs_ocr'
GROUP BY d.team_id, t.slug, t.name
ORDER BY count(*) DESC, t.slug NULLS LAST;

-- A document whose OCR would pass the team's daily page limit goes back to
-- pending and waits until @waiting_until (or until the limit is raised).
-- Like a snooze, the attempt doesn't count.
-- name: WaitDocument :execrows
UPDATE documents
SET status = 'pending', waiting_until = @waiting_until, attempts = greatest(attempts - 1, 0),
    error_code = @error_code, error_message = @error_message, updated_at = now()
WHERE id = @id AND status = 'processing';

-- Waiting documents whose time has come are pending again.
-- name: WakeDueDocuments :execrows
UPDATE documents SET waiting_until = NULL, error_code = '', error_message = '', updated_at = now()
WHERE status = 'pending' AND waiting_until IS NOT NULL AND waiting_until <= now();

-- A team's documents waiting for a daily limit (every team's when team_id
-- is NULL) check it again: the limit changed.
-- name: WakeWaitingDocuments :execrows
UPDATE documents SET waiting_until = NULL, error_code = '', error_message = '', updated_at = now()
WHERE status = 'pending' AND waiting_until IS NOT NULL AND error_code = @error_code
  AND (sqlc.narg(team_id)::uuid IS NULL OR team_id = sqlc.narg(team_id)::uuid);

-- Records the pages read with OCR (metadata.ocr), or removes the record
-- when ocr is JSON null.
-- name: SetDocumentOCR :exec
UPDATE documents
SET metadata = CASE WHEN @ocr::jsonb = 'null'::jsonb THEN metadata - 'ocr' ELSE jsonb_set(metadata, '{ocr}', @ocr::jsonb) END
WHERE id = @id;

-- Retry of a source's failed or skipped documents with one error code
-- (e.g. needs_ocr, once OCR is on).
-- name: RetryDocumentsByError :many
UPDATE documents
SET status = 'pending', error_code = '', error_message = '', attempts = 0, waiting_until = NULL, updated_at = now()
WHERE source_id = @source_id AND error_code = @error_code AND status IN ('failed', 'skipped')
RETURNING id;

-- name: SetSourceOCR :exec
UPDATE data_sources SET ocr_enabled = @ocr_enabled WHERE id = @id;
