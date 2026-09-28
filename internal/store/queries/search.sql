-- The command palette's object search (GET /v1/search, internal/search).
-- Every query takes the same three patterns, built from the caller's text:
--   @contains  '%text%' (ILIKE, escaped): the filter, served by the trigram
--              indexes of 00033
--   @prefix    'text%'  (ILIKE, escaped): rank 0
--   @word      '\mtext' (a case-insensitive regex, quoted): rank 1, a word
--              of the name starts with the text
-- anything else that contains the text ranks 2. Each query returns its best
-- @lim rows; the service merges them.

-- ---- platform staff (admins and auditors) --------------------------------------

-- name: SearchTeams :many
SELECT t.id, t.slug, t.name, t.status,
       (CASE WHEN t.name ILIKE @prefix::text THEN 0 WHEN t.name ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM teams t
WHERE t.name ILIKE @contains::text
ORDER BY rank, length(t.name), lower(t.name), t.id
LIMIT @lim;

-- name: SearchUsers :many
SELECT u.id, u.email, u.display_name, u.status,
       LEAST(CASE WHEN u.display_name ILIKE @prefix::text THEN 0 WHEN u.display_name ~* @word::text THEN 1 ELSE 2 END,
             CASE WHEN u.email::text ILIKE @prefix::text THEN 0 WHEN u.email::text ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM users u
WHERE (u.display_name || ' ' || u.email::text) ILIKE @contains::text
ORDER BY rank, length(coalesce(nullif(u.display_name, ''), u.email::text)), lower(u.display_name), u.email, u.id
LIMIT @lim;

-- name: SearchModels :many
SELECT m.id, m.display_name, m.key, m.kind, m.enabled,
       LEAST(CASE WHEN m.display_name ILIKE @prefix::text THEN 0 WHEN m.display_name ~* @word::text THEN 1 ELSE 2 END,
             CASE WHEN m.key ILIKE @prefix::text THEN 0 WHEN m.key ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM models m
WHERE m.display_name ILIKE @contains::text OR m.key ILIKE @contains::text
ORDER BY rank, length(m.display_name), lower(m.display_name), m.id
LIMIT @lim;

-- name: SearchConnections :many
SELECT c.id, c.name, c.base_url, c.enabled,
       (CASE WHEN c.name ILIKE @prefix::text THEN 0 WHEN c.name ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM model_connections c
WHERE c.name ILIKE @contains::text
ORDER BY rank, length(c.name), lower(c.name), c.id
LIMIT @lim;

-- name: SearchEmbeddingProfiles :many
SELECT p.id, p.name, p.key, p.status,
       LEAST(CASE WHEN p.name ILIKE @prefix::text THEN 0 WHEN p.name ~* @word::text THEN 1 ELSE 2 END,
             CASE WHEN p.key ILIKE @prefix::text THEN 0 WHEN p.key ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM embedding_profiles p
WHERE p.name ILIKE @contains::text OR p.key ILIKE @contains::text
ORDER BY rank, length(p.name), lower(p.name), p.id
LIMIT @lim;

-- name: SearchSharedSources :many
SELECT s.id, s.name, s.type, s.status,
       (CASE WHEN s.name ILIKE @prefix::text THEN 0 WHEN s.name ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM data_sources s
WHERE s.team_id IS NULL AND s.name ILIKE @contains::text
ORDER BY rank, length(s.name), lower(s.name), s.id
LIMIT @lim;

-- ---- everyone --------------------------------------------------------------------

-- Agents the user may open or chat with: every agent of the user's teams
-- (members see their team's agents), and the published, active agents of
-- active teams they may chat with as the directory lists them
-- (all_authenticated, or public while the public switch is on).
-- name: SearchAgents :many
SELECT a.id, a.name, a.slug, t.slug AS team_slug, t.name AS team_name,
       (tm.user_id IS NOT NULL)::bool AS member,
       (a.published_version_id IS NOT NULL AND a.status = 'active' AND t.status = 'active')::bool AS chat,
       (CASE WHEN a.name ILIKE @prefix::text THEN 0 WHEN a.name ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM agents a
JOIN teams t ON t.id = a.team_id
LEFT JOIN team_members tm ON tm.team_id = a.team_id AND tm.user_id = @user_id::uuid
LEFT JOIN agent_audience_grants g ON g.agent_id = a.id
WHERE a.deleted_at IS NULL AND a.name ILIKE @contains::text
  AND (tm.user_id IS NOT NULL
       OR (a.published_version_id IS NOT NULL AND a.status = 'active' AND t.status = 'active'
           AND (g.principal_type = 'all_authenticated' OR (g.principal_type = 'public' AND @public_enabled::bool))))
ORDER BY rank, length(a.name), lower(a.name), a.id
LIMIT @lim;

-- The knowledge bases of the user's teams.
-- name: SearchKnowledgeBases :many
SELECT kb.id, kb.name, t.slug AS team_slug, t.name AS team_name,
       (CASE WHEN kb.name ILIKE @prefix::text THEN 0 WHEN kb.name ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM knowledge_bases kb
JOIN team_members tm ON tm.team_id = kb.team_id AND tm.user_id = @user_id::uuid
JOIN teams t ON t.id = kb.team_id
WHERE kb.name ILIKE @contains::text
ORDER BY rank, length(kb.name), lower(kb.name), kb.id
LIMIT @lim;

-- The data sources of the user's teams (shared sources are platform
-- objects, searched by staff).
-- name: SearchDataSources :many
SELECT s.id, s.name, s.type, s.status, t.slug AS team_slug, t.name AS team_name,
       (CASE WHEN s.name ILIKE @prefix::text THEN 0 WHEN s.name ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM data_sources s
JOIN team_members tm ON tm.team_id = s.team_id AND tm.user_id = @user_id::uuid
JOIN teams t ON t.id = s.team_id
WHERE s.name ILIKE @contains::text
ORDER BY rank, length(s.name), lower(s.name), s.id
LIMIT @lim;

-- The user's own conversations by title (never anyone else's; deleted
-- ones are gone), most recent first within a rank.
-- name: SearchConversations :many
SELECT c.id, c.title, a.name AS agent_name, a.slug AS agent_slug, t.slug AS team_slug,
       (a.deleted_at IS NOT NULL)::bool AS agent_deleted,
       (CASE WHEN c.title ILIKE @prefix::text THEN 0 WHEN c.title ~* @word::text THEN 1 ELSE 2 END)::int AS rank
FROM conversations c
JOIN agents a ON a.id = c.agent_id
JOIN teams t ON t.id = a.team_id
WHERE c.user_id = @user_id::uuid AND c.deleted_at IS NULL AND c.title ILIKE @contains::text
ORDER BY rank, c.updated_at DESC, c.id DESC
LIMIT @lim;
