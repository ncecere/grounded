-- Documents that failed or need OCR, for platform admins (Admin -> Parsing &
-- OCR, owner decision 3 of docs/v0.2.0.md §7): counts per source and reason
-- class, never names or text. A document counts when it failed, or was
-- skipped as scanned (needs_ocr). Each source's documents are read through
-- documents_source_status_idx (source_id, status), so no full scan.
-- The reason classes (sources.ProblemReason) must match in both queries:
-- needs_ocr; ocr_error (error codes ocr_*); damaged (corrupt, encrypted,
-- unsupported_format, too_large); other.

-- name: ListDocumentProblems :many
SELECT s.id AS source_id, s.name AS source_name, s.team_id,
       coalesce(t.slug::text, '')::text AS team_slug, coalesce(t.name, '')::text AS team_name,
       p.reason::text AS reason, p.documents::bigint AS documents, p.oldest::timestamptz AS oldest
FROM data_sources s
LEFT JOIN teams t ON t.id = s.team_id
CROSS JOIN LATERAL (
    SELECT CASE
               WHEN d.error_code = 'needs_ocr' THEN 'needs_ocr'
               WHEN d.error_code LIKE 'ocr\_%' ESCAPE '\' THEN 'ocr_error'
               WHEN d.error_code IN ('corrupt', 'encrypted', 'unsupported_format', 'too_large') THEN 'damaged'
               ELSE 'other'
           END AS reason,
           count(*) AS documents, min(d.updated_at) AS oldest
    FROM documents d
    WHERE d.source_id = s.id AND d.status IN ('failed', 'skipped')
      AND (d.status = 'failed' OR d.error_code = 'needs_ocr')
    GROUP BY 1
) p
ORDER BY t.name NULLS LAST, t.slug, s.name, p.reason;

-- One source's documents of one reason class, for a notification.
-- name: CountDocumentProblems :one
SELECT count(*)::bigint AS documents, coalesce(min(d.updated_at), now())::timestamptz AS oldest
FROM documents d
WHERE d.source_id = @source_id AND d.status IN ('failed', 'skipped')
  AND (d.status = 'failed' OR d.error_code = 'needs_ocr')
  AND CASE
          WHEN d.error_code = 'needs_ocr' THEN 'needs_ocr'
          WHEN d.error_code LIKE 'ocr\_%' ESCAPE '\' THEN 'ocr_error'
          WHEN d.error_code IN ('corrupt', 'encrypted', 'unsupported_format', 'too_large') THEN 'damaged'
          ELSE 'other'
      END = @reason::text;

-- Queues one source's documents of one reason class again ("Retry these").
-- name: RetryDocumentProblems :many
UPDATE documents d
SET status = 'pending', error_code = '', error_message = '', attempts = 0, waiting_until = NULL, updated_at = now()
WHERE d.source_id = @source_id AND d.status IN ('failed', 'skipped')
  AND (d.status = 'failed' OR d.error_code = 'needs_ocr')
  AND CASE
          WHEN d.error_code = 'needs_ocr' THEN 'needs_ocr'
          WHEN d.error_code LIKE 'ocr\_%' ESCAPE '\' THEN 'ocr_error'
          WHEN d.error_code IN ('corrupt', 'encrypted', 'unsupported_format', 'too_large') THEN 'damaged'
          ELSE 'other'
      END = @reason::text
RETURNING d.id;
