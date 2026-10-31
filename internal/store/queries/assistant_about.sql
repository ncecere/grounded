-- Metadata only, bounded by published KBs and team. Never returns source identities.
-- name: AssistantAboutSources :one
WITH selected AS MATERIALIZED (
 SELECT DISTINCT s.id FROM kb_sources ks
 JOIN knowledge_bases kb ON kb.id = ks.kb_id AND kb.team_id = @team_id
 JOIN data_sources s ON s.id = ks.source_id
 WHERE ks.kb_id = ANY(@kb_ids::uuid[])
 ORDER BY s.id LIMIT 501
), observations AS MATERIALIZED (
 SELECT d.processed_at FROM documents d JOIN selected s ON s.id = d.source_id
 WHERE d.status = 'ready' AND d.processed_at IS NOT NULL
 LIMIT 10001
)
SELECT (SELECT count(*) FROM selected)::int AS source_count,
 coalesce(CASE WHEN (SELECT count(*) FROM selected) <= 500 AND (SELECT count(*) FROM observations) <= 10000
 THEN (SELECT max(processed_at) FROM observations) ELSE NULL END, 'epoch'::timestamptz)::timestamptz AS last_processed_at;
