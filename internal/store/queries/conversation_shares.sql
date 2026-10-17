-- Sharing a conversation (v0.6.0, C12; ADR-0010 amendment). A share names a conversation and the last message it covers; the secret of
-- its link is kept only as a hash.

-- The last answer a share can end at: complete (no error, not stopped part-way). 0 when there is none yet.
-- name: LastCompleteAnswerSeq :one
SELECT coalesce(max(seq), 0)::int4 AS seq FROM messages
WHERE conversation_id = $1 AND role = 'assistant' AND error_code = '' AND stop_reason <> 'aborted';

-- name: CountConversationShares :one
SELECT count(*) FROM conversation_shares WHERE conversation_id = $1;

-- name: InsertConversationShare :one
INSERT INTO conversation_shares (conversation_id, token_hash, up_to_seq, audience, show_name, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- A conversation's shares, newest first, with how many messages (questions and answers) each covers.
-- name: ListConversationShares :many
SELECT s.id, s.audience, s.show_name, s.up_to_seq, s.created_at,
       (SELECT count(*) FROM messages m WHERE m.conversation_id = s.conversation_id AND m.seq <= s.up_to_seq AND m.role IN ('user', 'assistant'))::int4 AS message_count
FROM conversation_shares s
WHERE s.conversation_id = $1
ORDER BY s.created_at DESC;

-- name: DeleteConversationShare :execrows
DELETE FROM conversation_shares WHERE id = $1 AND conversation_id = $2;

-- A share by the hash of its link's secret, with what the viewer needs. A conversation its user deleted, and an agent that was deleted, are
-- gone here; whether the agent is still shared (published, active, who may use it) is decided by the service. The sharer's name is selected
-- only when they chose to show it.
-- name: GetShareByTokenHash :one
SELECT s.id, s.conversation_id, s.up_to_seq, s.audience, s.show_name, s.created_by, s.created_at,
       c.title, c.user_id AS conversation_user_id,
       a.id AS agent_id, a.team_id, a.slug AS agent_slug, a.name AS agent_name, a.description AS agent_description, a.accent_color,
       a.status AS agent_status, a.published_version_id,
       t.slug AS team_slug, t.name AS team_name, u.status AS creator_status,
       (CASE WHEN s.show_name THEN coalesce(u.display_name, '') ELSE '' END)::text AS sharer_name
FROM conversation_shares s
JOIN conversations c ON c.id = s.conversation_id AND c.deleted_at IS NULL
JOIN agents a ON a.id = c.agent_id AND a.deleted_at IS NULL
JOIN teams t ON t.id = a.team_id
JOIN users u ON u.id = s.created_by
WHERE s.token_hash = $1;

-- The same columns as GetCitedMessage (the source viewer's input), for a message inside a share's snapshot only.
-- name: GetSharedCitedMessage :one
SELECT m.id, m.role, m.content, m.citations, m.error_code, c.user_id, c.anon_session_id, c.agent_id,
       e.citations AS citation_check, coalesce(e.refused, false)::bool AS answer_refused
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
LEFT JOIN message_events e ON e.message_id = m.id
WHERE m.id = @message_id AND m.conversation_id = @conversation_id AND m.seq <= @up_to_seq AND c.deleted_at IS NULL;
