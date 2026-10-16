-- In-app team requests (v0.6.0, E3): anyone signed in can ask for a team, platform admins review the request, and approving it creates the team.
-- It replaces the external TEAM_REQUEST_URL link only while a platform admin turns it on: the switch is off by default, and off means no form,
-- no new requests (the API too) and team creation with platform admins, as before. Requests already open stay in the queue until handled.

-- +goose Up
CREATE TABLE team_request_settings (
    singleton     boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled       boolean     NOT NULL DEFAULT false,
    -- Open (pending) requests one person may have at a time.
    max_open      integer     NOT NULL DEFAULT 2 CHECK (max_open BETWEEN 1 AND 20),
    -- An SSO group (lower-cased, as stored in sso_user_groups) the requester must be in; '' lets anyone signed in ask.
    allowed_group text        NOT NULL DEFAULT '' CHECK (char_length(allowed_group) <= 256),
    revision      bigint      NOT NULL DEFAULT 1,
    updated_by    uuid        REFERENCES users (id),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO team_request_settings DEFAULT VALUES;

CREATE TABLE team_requests (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id    uuid        NOT NULL REFERENCES users (id),
    -- What the person asked for. The reviewer may change the name, the address and the classification when approving.
    name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    purpose         text        NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 1000),
    -- Who should own the team: '' is the requester.
    owner_email     citext      NOT NULL DEFAULT '',
    -- The highest classification the team's data will need (the team's maximum).
    classification  text        NOT NULL REFERENCES classification_levels (key) ON UPDATE RESTRICT ON DELETE RESTRICT,
    status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
    decision_reason text        NOT NULL DEFAULT '' CHECK (char_length(decision_reason) <= 500),
    decided_by      uuid        REFERENCES users (id),
    decided_at      timestamptz,
    -- The team an approval created. SET NULL: deleting a team does not delete the record that it was asked for.
    team_id         uuid        REFERENCES teams (id) ON DELETE SET NULL,
    revision        bigint      NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT team_requests_decided CHECK ((status IN ('approved', 'declined')) = (decided_at IS NOT NULL))
);
CREATE INDEX team_requests_requester_idx ON team_requests (requester_id, created_at DESC);
CREATE INDEX team_requests_pending_idx ON team_requests (created_at) WHERE status = 'pending';

-- +goose Down
DROP TABLE team_requests;
DROP TABLE team_request_settings;
