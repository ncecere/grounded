-- Explicit projections: no content, credentials, encrypted values or raw connection settings.
-- Read under a read-only repeatable-read transaction; 501 is a refusal sentinel.
-- name: ExportConfigurationSources :many
SELECT s.id, s.name, s.description, s.type, (CASE WHEN octet_length(s.config::text)<=65536 THEN s.config ELSE NULL END)::jsonb AS config, s.classification, p.key AS profile,
 s.ocr_enabled, s.status,
 jsonb_strip_nulls(jsonb_build_object('enabled', b.enabled, 'minDocs', b.min_docs, 'ratio', b.ratio, 'fuzzy', b.fuzzy)) AS boilerplate,
 EXISTS (SELECT 1 FROM source_contextual c WHERE c.source_id=s.id) AS contextual,
 cl.rank, cl.direct_retrieve, ceiling.rank AS ceiling_rank
FROM data_sources s
JOIN embedding_profiles p ON p.id=s.embedding_profile_id
JOIN classification_levels cl ON cl.key=s.classification
JOIN teams t ON t.id=s.team_id
JOIN classification_levels ceiling ON ceiling.key=t.max_classification
LEFT JOIN source_boilerplate b ON b.source_id=s.id
WHERE s.team_id=$1 ORDER BY s.name COLLATE "C" LIMIT 501;

-- name: ExportConfigurationKBs :many
SELECT k.id, k.name, k.description, p.key AS profile, k.top_k, k.vector_weight, k.keyword_weight
FROM knowledge_bases k JOIN embedding_profiles p ON p.id=k.embedding_profile_id
WHERE k.team_id=$1 ORDER BY k.name COLLATE "C" LIMIT 501;

-- name: ExportConfigurationLinks :many
SELECT k.name AS kb, s.name, (s.team_id IS NULL)::bool AS shared,
 (s.team_id IS NOT NULL AND s.team_id<>k.team_id)::bool AS foreign_team,
 cl.rank, cl.direct_retrieve, ceiling.rank AS ceiling_rank
FROM kb_sources l JOIN knowledge_bases k ON k.id=l.kb_id
JOIN data_sources s ON s.id=l.source_id
JOIN classification_levels cl ON cl.key=s.classification
JOIN teams t ON t.id=k.team_id JOIN classification_levels ceiling ON ceiling.key=t.max_classification
WHERE k.team_id=$1 ORDER BY k.name COLLATE "C", (s.team_id IS NULL), s.name COLLATE "C" LIMIT 1001;

-- name: ExportConfigurationAgents :many
SELECT id, name, slug, description, accent_color, welcome_message, starter_questions, status, (CASE WHEN octet_length(draft::text)<=65536 THEN draft ELSE NULL END)::jsonb AS draft,
 published_version_id,
 EXISTS(SELECT 1 FROM agent_answer_cache c WHERE c.agent_id=agents.id) AS cache_settings,
 EXISTS(SELECT 1 FROM agent_short_names n WHERE n.agent_id=agents.id) AS short_names
FROM agents WHERE team_id=$1 AND deleted_at IS NULL ORDER BY name COLLATE "C" LIMIT 501;

-- name: ExportConfigurationVersions :many
SELECT v.agent_id, v.id, v.version, (CASE WHEN octet_length(v.config::text)<=65536 THEN v.config ELSE NULL END)::jsonb AS config, v.note, v.effective_rank, ceiling.rank AS ceiling_rank
FROM agent_versions v JOIN agents a ON a.id=v.agent_id
JOIN teams t ON t.id=a.team_id JOIN classification_levels ceiling ON ceiling.key=t.max_classification
WHERE a.team_id=$1 AND a.deleted_at IS NULL ORDER BY a.name COLLATE "C",v.version LIMIT 1001;

-- name: ExportConfigurationModel :one
SELECT m.key AS name, c.name AS connection FROM models m JOIN model_connections c ON c.id=m.connection_id WHERE m.id=$1;

-- name: ExportConfigurationEvalSets :many
SELECT s.id, s.name, s.description, s.auto_run, coalesce(k.name,'')::text AS kb, coalesce(a.slug,'')::text AS agent
FROM eval_sets s LEFT JOIN knowledge_bases k ON k.id=s.kb_id AND k.team_id=s.team_id
LEFT JOIN agents a ON a.id=s.agent_id AND a.team_id=s.team_id AND a.deleted_at IS NULL
WHERE s.team_id=$1 ORDER BY s.name COLLATE "C" LIMIT 501;

-- name: ExportConfigurationCases :many
SELECT c.question,(CASE WHEN octet_length(c.expected::text)<=65536 THEN c.expected ELSE NULL END)::jsonb AS expected,c.must_mention,c.note
FROM eval_cases c JOIN eval_sets s ON s.id=c.set_id
WHERE s.team_id=$1 AND s.id=$2 ORDER BY c.question COLLATE "C",c.expected::text,c.must_mention,c.note COLLATE "C" LIMIT 1001;

-- A team's webhooks without any signing material: no secret_cipher, secret_hint or delivery data.
-- name: ExportConfigurationWebhooks :many
SELECT url, description, events, enabled FROM webhooks WHERE team_id=$1 ORDER BY url COLLATE "C", created_at LIMIT 51;

-- Preflight returns only counts/byte lengths, never configuration payloads.
-- Sentinel limits also bound the metadata work if old writers exceeded caps.
-- name: ExportConfigurationBudget :one
WITH budget AS (
 (SELECT 1::bigint AS resources, 0::bigint AS versions, 0::bigint AS cases,
   (octet_length(name)+octet_length(description)+octet_length(config::text))::bigint AS raw_bytes
  FROM data_sources ds WHERE ds.team_id=$1 LIMIT 501)
 UNION ALL
 (SELECT 1::bigint,0::bigint,0::bigint,(octet_length(name)+octet_length(description))::bigint
  FROM knowledge_bases kb WHERE kb.team_id=$1 LIMIT 501)
 UNION ALL
 (SELECT 1::bigint,0::bigint,0::bigint,(octet_length(name)+octet_length(slug)+octet_length(description)+
   octet_length(welcome_message)+octet_length(starter_questions::text)+octet_length(draft::text))::bigint
  FROM agents ag WHERE ag.team_id=$1 AND ag.deleted_at IS NULL LIMIT 501)
 UNION ALL
 (SELECT 1::bigint,0::bigint,0::bigint,(octet_length(name)+octet_length(description))::bigint
  FROM eval_sets es WHERE es.team_id=$1 LIMIT 501)
 UNION ALL
 (SELECT 0::bigint,1::bigint,0::bigint,(octet_length(v.config::text)+octet_length(v.note))::bigint
  FROM agent_versions v JOIN agents a ON a.id=v.agent_id
  WHERE a.team_id=$1 AND a.deleted_at IS NULL LIMIT 1001)
 UNION ALL
 (SELECT 0::bigint,0::bigint,1::bigint,(octet_length(c.question)+octet_length(c.note)+
   octet_length(c.expected::text)+octet_length(c.must_mention::text))::bigint
  FROM eval_cases c JOIN eval_sets s ON s.id=c.set_id WHERE s.team_id=$1 LIMIT 1001)
)
SELECT coalesce(sum(resources),0)::bigint AS resources,
 coalesce(sum(versions),0)::bigint AS versions, coalesce(sum(cases),0)::bigint AS cases,
 coalesce(sum(raw_bytes),0)::bigint AS raw_bytes FROM budget;

-- name: ExportConfigurationEvalPresence :one
SELECT EXISTS(SELECT 1 FROM eval_sets WHERE team_id=$1);
