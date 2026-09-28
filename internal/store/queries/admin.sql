-- The admin Overview (docs/ui-review A1): platform counts, failed ingestion
-- by team, and each active team's resource usage (checked against its
-- effective limits in Go).

-- name: AdminOverviewCounts :one
SELECT (SELECT count(*) FROM teams WHERE status = 'active')::bigint AS active_teams,
       (SELECT count(*) FROM teams WHERE status = 'archived')::bigint AS archived_teams,
       (SELECT count(*) FROM users)::bigint AS users,
       (SELECT count(*) FROM users WHERE status = 'suspended')::bigint AS suspended_users,
       (SELECT count(*) FROM users WHERE last_login_at >= now() - interval '7 days')::bigint AS users_signed_in_7d,
       (SELECT count(*) FROM users WHERE platform_role = 'platform_admin' AND status = 'active')::bigint AS platform_admins,
       (SELECT count(*) FROM documents)::bigint AS documents,
       (SELECT count(*) FROM documents WHERE status = 'failed')::bigint AS failed_documents,
       (SELECT coalesce(sum(chunk_count), 0) FROM documents)::bigint AS passages,
       (SELECT coalesce(sum(size_bytes), 0) FROM documents)::bigint AS storage_bytes,
       (SELECT count(*) FROM data_sources WHERE team_id IS NULL)::bigint AS shared_sources;

-- Failed documents per team; team_id NULL is the platform-shared sources.
-- name: FailedDocumentsByTeam :many
SELECT d.team_id, coalesce(t.slug, '')::text AS team_slug, coalesce(t.name, '')::text AS team_name, count(*)::bigint AS failed
FROM documents d
LEFT JOIN teams t ON t.id = d.team_id
WHERE d.status = 'failed'
GROUP BY d.team_id, t.slug, t.name
ORDER BY count(*) DESC, t.name
LIMIT 10;

-- The resource-cap usage of every active team (at most 500).
-- name: ActiveTeamResourceUsage :many
SELECT t.id, t.slug, t.name,
       (SELECT count(*) FROM documents d WHERE d.team_id = t.id)::bigint AS documents,
       (SELECT coalesce(sum(d.size_bytes), 0) FROM documents d WHERE d.team_id = t.id)::bigint AS storage_bytes,
       (SELECT count(*) FROM data_sources ds WHERE ds.team_id = t.id)::bigint AS data_sources,
       (SELECT count(*) FROM knowledge_bases kb WHERE kb.team_id = t.id)::bigint AS knowledge_bases,
       (SELECT count(*) FROM agents ag WHERE ag.team_id = t.id AND ag.deleted_at IS NULL)::bigint AS agents
FROM teams t
WHERE t.status = 'active'
ORDER BY t.slug
LIMIT 500;

-- What uses each catalog model (the admin catalog's "Used by", A5):
-- published agents (their published version's chat model), agent drafts,
-- embedding profiles, moderation policies and the SystemOne settings.
-- name: ModelUsage :many
SELECT m.id,
       (SELECT count(*) FROM agents ag JOIN agent_versions v ON v.id = ag.published_version_id
         WHERE ag.deleted_at IS NULL AND v.chat_model_id = m.id)::bigint AS published_agents,
       (SELECT count(*) FROM agents ag
         WHERE ag.deleted_at IS NULL AND ag.draft->>'chatModelId' = m.id::text)::bigint AS draft_agents,
       (SELECT count(*) FROM embedding_profiles p WHERE p.model_id = m.id)::bigint AS profiles,
       coalesce((SELECT array_agg(mp.audience ORDER BY mp.audience) FROM moderation_policies mp WHERE mp.model_id = m.id), '{}')::text[] AS moderation_audiences,
       EXISTS (SELECT 1 FROM systemone_settings so WHERE so.model_id = m.id) AS systemone
FROM models m
ORDER BY m.id;

-- What uses each embedding profile: data sources (team and shared) and knowledge bases.
-- name: ProfileUsage :many
SELECT p.id,
       (SELECT count(*) FROM data_sources ds WHERE ds.embedding_profile_id = p.id)::bigint AS sources,
       (SELECT count(*) FROM knowledge_bases kb WHERE kb.embedding_profile_id = p.id)::bigint AS knowledge_bases
FROM embedding_profiles p
ORDER BY p.id;

-- Every knowledge base a platform-shared source is attached to, with its
-- team (the admin Shared sources' Used by, A6; DESIGN §4 rule 6).
-- name: SharedSourceAttachments :many
SELECT ks.source_id, kb.id AS kb_id, kb.name AS kb_name,
       t.slug AS team_slug, t.name AS team_name, t.max_classification AS team_max_classification
FROM kb_sources ks
JOIN data_sources ds ON ds.id = ks.source_id AND ds.team_id IS NULL
JOIN knowledge_bases kb ON kb.id = ks.kb_id
JOIN teams t ON t.id = kb.team_id
ORDER BY t.name, kb.name;
