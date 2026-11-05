-- name: GetPIISettings :one
SELECT * FROM pii_settings WHERE singleton;

-- name: LockPIISettings :one
SELECT * FROM pii_settings WHERE singleton FOR UPDATE;

-- name: UpdatePIISettings :one
UPDATE pii_settings SET enabled = @enabled, block_levels = @block_levels, patterns = @patterns,
    revision = revision + 1, updated_by = @updated_by, updated_at = now()
WHERE singleton RETURNING *;

-- Records a document's possible personal data (metadata.pii), or removes it when pii is JSON null.
-- name: SetDocumentPII :exec
UPDATE documents
SET metadata = CASE WHEN @pii::jsonb = 'null'::jsonb THEN metadata - 'pii' ELSE jsonb_set(metadata, '{pii}', @pii::jsonb) END
WHERE id = @id;

-- Documents waiting for a review of possible personal data, per team: counts only, never names or findings.
-- name: CountPIIReviewByTeam :many
SELECT d.team_id, t.slug, t.name,
    count(*) FILTER (WHERE d.metadata->'pii'->>'state' = 'held')::bigint AS held,
    count(*) FILTER (WHERE d.metadata->'pii'->>'state' = 'flagged')::bigint AS flagged
FROM documents d JOIN teams t ON t.id = d.team_id
WHERE d.metadata->'pii'->>'state' IN ('flagged', 'held')
GROUP BY d.team_id, t.slug, t.name ORDER BY held DESC, flagged DESC, t.name;

-- An editor's review of a document's possible personal data: the record and the document's warnings.
-- name: SetDocumentPIIReview :exec
UPDATE documents SET metadata = jsonb_set(metadata, '{pii}', @pii::jsonb), warnings = @warnings, updated_at = now()
WHERE id = @id;
