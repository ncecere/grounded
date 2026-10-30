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
SELECT r.*, t.slug AS team_slug, t.name AS team_name,
       -- The level the reviewer approved. '' in the column is a request approved before migration 00055 or by a previous release's pod running
       -- next to this one (#195: the migration does not backfill): then what the approval recorded in the audit log, by the index on
       -- (target_type, target_id, id DESC), else the team's level now, else the level asked for. Only those rows look anything up.
       (CASE WHEN r.status <> 'approved' THEN ''
             WHEN r.approved_classification <> '' THEN r.approved_classification
             ELSE COALESCE(
                 (SELECT a.after_state->>'classification' FROM audit_log a
                   WHERE a.target_type = 'team_request' AND a.target_id = r.id::text AND a.action = 'team_request.approve'
                     AND a.after_state->>'classification' IS NOT NULL
                   ORDER BY a.id DESC LIMIT 1),
                 t.max_classification, r.classification)
        END)::text AS approved_level
FROM team_requests r LEFT JOIN teams t ON t.id = r.team_id
WHERE r.requester_id = $1
ORDER BY r.created_at DESC
LIMIT 100;

-- The review queue: pending first (oldest first, so nobody waits behind newer ones), then decided ones, newest first.
-- name: ListTeamRequestsAdmin :many
SELECT r.*, t.slug AS team_slug, t.name AS team_name,
       -- The level the reviewer approved: as in ListMyTeamRequests (the audit log lookup is for rows migration 00055 did not fill, #195).
       (CASE WHEN r.status <> 'approved' THEN ''
             WHEN r.approved_classification <> '' THEN r.approved_classification
             ELSE COALESCE(
                 (SELECT a.after_state->>'classification' FROM audit_log a
                   WHERE a.target_type = 'team_request' AND a.target_id = r.id::text AND a.action = 'team_request.approve'
                     AND a.after_state->>'classification' IS NOT NULL
                   ORDER BY a.id DESC LIMIT 1),
                 t.max_classification, r.classification)
        END)::text AS approved_level,
       u.email::text AS requester_email, COALESCE(NULLIF(u.display_name, ''), u.email::text)::text AS requester_name,
       COALESCE(d.email::text, '')::text AS decider_email,
       (r.status = 'pending' AND EXISTS (SELECT 1 FROM users o WHERE o.status = 'suspended' AND o.email = COALESCE(NULLIF(r.owner_email, ''), u.email))) AS owner_suspended
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
       -- The level the reviewer approved: as in ListMyTeamRequests (the audit log lookup is for rows migration 00055 did not fill, #195).
       (CASE WHEN r.status <> 'approved' THEN ''
             WHEN r.approved_classification <> '' THEN r.approved_classification
             ELSE COALESCE(
                 (SELECT a.after_state->>'classification' FROM audit_log a
                   WHERE a.target_type = 'team_request' AND a.target_id = r.id::text AND a.action = 'team_request.approve'
                     AND a.after_state->>'classification' IS NOT NULL
                   ORDER BY a.id DESC LIMIT 1),
                 t.max_classification, r.classification)
        END)::text AS approved_level,
       u.email::text AS requester_email, COALESCE(NULLIF(u.display_name, ''), u.email::text)::text AS requester_name,
       COALESCE(d.email::text, '')::text AS decider_email,
       (r.status = 'pending' AND EXISTS (SELECT 1 FROM users o WHERE o.status = 'suspended' AND o.email = COALESCE(NULLIF(r.owner_email, ''), u.email))) AS owner_suspended
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
SET status = $2, decision_reason = $3, decided_by = $4, decided_at = now(), team_id = $5, approved_classification = $6, revision = revision + 1, updated_at = now()
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

-- Accounts with this email that are suspended: one cannot own a new team.
-- name: CountSuspendedUsersByEmail :one
SELECT count(*) FROM users WHERE email = @email AND status = 'suspended';
