-- name: GetSystemOneSettings :one
SELECT * FROM systemone_settings WHERE singleton;

-- name: LockSystemOneSettings :one
SELECT * FROM systemone_settings WHERE singleton FOR UPDATE;

-- name: InsertSystemOneSettings :one
INSERT INTO systemone_settings (model_id, settings, updated_by)
VALUES (@model_id, @settings, @updated_by)
ON CONFLICT (singleton) DO NOTHING
RETURNING *;

-- name: UpdateSystemOneSettings :one
UPDATE systemone_settings
SET model_id = @model_id, settings = @settings, updated_by = @updated_by,
    revision = revision + 1, updated_at = now()
WHERE singleton
RETURNING *;

-- name: CountSystemOneAgents :one
-- Published, active agents in active teams each SystemOne check is on for:
-- the published version's "SystemOne checks" setting (on or off), else the
-- platform default (docs/systemone.md §2; the admin Overview's Features card).
WITH checks AS (
    SELECT coalesce(nullif(v.config->'systemOne'->>'judging', ''), CASE WHEN @judging::bool THEN 'on' ELSE 'off' END) = 'on' AS judging,
           coalesce(nullif(v.config->'systemOne'->>'citations', ''), CASE WHEN @citations::bool THEN 'on' ELSE 'off' END) = 'on' AS citations,
           coalesce(nullif(v.config->'systemOne'->>'scope', ''), CASE WHEN @scope::bool THEN 'on' ELSE 'off' END) = 'on' AS scope
    FROM agents a
    JOIN teams t ON t.id = a.team_id
    JOIN agent_versions v ON v.id = a.published_version_id
    WHERE a.deleted_at IS NULL AND a.status = 'active' AND t.status = 'active'
)
SELECT count(*) FILTER (WHERE judging)::int AS judging,
       count(*) FILTER (WHERE citations)::int AS citations,
       count(*) FILTER (WHERE scope)::int AS scope,
       count(*) FILTER (WHERE judging OR citations OR scope)::int AS any_check
FROM checks;
