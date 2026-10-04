-- name: GetRerankSettings :one
SELECT * FROM rerank_settings WHERE singleton;

-- name: LockRerankSettings :one
SELECT * FROM rerank_settings WHERE singleton FOR UPDATE;

-- name: InsertRerankSettings :one
INSERT INTO rerank_settings (model_id, settings, updated_by)
VALUES (@model_id, @settings, @updated_by)
ON CONFLICT (singleton) DO NOTHING
RETURNING *;

-- name: UpdateRerankSettings :one
UPDATE rerank_settings
SET model_id = @model_id, settings = @settings, updated_by = @updated_by,
    revision = revision + 1, updated_at = now()
WHERE singleton
RETURNING *;

-- name: CountRerankAgents :one
-- Published, active agents in active teams that rerank (their published
-- version doesn't turn it off; docs/v0.4.0.md §3).
SELECT count(*)::int
FROM agents a
JOIN teams t ON t.id = a.team_id
JOIN agent_versions v ON v.id = a.published_version_id
WHERE a.deleted_at IS NULL AND a.status = 'active' AND t.status = 'active'
  AND coalesce((v.config->>'rerank')::boolean, true);

-- name: ListRerankOffAgents :many
-- Published, active agents in active teams whose published version turns
-- reranking off (Admin → Models → Reranking lists them, docs/v0.4.2.md OW-2).
SELECT a.id, a.name, t.slug AS team_slug, t.name AS team_name
FROM agents a
JOIN teams t ON t.id = a.team_id
JOIN agent_versions v ON v.id = a.published_version_id
WHERE a.deleted_at IS NULL AND a.status = 'active' AND t.status = 'active'
  AND NOT coalesce((v.config->>'rerank')::boolean, true)
ORDER BY t.name, a.name
LIMIT 100;
