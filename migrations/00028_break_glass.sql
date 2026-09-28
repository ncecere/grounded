-- Break-glass (docs/phase5-deploy.md §5 P4, ADR-0011, ADR-0024): a platform
-- admin's time-boxed, audited read access to one team's conversations and
-- documents, with an optional second-admin approval.
--
-- The setting is its own one-row table (as maintenance_mode, 00025): code
-- still running the previous release reads platform_settings with SELECT *,
-- which new columns would break during a rolling upgrade (expand/contract,
-- ADR-0013). The defaults follow the owner decision (phase5-deploy.md §9
-- item 3): one admin with a written reason, no second approval.

-- +goose Up
CREATE TABLE break_glass_settings (
    singleton                boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    -- A second platform admin must approve a session before it starts.
    approval_required        boolean     NOT NULL DEFAULT false,
    -- The longest session an admin may ask for.
    max_duration_minutes     integer     NOT NULL DEFAULT 480 CHECK (max_duration_minutes BETWEEN 15 AND 1440),
    -- A request nobody approves within this time lapses.
    approval_timeout_minutes integer     NOT NULL DEFAULT 60 CHECK (approval_timeout_minutes BETWEEN 5 AND 10080),
    revision                 bigint      NOT NULL DEFAULT 1,
    updated_by               uuid        REFERENCES users (id),
    updated_at               timestamptz NOT NULL DEFAULT now()
);
INSERT INTO break_glass_settings DEFAULT VALUES;

CREATE TABLE break_glass_sessions (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id           uuid        NOT NULL REFERENCES teams (id),
    -- The platform admin who reads under the session.
    requested_by      uuid        NOT NULL REFERENCES users (id),
    reason            text        NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 1000),
    -- What may be read: conversations (transcripts), documents (sources,
    -- documents and passages), or both.
    scopes            text[]      NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 2
                                                  AND scopes <@ ARRAY['conversations', 'documents']::text[]),
    duration_minutes  integer     NOT NULL CHECK (duration_minutes BETWEEN 5 AND 1440),
    status            text        NOT NULL CHECK (status IN (
                                      'pending', 'active', 'ended', 'expired', 'denied', 'cancelled', 'request_expired')),
    requested_at      timestamptz NOT NULL DEFAULT now(),
    -- Pending requests lapse at this time.
    approval_deadline timestamptz,
    -- The second admin who approved or denied (NULL without approval).
    decided_by        uuid        REFERENCES users (id),
    decided_at        timestamptz,
    decision_note     text        NOT NULL DEFAULT '' CHECK (char_length(decision_note) <= 1000),
    started_at        timestamptz,
    expires_at        timestamptz,
    ended_at          timestamptz,
    -- Who ended it early (NULL when it expired or never started).
    ended_by          uuid        REFERENCES users (id),
    CHECK (status <> 'pending' OR approval_deadline IS NOT NULL),
    CHECK (status NOT IN ('active', 'ended', 'expired') OR (started_at IS NOT NULL AND expires_at IS NOT NULL)),
    CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
-- One open (pending or active) session per admin and team.
CREATE UNIQUE INDEX break_glass_sessions_open_key ON break_glass_sessions (requested_by, team_id)
    WHERE status IN ('pending', 'active');
CREATE INDEX break_glass_sessions_open_idx ON break_glass_sessions (status, expires_at, approval_deadline)
    WHERE status IN ('pending', 'active');
CREATE INDEX break_glass_sessions_requested_idx ON break_glass_sessions (requested_at DESC, id DESC);
CREATE INDEX break_glass_sessions_team_idx ON break_glass_sessions (team_id, requested_at DESC);

-- Every read under a session is an audit_log entry (action breakglass.read,
-- metadata sessionId and kind; never content). The session's read log and
-- the owners' summary read them through this index.
CREATE INDEX audit_log_break_glass_reads_idx ON audit_log ((metadata->>'sessionId'), id DESC)
    WHERE action = 'breakglass.read';

-- +goose Down
DROP INDEX audit_log_break_glass_reads_idx;
DROP TABLE break_glass_sessions;
DROP TABLE break_glass_settings;
