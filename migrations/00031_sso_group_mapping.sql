-- SSO group mapping (docs/v0.2.0.md §3.2 E1, docs/operations/sso-groups.md):
-- rules that map an identity-provider group to a team role, applied at
-- sign-in from the OIDC groups claim.
--
-- Which memberships a rule created is recorded in its own table rather than
-- in new team_members columns: the previous release reads team_members with
-- SELECT * / RETURNING *, which new columns would break during a rolling
-- upgrade (expand/contract, ADR-0013). A membership without a row here was
-- added by hand (source "manual") and is never changed by a rule; one with a
-- row was created by the mapping (source "sso:<rule id>"). Removing the
-- membership (by the previous release, or a team delete) removes the marker.

-- +goose Up
CREATE TABLE sso_group_rules (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The group name as the identity provider sends it. Matching ignores case.
    group_name text        NOT NULL CHECK (char_length(group_name) BETWEEN 1 AND 256 AND group_name = btrim(group_name)),
    -- A rule's team never changes: map a group to another team with a new rule.
    team_id    uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    role       text        NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'member')),
    created_by uuid        REFERENCES users (id),
    revision   bigint      NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- One rule per group and team.
CREATE UNIQUE INDEX sso_group_rules_team_group_key ON sso_group_rules (team_id, lower(group_name));
CREATE INDEX sso_group_rules_group_idx ON sso_group_rules (lower(group_name));

-- Memberships the mapping created. rule_id is the rule that grants the
-- membership's current role; NULL when that rule was deleted and the
-- membership was kept because its person is the team's last owner (the
-- next sign-in removes it once the team has another owner).
CREATE TABLE sso_memberships (
    team_id    uuid        NOT NULL,
    user_id    uuid        NOT NULL,
    rule_id    uuid        REFERENCES sso_group_rules (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id, user_id) REFERENCES team_members (team_id, user_id) ON DELETE CASCADE
);
CREATE INDEX sso_memberships_rule_idx ON sso_memberships (rule_id);
CREATE INDEX sso_memberships_user_idx ON sso_memberships (user_id);

-- Each person's groups as last seen at sign-in (lower-cased), for the dry
-- run of a rule and for applying a saved rule to people who have signed in.
-- claim_present is false when the sign-in carried no groups claim at all
-- (grounded doctor warns when rules exist but no sign-in carries it).
CREATE TABLE sso_user_groups (
    user_id       uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    groups        text[]      NOT NULL DEFAULT '{}',
    claim_present boolean     NOT NULL,
    seen_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sso_user_groups_groups_idx ON sso_user_groups USING gin (groups);

-- +goose Down
DROP TABLE sso_user_groups;
DROP TABLE sso_memberships;
DROP TABLE sso_group_rules;
