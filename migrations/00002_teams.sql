-- Classification levels, teams, memberships and email invites (ADR-0002, ADR-0006).

-- +goose Up
-- Optimistic-concurrency revision for admin edits (If-Match).
ALTER TABLE users ADD COLUMN revision bigint NOT NULL DEFAULT 1;

CREATE TABLE classification_levels (
    key          text        PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
    name         text        NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
    description  text        NOT NULL DEFAULT '',
    -- Higher rank = more sensitive. Rank is fixed once created.
    rank         integer     NOT NULL UNIQUE CHECK (rank BETWEEN 0 AND 1000),
    -- Most permissive agent audience allowed for data at this level.
    max_audience text        NOT NULL CHECK (max_audience IN ('team', 'all_authenticated', 'public')),
    revision     bigint      NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO classification_levels (key, name, description, rank, max_audience) VALUES
    ('open', 'Open', 'Public information. Any enabled model; agents may be public.', 0, 'public'),
    ('sensitive', 'Sensitive', 'Internal information. Agents may be shared with any signed-in user.', 1, 'all_authenticated'),
    ('restricted', 'Restricted', 'Highly sensitive institutional data. Only models approved for Restricted data; team-only agents.', 2, 'team');

CREATE TABLE teams (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Used in URLs (/a/{team}/{agent}); immutable in v1.
    slug               text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
    name               text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    description        text        NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    -- Highest classification this team is approved for.
    max_classification text        NOT NULL REFERENCES classification_levels (key) ON UPDATE RESTRICT ON DELETE RESTRICT,
    status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by         uuid        REFERENCES users (id),
    revision           bigint      NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    archived_at        timestamptz
);

CREATE TABLE team_members (
    team_id    uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       text        NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'member')),
    added_by   uuid        REFERENCES users (id),
    revision   bigint      NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id);

CREATE TABLE team_invites (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id          uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    email            citext      NOT NULL,
    role             text        NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'member')),
    invited_by       uuid        REFERENCES users (id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    accepted_at      timestamptz,
    accepted_user_id uuid        REFERENCES users (id),
    revoked_at       timestamptz
);
-- At most one open invite per team and email.
CREATE UNIQUE INDEX team_invites_open_key ON team_invites (team_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX team_invites_open_email_idx ON team_invites (email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- +goose Down
DROP TABLE team_invites;
DROP TABLE team_members;
DROP TABLE teams;
DROP TABLE classification_levels;
ALTER TABLE users DROP COLUMN revision;
