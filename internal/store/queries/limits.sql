-- Team limits (internal/limits, DESIGN.md §11.1).

-- name: GetPlatformLimits :one
SELECT * FROM platform_limits WHERE singleton;

-- name: LockPlatformLimits :one
SELECT * FROM platform_limits WHERE singleton FOR UPDATE;

-- name: UpdatePlatformLimits :one
UPDATE platform_limits
SET settings = @settings, revision = revision + 1, updated_by = @updated_by, updated_at = now()
WHERE singleton
RETURNING *;

-- name: GetTeamLimits :one
SELECT * FROM team_limits WHERE team_id = $1;

-- name: LockTeamLimits :one
SELECT * FROM team_limits WHERE team_id = $1 FOR UPDATE;

-- The first change of a team's overrides: revision 1 was the implicit
-- "no overrides" state. Zero rows means another admin inserted first.
-- name: InsertTeamLimits :execrows
INSERT INTO team_limits (team_id, overrides, revision, updated_by)
VALUES (@team_id, @overrides, 2, @updated_by)
ON CONFLICT (team_id) DO NOTHING;

-- name: UpdateTeamLimits :one
UPDATE team_limits
SET overrides = @overrides, revision = revision + 1, updated_by = @updated_by, updated_at = now()
WHERE team_id = @team_id
RETURNING *;

-- The platform settings and one team's overrides (NULL when it has none).
-- name: TeamLimitConfig :one
SELECT p.settings AS platform, t.overrides
FROM platform_limits p LEFT JOIN team_limits t ON t.team_id = @team_id
WHERE p.singleton;

-- Serialises changes that check a team's resource caps (uploads, crawled
-- pages, sources, knowledge bases), so two requests cannot both take the
-- last slot. Held until the transaction ends.
-- name: LockTeamUsage :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 7301));

-- Serialises admitting crawl runs of a team (concurrent_crawls).
-- name: LockTeamCrawlSlots :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 7302));

-- name: TeamDocumentUsage :one
SELECT count(*) AS documents, coalesce(sum(size_bytes), 0)::bigint AS storage_bytes
FROM documents WHERE team_id = $1;

-- name: CountTeamSources :one
SELECT count(*) FROM data_sources WHERE team_id = $1;

-- name: CountTeamKBs :one
SELECT count(*) FROM knowledge_bases WHERE team_id = $1;

-- name: TeamUsageSince :one
SELECT coalesce(sum(quantity), 0)::bigint
FROM usage_events WHERE team_id = @team_id AND kind = @kind AND occurred_at >= @since;

-- Crawl runs holding a slot: running, or queued and admitted (not waiting
-- for a slot).
-- name: CountCrawlSlots :one
SELECT count(*) FROM web_crawls
WHERE team_id = $1 AND status IN ('queued', 'running') AND waiting_reason <> 'concurrent_crawls';

-- name: CountTeamInflight :one
SELECT count(*) FROM documents WHERE team_id = $1 AND status IN ('queued', 'processing');
