-- In-app team requests (v0.6.0, E3).

-- name: GetTeamRequestSettings :one
SELECT * FROM team_request_settings;

-- name: LockTeamRequestSettings :one
SELECT * FROM team_request_settings FOR UPDATE;

-- name: SetTeamRequestSettings :one
UPDATE team_request_settings
SET enabled = $1, max_open = $2, allowed_group = $3, revision = revision + 1, updated_by = $4, updated_at = now()
RETURNING *;

-- The groups a person's last sign-in carried (lower-cased); no row: none seen.
-- name: UserSSOGroups :one
SELECT groups FROM sso_user_groups WHERE user_id = $1;

-- name: InsertTeamRequest :one
INSERT INTO team_requests (requester_id, name, purpose, owner_email, classification)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: CountOpenTeamRequests :one
SELECT count(*) FROM team_requests WHERE requester_id = $1 AND status = 'pending';

-- A person's own requests, newest first.
-- name: ListMyTeamRequests :many
SELECT r.*, t.slug AS team_slug, t.name AS team_name
FROM team_requests r LEFT JOIN teams t ON t.id = r.team_id
WHERE r.requester_id = $1
ORDER BY r.created_at DESC
LIMIT 100;

-- The review queue: pending first (oldest first, so nobody waits behind newer ones), then decided ones, newest first.
-- name: ListTeamRequestsAdmin :many
SELECT r.*, t.slug AS team_slug, t.name AS team_name,
       u.email::text AS requester_email, COALESCE(NULLIF(u.display_name, ''), u.email::text)::text AS requester_name,
       COALESCE(d.email::text, '')::text AS decider_email
FROM team_requests r
JOIN users u ON u.id = r.requester_id
LEFT JOIN users d ON d.id = r.decided_by
LEFT JOIN teams t ON t.id = r.team_id
WHERE (sqlc.narg('status')::text IS NULL OR r.status = sqlc.narg('status')::text)
ORDER BY (r.status = 'pending') DESC,
         CASE WHEN r.status = 'pending' THEN r.created_at END ASC,
         r.created_at DESC
LIMIT 200;

-- name: GetTeamRequest :one
SELECT r.*, t.slug AS team_slug, t.name AS team_name,
       u.email::text AS requester_email, COALESCE(NULLIF(u.display_name, ''), u.email::text)::text AS requester_name,
       COALESCE(d.email::text, '')::text AS decider_email
FROM team_requests r
JOIN users u ON u.id = r.requester_id
LEFT JOIN users d ON d.id = r.decided_by
LEFT JOIN teams t ON t.id = r.team_id
WHERE r.id = $1;

-- name: LockTeamRequest :one
SELECT * FROM team_requests WHERE id = $1 FOR UPDATE;

-- A decision: pending only, so two reviewers cannot both decide.
-- name: DecideTeamRequest :one
UPDATE team_requests
SET status = $2, decision_reason = $3, decided_by = $4, decided_at = now(), team_id = $5, revision = revision + 1, updated_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING *;

-- name: WithdrawTeamRequest :one
UPDATE team_requests
SET status = 'withdrawn', revision = revision + 1, updated_at = now()
WHERE id = $1 AND requester_id = $2 AND status = 'pending'
RETURNING *;

-- name: CountPendingTeamRequests :one
SELECT count(*) FROM team_requests WHERE status = 'pending';

-- name: GetTeamRequestRequesterName :one
SELECT COALESCE(NULLIF(display_name, ''), email::text)::text FROM users WHERE id = $1;

-- name: GetTeamRequestRequesterEmail :one
SELECT email::text FROM users WHERE id = $1;
