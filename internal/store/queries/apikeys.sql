-- name: InsertAPIKey :one
INSERT INTO api_keys (team_id, kind, user_id, name, prefix, secret_hash, pepper_id, scopes, kb_ids, agent_ids, expires_at, created_by)
VALUES (@team_id, @kind, @user_id, @name, @prefix, @secret_hash, @pepper_id, @scopes, @kb_ids, @agent_ids, @expires_at, @created_by)
RETURNING *;

-- name: GetAPIKeyByPrefix :one
SELECT sqlc.embed(k), t.status AS team_status
FROM api_keys k JOIN teams t ON t.id = k.team_id
WHERE k.prefix = $1;

-- name: GetAPIKey :one
SELECT * FROM api_keys WHERE id = $1;

-- name: ListTeamAPIKeys :many
-- With the owner (personal) or responsible contact (service) named.
SELECT sqlc.embed(k), coalesce(u.email::text, '')::text AS user_email, coalesce(u.display_name, '')::text AS user_name
FROM api_keys k LEFT JOIN users u ON u.id = k.user_id
WHERE k.team_id = @team_id AND k.revoked_at IS NULL
  AND (sqlc.narg(user_id)::uuid IS NULL OR (k.kind = 'personal' AND k.user_id = sqlc.narg(user_id)::uuid))
ORDER BY k.created_at DESC;

-- name: RevokeAPIKey :exec
UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokePersonalKeys :execrows
UPDATE api_keys SET revoked_at = now()
WHERE team_id = @team_id AND user_id = @user_id AND kind = 'personal' AND revoked_at IS NULL;

-- name: TouchAPIKey :exec
UPDATE api_keys SET last_used_at = now()
WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes');

-- name: IsTeamMember :one
SELECT EXISTS (SELECT 1 FROM team_members m JOIN users u ON u.id = m.user_id
               WHERE m.team_id = @team_id AND m.user_id = @user_id AND u.status = 'active');

-- name: SetAPIKeyContact :one
UPDATE api_keys SET user_id = @user_id WHERE id = @id AND kind = 'service' AND revoked_at IS NULL
RETURNING *;

-- One of a team's keys by ID, revoked or not, named like ListTeamAPIKeys.
-- name: GetTeamAPIKey :one
SELECT sqlc.embed(k), coalesce(u.email::text, '')::text AS user_email, coalesce(u.display_name, '')::text AS user_name
FROM api_keys k LEFT JOIN users u ON u.id = k.user_id
WHERE k.id = @id AND k.team_id = @team_id;
