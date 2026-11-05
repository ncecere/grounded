-- SCIM provisioning (docs/specs/scim/DESIGN.md).

-- ---- tokens ----------------------------------------------------------------

-- name: InsertSCIMToken :one
INSERT INTO scim_tokens (name, digest, created_by) VALUES (@name, @digest, @created_by) RETURNING *;

-- name: CountActiveSCIMTokens :one
SELECT count(*)::bigint FROM scim_tokens WHERE revoked_at IS NULL;

-- name: ListSCIMTokens :many
SELECT t.id, t.name, t.created_at, t.last_used_at, coalesce(u.display_name, '')::text AS created_by_name
FROM scim_tokens t LEFT JOIN users u ON u.id = t.created_by
WHERE t.revoked_at IS NULL ORDER BY t.created_at;

-- name: RevokeSCIMToken :one
UPDATE scim_tokens SET revoked_at = now() WHERE id = @id AND revoked_at IS NULL RETURNING *;

-- name: GetSCIMTokenByDigest :one
SELECT * FROM scim_tokens WHERE digest = @digest AND revoked_at IS NULL;

-- name: TouchSCIMToken :exec
UPDATE scim_tokens SET last_used_at = now()
WHERE id = @id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

-- ---- users -----------------------------------------------------------------

-- name: InsertSCIMUser :one
-- A user SCIM creates before their first sign-in: the subject is a placeholder until a sign-in claims it.
INSERT INTO users (id, oidc_issuer, oidc_subject, email, display_name, scim_external_id, scim_user_name, status)
VALUES (@id, @oidc_issuer, @oidc_subject, @email, @display_name, @scim_external_id, @scim_user_name, @status)
RETURNING *;

-- name: GetSCIMUser :one
SELECT * FROM users WHERE id = @id AND scim_external_id IS NOT NULL;

-- name: GetSCIMUserForUpdate :one
SELECT * FROM users WHERE id = @id AND scim_external_id IS NOT NULL FOR UPDATE;

-- name: GetUserByExternalID :one
SELECT * FROM users WHERE scim_external_id = @external_id;

-- An unlinked user who signed in with this identifier: their subject (match claim sub), or the claim kept from their
-- latest sign-in. Never their email.
-- name: FindUnlinkedUserByIdentifier :many
SELECT * FROM users
WHERE rtrim(oidc_issuer, '/') = rtrim(@oidc_issuer::text, '/') AND scim_external_id IS NULL
  AND ((sqlc.arg(claim)::text = 'sub' AND oidc_subject = sqlc.arg(value)::text) OR (sqlc.arg(claim)::text <> 'sub' AND claims->>(sqlc.arg(claim)::text) = sqlc.arg(value)::text))
LIMIT 2;

-- name: LinkSCIMUser :one
UPDATE users SET scim_external_id = @scim_external_id, scim_user_name = @scim_user_name, updated_at = now(), revision = revision + 1
WHERE id = @id RETURNING *;

-- name: UpdateSCIMUser :one
UPDATE users SET email = @email, display_name = @display_name, scim_user_name = @scim_user_name, updated_at = now(), revision = revision + 1
WHERE id = @id RETURNING *;

-- name: SetSCIMUserStatus :one
UPDATE users SET status = @status, updated_at = now(), revision = revision + 1 WHERE id = @id RETURNING *;

-- name: UnlinkSCIMUser :one
UPDATE users SET scim_external_id = NULL, updated_at = now(), revision = revision + 1 WHERE id = @id RETURNING *;

-- SCIM's view of users, filtered by at most one attribute, a page at a time.
-- name: ListSCIMUsers :many
SELECT * FROM users
WHERE scim_external_id IS NOT NULL
  AND (sqlc.narg(user_name)::text IS NULL OR lower(scim_user_name) = lower(sqlc.narg(user_name)::text))
  AND (sqlc.narg(external_id)::text IS NULL OR scim_external_id = sqlc.narg(external_id)::text)
  AND (sqlc.narg(email)::text IS NULL OR email = sqlc.narg(email)::citext)
  AND (sqlc.narg(id)::uuid IS NULL OR id = sqlc.narg(id)::uuid)
ORDER BY created_at, id
OFFSET @skip LIMIT @take;

-- name: CountSCIMUsers :one
SELECT count(*)::bigint FROM users
WHERE scim_external_id IS NOT NULL
  AND (sqlc.narg(user_name)::text IS NULL OR lower(scim_user_name) = lower(sqlc.narg(user_name)::text))
  AND (sqlc.narg(external_id)::text IS NULL OR scim_external_id = sqlc.narg(external_id)::text)
  AND (sqlc.narg(email)::text IS NULL OR email = sqlc.narg(email)::citext)
  AND (sqlc.narg(id)::uuid IS NULL OR id = sqlc.narg(id)::uuid);

-- At sign-in: the pending SCIM user whose externalId is the identity provider's identifier takes the sign-in's subject,
-- unless a user already has it.
-- name: ClaimSCIMUser :execrows
UPDATE users AS p SET oidc_issuer = @issuer::text, oidc_subject = @subject::text, updated_at = now()
WHERE p.scim_external_id = @external_id::text AND p.oidc_subject = 'scim-pending:' || p.id::text
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.oidc_issuer = @issuer::text AND u.oidc_subject = @subject::text);

-- ---- groups ----------------------------------------------------------------

-- name: InsertSCIMGroup :one
INSERT INTO scim_groups (display_name, external_id) VALUES (@display_name, @external_id) RETURNING *;

-- name: GetSCIMGroup :one
SELECT * FROM scim_groups WHERE id = @id;

-- name: GetSCIMGroupForUpdate :one
SELECT * FROM scim_groups WHERE id = @id FOR UPDATE;

-- name: UpdateSCIMGroup :one
UPDATE scim_groups SET display_name = @display_name, external_id = @external_id, revision = revision + 1, updated_at = now()
WHERE id = @id RETURNING *;

-- name: TouchSCIMGroup :exec
UPDATE scim_groups SET revision = revision + 1, updated_at = now() WHERE id = @id;

-- name: DeleteSCIMGroup :exec
DELETE FROM scim_groups WHERE id = @id;

-- name: ListSCIMGroups :many
SELECT * FROM scim_groups
WHERE (sqlc.narg(display_name)::text IS NULL OR lower(display_name) = lower(sqlc.narg(display_name)::text))
  AND (sqlc.narg(external_id)::text IS NULL OR external_id = sqlc.narg(external_id)::text)
  AND (sqlc.narg(id)::uuid IS NULL OR id = sqlc.narg(id)::uuid)
ORDER BY created_at, id
OFFSET @skip LIMIT @take;

-- name: CountSCIMGroups :one
SELECT count(*)::bigint FROM scim_groups
WHERE (sqlc.narg(display_name)::text IS NULL OR lower(display_name) = lower(sqlc.narg(display_name)::text))
  AND (sqlc.narg(external_id)::text IS NULL OR external_id = sqlc.narg(external_id)::text)
  AND (sqlc.narg(id)::uuid IS NULL OR id = sqlc.narg(id)::uuid);

-- name: AnySCIMGroups :one
SELECT EXISTS (SELECT 1 FROM scim_groups)::boolean;

-- name: ListSCIMGroupMembers :many
SELECT u.id, u.display_name FROM scim_group_members m JOIN users u ON u.id = m.user_id
WHERE m.group_id = @group_id ORDER BY u.display_name, u.id;

-- name: ListSCIMGroupMemberIDs :many
SELECT user_id FROM scim_group_members WHERE group_id = @group_id;

-- name: AddSCIMGroupMembers :execrows
INSERT INTO scim_group_members (group_id, user_id)
SELECT @group_id, u.id FROM users u WHERE u.id = ANY(@user_ids::uuid[]) AND u.scim_external_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- name: RemoveSCIMGroupMembers :execrows
DELETE FROM scim_group_members WHERE group_id = @group_id AND user_id = ANY(@user_ids::uuid[]);

-- name: RemoveUserFromSCIMGroups :many
DELETE FROM scim_group_members WHERE user_id = @user_id RETURNING group_id;

-- name: CountLinkedUsers :many
SELECT id FROM users WHERE id = ANY(@user_ids::uuid[]) AND scim_external_id IS NOT NULL;

-- A user's groups for the SSO rules: each SCIM group's name and external ID.
-- name: SCIMGroupsOfUser :many
SELECT g.display_name, coalesce(g.external_id, '')::text AS external_id
FROM scim_group_members m JOIN scim_groups g ON g.id = m.group_id WHERE m.user_id = @user_id;

-- name: SCIMSummary :one
SELECT (SELECT count(*) FROM users WHERE scim_external_id IS NOT NULL)::bigint AS users,
       (SELECT count(*) FROM users WHERE scim_external_id IS NOT NULL AND oidc_subject LIKE 'scim-pending:%')::bigint AS pending,
       (SELECT count(*) FROM scim_groups)::bigint AS groups;

-- name: GetUserByIdentity :one
SELECT * FROM users WHERE oidc_issuer = @oidc_issuer AND oidc_subject = @oidc_subject;
