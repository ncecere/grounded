-- ---- agents ----------------------------------------------------------------

-- name: CountTeamAgents :one
SELECT count(*) FROM agents WHERE team_id = $1 AND deleted_at IS NULL;

-- name: InsertAgent :one
INSERT INTO agents (team_id, slug, name, description, accent_color, welcome_message, starter_questions, draft, created_by)
VALUES (@team_id, @slug, @name, @description, @accent_color, @welcome_message, @starter_questions, @draft, @created_by)
RETURNING *;

-- name: InsertAudienceGrant :exec
INSERT INTO agent_audience_grants (agent_id, principal_type, principal_id, created_by)
VALUES (@agent_id, @principal_type, @principal_id, @created_by);

-- name: GetAudienceGrant :one
SELECT * FROM agent_audience_grants WHERE agent_id = $1;

-- name: GetAgent :one
SELECT * FROM agents WHERE id = $1 AND deleted_at IS NULL;

-- name: LockAgent :one
SELECT * FROM agents WHERE id = $1 AND deleted_at IS NULL FOR UPDATE;

-- name: GetAgentBySlug :one
SELECT * FROM agents WHERE team_id = @team_id AND slug = @slug AND deleted_at IS NULL;

-- name: ListTeamAgents :many
SELECT * FROM agents WHERE team_id = $1 AND deleted_at IS NULL ORDER BY lower(name), id;

-- name: UpdateAgentProfile :one
UPDATE agents
SET slug = @slug, name = @name, description = @description, accent_color = @accent_color,
    welcome_message = @welcome_message, starter_questions = @starter_questions,
    draft = @draft, draft_revision = draft_revision + CASE WHEN @draft_changed::bool THEN 1 ELSE 0 END,
    revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: SetAgentDraft :one
UPDATE agents SET draft = @draft, draft_revision = draft_revision + 1, revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: SetAgentPublished :one
UPDATE agents SET published_version_id = @version_id, revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: SetAgentStatus :one
UPDATE agents
SET status = @status, disabled_reason = @disabled_reason, disabled_by = @disabled_by, disabled_at = @disabled_at,
    revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: SoftDeleteAgent :exec
UPDATE agents SET deleted_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1;

-- ---- versions --------------------------------------------------------------

-- name: NextAgentVersion :one
SELECT coalesce(max(version), 0)::int + 1 FROM agent_versions WHERE agent_id = $1;

-- name: InsertAgentVersion :one
INSERT INTO agent_versions (agent_id, version, config, chat_model_id, effective_rank, note, published_by)
VALUES (@agent_id, @version, @config, @chat_model_id, @effective_rank, @note, @published_by)
RETURNING *;

-- name: InsertAgentVersionKB :exec
INSERT INTO agent_version_kbs (version_id, kb_id) VALUES (@version_id, @kb_id);

-- name: GetAgentVersion :one
SELECT * FROM agent_versions WHERE id = $1;

-- name: GetAgentVersionByNumber :one
SELECT * FROM agent_versions WHERE agent_id = @agent_id AND version = @version;

-- name: ListAgentVersions :many
SELECT v.*, coalesce(u.display_name, '')::text AS published_by_name
FROM agent_versions v LEFT JOIN users u ON u.id = v.published_by
WHERE v.agent_id = $1 ORDER BY v.version DESC;

-- name: VersionsByIDs :many
SELECT * FROM agent_versions WHERE id = ANY(@ids::uuid[]);

-- ---- KB usage (kb_in_use) -------------------------------------------------------

-- Live agents whose published version searches a KB.
-- name: AgentsPublishingKB :many
SELECT a.id, a.name, a.slug
FROM agents a JOIN agent_version_kbs vk ON vk.version_id = a.published_version_id
WHERE vk.kb_id = $1 AND a.deleted_at IS NULL
ORDER BY lower(a.name);

-- Rows of versions that are no longer served (older versions, deleted agents).
-- name: DeleteUnservedVersionKB :exec
DELETE FROM agent_version_kbs vk
WHERE vk.kb_id = $1
  AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.published_version_id = vk.version_id AND a.deleted_at IS NULL);

-- name: AgentsWithDraftKB :many
SELECT * FROM agents
WHERE team_id = @team_id AND deleted_at IS NULL
  AND draft -> 'kbs' @> jsonb_build_array(jsonb_build_object('kbId', @kb_id::text))
FOR UPDATE;

-- ---- ranks and policy -------------------------------------------------------------

-- Current rank of each KB (max over its sources; 0 without sources) with
-- the embedding model's ceiling.
-- name: KBPolicyRows :many
SELECT kb.id, kb.team_id, kb.name, kb.embedding_profile_id,
       coalesce((SELECT max(cl.rank) FROM kb_sources ks
                 JOIN data_sources s ON s.id = ks.source_id
                 JOIN classification_levels cl ON cl.key = s.classification
                 WHERE ks.kb_id = kb.id), 0)::int AS rank,
       m.enabled AS embed_model_enabled, ml.rank::int AS embed_model_rank, m.display_name AS embed_model_name
FROM knowledge_bases kb
JOIN embedding_profiles p ON p.id = kb.embedding_profile_id
JOIN models m ON m.id = p.model_id
JOIN classification_levels ml ON ml.key = m.max_classification
WHERE kb.id = ANY(@ids::uuid[]);

-- name: ClassificationByRank :one
SELECT * FROM classification_levels WHERE rank <= $1 ORDER BY rank DESC LIMIT 1;

-- name: ListClassificationLevels :many
SELECT * FROM classification_levels ORDER BY rank;

-- name: ModelWithRank :one
SELECT m.*, cl.rank::int AS max_rank, c.enabled AS connection_enabled
FROM models m
JOIN classification_levels cl ON cl.key = m.max_classification
JOIN model_connections c ON c.id = m.connection_id
WHERE m.id = $1;

-- ---- directory -------------------------------------------------------------------

-- Published, active agents of the teams a user belongs to.
-- name: DirectoryForUser :many
SELECT a.*, t.slug AS team_slug, t.name AS team_name
FROM agents a
JOIN teams t ON t.id = a.team_id
JOIN team_members tm ON tm.team_id = a.team_id AND tm.user_id = @user_id
WHERE a.deleted_at IS NULL AND a.published_version_id IS NOT NULL AND a.status = 'active' AND t.status = 'active'
ORDER BY lower(a.name), a.id;

-- name: DirectoryForTeam :many
SELECT a.*, t.slug AS team_slug, t.name AS team_name
FROM agents a JOIN teams t ON t.id = a.team_id
WHERE a.team_id = @team_id AND a.deleted_at IS NULL AND a.published_version_id IS NOT NULL
  AND a.status = 'active' AND t.status = 'active'
ORDER BY lower(a.name), a.id;

-- name: AdminListAgents :many
SELECT a.*, t.slug AS team_slug, t.name AS team_name,
       v.version AS published_version, v.effective_rank AS published_rank, v.published_at,
       m.display_name AS chat_model_name, sn.short_name,
       coalesce(g.principal_type, 'team')::text AS audience
FROM agents a
JOIN teams t ON t.id = a.team_id
LEFT JOIN agent_versions v ON v.id = a.published_version_id
LEFT JOIN models m ON m.id = v.chat_model_id
LEFT JOIN agent_short_names sn ON sn.agent_id = a.id
LEFT JOIN agent_audience_grants g ON g.agent_id = a.id
WHERE a.deleted_at IS NULL
  AND (sqlc.narg(team)::text IS NULL OR t.slug = sqlc.narg(team)::text OR t.id::text = sqlc.narg(team)::text)
  AND (sqlc.narg(status)::text IS NULL OR a.status = sqlc.narg(status)::text)
ORDER BY t.slug, lower(a.name), a.id
LIMIT 1000;

-- ---- conversations ---------------------------------------------------------------

-- name: InsertConversation :one
INSERT INTO conversations (agent_id, user_id, title, last_version_id)
VALUES (@agent_id, @user_id::uuid, @title, @last_version_id)
RETURNING *;

-- name: GetConversation :one
SELECT * FROM conversations WHERE id = $1 AND deleted_at IS NULL;

-- name: LockConversation :one
SELECT * FROM conversations WHERE id = $1 AND deleted_at IS NULL FOR UPDATE;

-- name: TouchConversation :exec
UPDATE conversations SET updated_at = now(), last_version_id = @last_version_id WHERE id = @id;

-- name: RenameConversation :one
UPDATE conversations SET title = @title WHERE id = @id RETURNING *;

-- name: SoftDeleteConversation :exec
UPDATE conversations SET deleted_at = now() WHERE id = $1;

-- name: ListConversations :many
SELECT c.*, a.name AS agent_name, a.slug AS agent_slug, t.slug AS team_slug,
       (a.deleted_at IS NOT NULL)::bool AS agent_deleted
FROM conversations c
JOIN agents a ON a.id = c.agent_id
JOIN teams t ON t.id = a.team_id
WHERE c.user_id = @user_id::uuid AND c.deleted_at IS NULL
  AND (sqlc.narg(agent_id)::uuid IS NULL OR c.agent_id = sqlc.narg(agent_id)::uuid)
  -- A personal API key reaches its team's agents only, or the ones it names.
  AND (sqlc.narg(team_id)::uuid IS NULL OR a.team_id = sqlc.narg(team_id)::uuid)
  AND (sqlc.narg(agent_ids)::uuid[] IS NULL OR c.agent_id = ANY(sqlc.narg(agent_ids)::uuid[]))
  AND (sqlc.narg(search)::text IS NULL
       OR (c.title || ' ' || a.name) ILIKE '%' || sqlc.narg(search)::text || '%' ESCAPE '\')
  AND (sqlc.narg(updated_from)::timestamptz IS NULL OR c.updated_at >= sqlc.narg(updated_from)::timestamptz)
  AND (sqlc.narg(updated_to)::timestamptz IS NULL OR c.updated_at < sqlc.narg(updated_to)::timestamptz)
  AND (sqlc.narg(before_updated)::timestamptz IS NULL
       OR (c.updated_at, c.id) < (sqlc.narg(before_updated)::timestamptz, sqlc.narg(before_id)::uuid))
ORDER BY c.updated_at DESC, c.id DESC
LIMIT @page_size;

-- name: NextMessageSeq :one
SELECT coalesce(max(seq), 0)::int + 1 FROM messages WHERE conversation_id = $1;

-- name: InsertMessage :one
INSERT INTO messages (id, conversation_id, seq, role, content, citations, agent_version_id, model_id, usage,
                      stop_reason, error_code, latency_ms, retrieval)
VALUES (@id, @conversation_id, @seq, @role, @content, @citations, @agent_version_id, @model_id, @usage,
        @stop_reason, @error_code, @latency_ms, @retrieval)
RETURNING *;

-- name: ListMessages :many
-- citation_check is the answer's content-free citation check record (NULL:
-- not checked), and answer_refused and answer_no_context its analytics flags.
SELECT m.*, e.feedback, e.feedback_reason, coalesce(e.feedback_shared, false)::bool AS feedback_shared, e.citations AS citation_check,
       coalesce(e.refused, false)::bool AS answer_refused, coalesce(e.no_context, false)::bool AS answer_no_context
FROM messages m LEFT JOIN message_events e ON e.message_id = m.id
WHERE m.conversation_id = $1
ORDER BY m.seq;

-- name: GetMessageOwner :one
SELECT m.id, m.role, c.user_id, c.agent_id
FROM messages m JOIN conversations c ON c.id = m.conversation_id
WHERE m.id = $1 AND c.deleted_at IS NULL;

-- ---- analytics events and access log ------------------------------------------------

-- name: InsertMessageEvent :exec
INSERT INTO message_events (team_id, agent_id, agent_version_id, message_id, channel, audience_type, model_id,
                            latency_ms, first_token_ms, input_tokens, output_tokens, reasoning_tokens,
                            hit_count, top_similarity, no_context, refused, tool_calls, cited_document_ids,
                            stop_reason, error_code, pseudonymous_user, moderation_input, moderation_output, judging,
                            citations, scope, cached, cache_entry_id, tokens_saved)
VALUES (@team_id, @agent_id, @agent_version_id, @message_id, @channel, @audience_type, @model_id,
        @latency_ms, @first_token_ms, @input_tokens, @output_tokens, @reasoning_tokens,
        @hit_count, @top_similarity, @no_context, @refused, @tool_calls, @cited_document_ids,
        @stop_reason, @error_code, @pseudonymous_user, @moderation_input, @moderation_output, @judging,
        @citations, @scope, @cached, @cache_entry_id, @tokens_saved);

-- name: SetMessageFeedback :execrows
UPDATE message_events SET feedback = @feedback, feedback_reason = @feedback_reason, feedback_shared = @feedback_shared, feedback_at = now()
WHERE message_id = @message_id;

-- name: InsertAccessLog :exec
INSERT INTO access_log (user_id, api_key_id, agent_id, agent_version_id, rank, channel)
VALUES (@user_id, @api_key_id, @agent_id, @agent_version_id, @rank, @channel);

-- name: ListAccessLog :many
SELECT l.*, coalesce(u.email, '')::text AS user_email, coalesce(u.display_name, '')::text AS user_name,
       coalesce(a.name, '')::text AS agent_name, coalesce(a.slug, '')::text AS agent_slug,
       coalesce(t.slug, '')::text AS team_slug, v.version AS agent_version,
       coalesce(cl.key, '')::text AS classification
FROM access_log l
LEFT JOIN users u ON u.id = l.user_id
LEFT JOIN agents a ON a.id = l.agent_id
LEFT JOIN teams t ON t.id = a.team_id
LEFT JOIN agent_versions v ON v.id = l.agent_version_id
LEFT JOIN classification_levels cl ON cl.rank = l.rank
WHERE (sqlc.narg(from_at)::timestamptz IS NULL OR l.at >= sqlc.narg(from_at)::timestamptz)
  AND (sqlc.narg(to_at)::timestamptz IS NULL OR l.at < sqlc.narg(to_at)::timestamptz)
  AND (sqlc.narg(agent_id)::uuid IS NULL OR l.agent_id = sqlc.narg(agent_id)::uuid)
  AND (sqlc.narg(user_id)::uuid IS NULL OR l.user_id = sqlc.narg(user_id)::uuid)
  AND (sqlc.narg(channel)::text IS NULL OR l.channel = sqlc.narg(channel)::text)
  AND (sqlc.narg(before_at)::timestamptz IS NULL
       OR (l.at, l.id) < (sqlc.narg(before_at)::timestamptz, sqlc.narg(before_id)::bigint))
ORDER BY l.at DESC, l.id DESC
LIMIT @page_size;

-- name: DocumentTitles :many
SELECT id, CASE WHEN title <> '' THEN title WHEN filename <> '' THEN filename ELSE url END::text AS title
FROM documents WHERE id = ANY(@ids::uuid[]);
