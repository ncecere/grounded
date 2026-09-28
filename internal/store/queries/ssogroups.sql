-- SSO group mapping (migrations/00032_sso_group_mapping.sql).

-- name: InsertSSORule :one
INSERT INTO sso_group_rules (group_name, team_id, role, created_by)
VALUES (@group_name, @team_id, @role, @created_by)
RETURNING *;

-- name: GetSSORuleForUpdate :one
SELECT * FROM sso_group_rules WHERE id = @id FOR UPDATE;

-- name: UpdateSSORule :one
UPDATE sso_group_rules
SET group_name = @group_name, role = @role, revision = revision + 1, updated_at = now()
WHERE id = @id
RETURNING *;

-- name: DeleteSSORule :exec
DELETE FROM sso_group_rules WHERE id = @id;

-- The rules with their team and the number of memberships each grants.
-- name: ListSSORuleViews :many
SELECT sqlc.embed(r), t.slug AS team_slug, t.name AS team_name, t.status AS team_status,
       (SELECT count(*) FROM sso_memberships s WHERE s.rule_id = r.id)::bigint AS member_count
FROM sso_group_rules r
JOIN teams t ON t.id = r.team_id
WHERE (sqlc.narg(team_id)::uuid IS NULL OR r.team_id = sqlc.narg(team_id)::uuid)
ORDER BY lower(r.group_name), t.slug, r.id;

-- name: GetSSORuleView :one
SELECT sqlc.embed(r), t.slug AS team_slug, t.name AS team_name, t.status AS team_status,
       (SELECT count(*) FROM sso_memberships s WHERE s.rule_id = r.id)::bigint AS member_count
FROM sso_group_rules r
JOIN teams t ON t.id = r.team_id
WHERE r.id = @id;

-- name: CountSSORules :one
SELECT count(*) FROM sso_group_rules;

-- Rules matching any of the (lower-cased) groups, with their team's status.
-- name: ListSSORulesForGroups :many
SELECT sqlc.embed(r), t.status AS team_status
FROM sso_group_rules r
JOIN teams t ON t.id = r.team_id
WHERE lower(r.group_name) = ANY(@groups::text[])
ORDER BY r.created_at, r.id;

-- name: ListSSORulesForTeam :many
SELECT * FROM sso_group_rules WHERE team_id = @team_id ORDER BY created_at, id;

-- Every membership of a person, with its team's status and whether the
-- mapping created it.
-- name: ListMembershipsForSSO :many
SELECT m.team_id, m.role, t.status AS team_status,
       (s.user_id IS NOT NULL)::boolean AS sso, s.rule_id
FROM team_members m
JOIN teams t ON t.id = m.team_id
LEFT JOIN sso_memberships s ON s.team_id = m.team_id AND s.user_id = m.user_id
WHERE m.user_id = @user_id;

-- name: GetSSOMembership :one
SELECT s.rule_id, r.group_name
FROM sso_memberships s
LEFT JOIN sso_group_rules r ON r.id = s.rule_id
WHERE s.team_id = @team_id AND s.user_id = @user_id;

-- name: UpsertSSOMembership :exec
INSERT INTO sso_memberships (team_id, user_id, rule_id)
VALUES (@team_id, @user_id, @rule_id)
ON CONFLICT (team_id, user_id) DO UPDATE SET rule_id = EXCLUDED.rule_id, updated_at = now();

-- A hand change takes a membership over from the mapping.
-- name: DeleteSSOMembership :exec
DELETE FROM sso_memberships WHERE team_id = @team_id AND user_id = @user_id;

-- People the mapping gave a membership through this rule.
-- name: ListSSORuleUserIDs :many
SELECT user_id FROM sso_memberships WHERE rule_id = @rule_id;

-- name: UpsertUserGroups :exec
INSERT INTO sso_user_groups (user_id, groups, claim_present, seen_at)
VALUES (@user_id, @groups, @claim_present, now())
ON CONFLICT (user_id) DO UPDATE
SET groups = EXCLUDED.groups, claim_present = EXCLUDED.claim_present, seen_at = EXCLUDED.seen_at;

-- People whose last-seen groups include any of these (lower-cased), or who
-- are listed by ID, with their last-seen groups (empty when never seen).
-- name: ListSSOCandidates :many
SELECT sqlc.embed(u), coalesce(g.groups, '{}')::text[] AS groups, g.seen_at AS groups_seen_at
FROM users u
LEFT JOIN sso_user_groups g ON g.user_id = u.id
WHERE g.groups && @groups::text[] OR u.id = ANY(@user_ids::uuid[])
ORDER BY u.email, u.id;

-- The groups seen at sign-in, most people first.
-- name: ListSeenGroups :many
SELECT grp::text AS name, count(*)::bigint AS people
FROM sso_user_groups, unnest(groups) AS grp
GROUP BY grp
ORDER BY people DESC, grp
LIMIT @max_groups;

-- name: SSOGroupStats :one
SELECT (SELECT count(*) FROM sso_group_rules)::bigint AS rule_count,
       count(*)::bigint AS people_seen,
       count(*) FILTER (WHERE claim_present)::bigint AS people_with_claim,
       count(*) FILTER (WHERE seen_at > now() - interval '30 days')::bigint AS recent_sign_ins,
       count(*) FILTER (WHERE claim_present AND seen_at > now() - interval '30 days')::bigint AS recent_with_claim
FROM sso_user_groups;

-- name: LastGroupsClaimAt :one
SELECT seen_at FROM sso_user_groups WHERE claim_present ORDER BY seen_at DESC LIMIT 1;
