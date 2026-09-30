-- OAuth sign-in for MCP clients (migrations/00038_mcp_oauth.sql, docs/mcp.md).

-- ---- registered clients (RFC 7591) ---------------------------------------------

-- name: InsertOAuthClient :one
INSERT INTO oauth_clients (client_id, client_name, redirect_uris, client_uri, logo_uri)
VALUES (@client_id, @client_name, @redirect_uris, sqlc.narg(client_uri), sqlc.narg(logo_uri))
RETURNING *;

-- name: GetOAuthClient :one
SELECT * FROM oauth_clients WHERE client_id = @client_id AND last_used_at > @unused_since;

-- name: TouchOAuthClient :exec
UPDATE oauth_clients SET last_used_at = now()
WHERE client_id = @client_id AND last_used_at < now() - interval '1 hour';

-- name: DeleteUnusedOAuthClients :exec
DELETE FROM oauth_clients WHERE last_used_at <= @unused_since;

-- ---- grants (a person's consent for a client) ----------------------------------

-- name: GetActiveOAuthGrant :one
SELECT * FROM oauth_grants WHERE user_id = @user_id AND client_id = @client_id AND revoked_at IS NULL;

-- name: InsertOAuthGrant :one
INSERT INTO oauth_grants (user_id, client_id, client_kind, client_name, client_uri, resource)
VALUES (@user_id, @client_id, @client_kind, @client_name, sqlc.narg(client_uri), @resource)
RETURNING *;

-- name: LockOAuthGrant :one
SELECT * FROM oauth_grants WHERE id = @id FOR UPDATE;

-- name: RevokeOAuthGrant :execrows
UPDATE oauth_grants SET revoked_at = now(), revoked_reason = @reason WHERE id = @id AND revoked_at IS NULL;

-- name: DeleteOAuthGrantTokens :exec
WITH codes AS (DELETE FROM oauth_codes c WHERE c.grant_id = @grant_id)
DELETE FROM oauth_tokens t WHERE t.grant_id = @grant_id;

-- name: ListUserOAuthGrants :many
SELECT * FROM oauth_grants WHERE user_id = @user_id AND revoked_at IS NULL ORDER BY created_at DESC, id;

-- name: TouchOAuthGrant :exec
UPDATE oauth_grants SET last_used_at = now()
WHERE id = @id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

-- ---- authorization codes --------------------------------------------------------

-- name: InsertOAuthCode :exec
INSERT INTO oauth_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, expires_at)
VALUES (@code_hash, @grant_id, @client_id, @redirect_uri, @code_challenge, @resource, @expires_at);

-- TakeOAuthCode consumes a code: a second exchange finds nothing.
-- name: TakeOAuthCode :one
DELETE FROM oauth_codes WHERE code_hash = @code_hash RETURNING *;

-- name: DeleteExpiredOAuthCodes :exec
DELETE FROM oauth_codes WHERE expires_at < now();

-- ---- access and refresh tokens --------------------------------------------------

-- name: InsertOAuthToken :one
INSERT INTO oauth_tokens (grant_id, kind, token_hash, pepper_id, resource, expires_at)
VALUES (@grant_id, @kind, @token_hash, @pepper_id, @resource, @expires_at)
RETURNING *;

-- GetOAuthToken is a token with its grant and the grant's person.
-- name: GetOAuthToken :one
SELECT sqlc.embed(t), sqlc.embed(g), sqlc.embed(u)
FROM oauth_tokens t
JOIN oauth_grants g ON g.id = t.grant_id
JOIN users u ON u.id = g.user_id
WHERE t.token_hash = @token_hash AND t.kind = @kind;

-- name: LockOAuthToken :one
SELECT * FROM oauth_tokens WHERE id = @id FOR UPDATE;

-- name: RotateOAuthToken :execrows
UPDATE oauth_tokens SET rotated_at = now() WHERE id = @id AND rotated_at IS NULL;

-- name: DeleteOAuthToken :exec
DELETE FROM oauth_tokens WHERE id = @id;

-- name: DeleteExpiredOAuthTokens :exec
DELETE FROM oauth_tokens WHERE expires_at < now();
