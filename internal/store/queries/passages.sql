-- The source viewer (docs/v0.4.0.md §5): cited passages in their document's
-- context, and whole documents for editors.

-- An answer with what decides who may read its cited passages: the
-- conversation's user or anonymous session (deleted conversations: none).
-- name: GetCitedMessage :one
SELECT m.id, m.role, m.content, m.citations, m.error_code, c.user_id, c.anon_session_id, c.agent_id,
       e.citations AS citation_check, coalesce(e.refused, false)::bool AS answer_refused
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
LEFT JOIN message_events e ON e.message_id = m.id
WHERE m.id = $1 AND c.deleted_at IS NULL;

-- A document for the viewer, with its source's team (NULL: platform-shared).
-- name: GetViewerDocument :one
SELECT d.id, d.source_id, d.title, d.filename, d.url, d.kind, d.chunk_count, s.team_id, coalesce(t.slug, '')::text AS team_slug
FROM documents d
JOIN data_sources s ON s.id = d.source_id
LEFT JOIN teams t ON t.id = s.team_id
WHERE d.id = $1;

-- A passage's position, when it is still one of its document's current
-- passages (its source's embedding profile).
-- name: GetViewerChunk :one
SELECT c.ordinal
FROM chunks c JOIN data_sources s ON s.id = c.source_id
WHERE c.id = @id AND c.document_id = @document_id AND c.profile_id = s.embedding_profile_id;

-- A document's current passages from one ordinal to another, in order.
-- name: ListViewerChunks :many
SELECT c.id, c.ordinal, c.content, c.heading_path, c.page_start, c.page_end
FROM chunks c JOIN data_sources s ON s.id = c.source_id
WHERE c.document_id = @document_id AND c.profile_id = s.embedding_profile_id
  AND c.ordinal BETWEEN @from_ordinal::int AND @to_ordinal::int
ORDER BY c.ordinal;
