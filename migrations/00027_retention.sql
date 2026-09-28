-- Retention jobs and legal holds (docs/phase5-deploy.md §5 P3, DESIGN.md §8,
-- ADR-0010, docs/operations/retention.md).
--
--   * legal_holds: a hold on a user, team, agent or conversation, optionally
--     limited to a date range. While active it stops every retention deletion
--     of what it covers. Holds never expire; releasing one is recorded here and
--     audited.
--   * legal_hold_covers(): the one test every retention job applies. Scope ids
--     are UUIDs, so a row is covered when any of its related ids (its user,
--     team, agent or conversation) is the scope of an active hold whose date
--     range overlaps the row's own time span.
--   * retention_settings: the platform's retention period per data kind. A
--     kind missing from periods uses the environment default; a JSON null
--     keeps the data (DESIGN.md §8: nothing is hard-coded to delete).
--     Conversation periods stay on classification_levels (00016, 00023).
--   * retention_runs: each run of the retention job, with counts only.
--   * usage_daily: usage events rolled up per day before they are deleted, so
--     analytics totals survive the ledger's retention.
--   * deleted_files: stored files of deleted documents and sources, removed by
--     retention after the deleted-files grace period (unless a hold covers
--     their team).
--
-- New tables only, plus indexes: compatible with the previous release
-- (expand/contract, ADR-0013).

-- +goose Up
CREATE TABLE legal_holds (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type     text        NOT NULL CHECK (scope_type IN ('user', 'team', 'agent', 'conversation')),
    scope_id       uuid        NOT NULL,
    -- The covered object's name when the hold was placed (it may be deleted later).
    scope_label    text        NOT NULL DEFAULT '' CHECK (length(scope_label) <= 300),
    reason         text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
    -- Optional date range of the data covered: [covers_from, covers_to).
    covers_from    timestamptz,
    covers_to      timestamptz,
    created_by     uuid        NOT NULL REFERENCES users (id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    released_at    timestamptz,
    released_by    uuid        REFERENCES users (id),
    release_reason text        NOT NULL DEFAULT '' CHECK (length(release_reason) <= 2000),
    CHECK (covers_from IS NULL OR covers_to IS NULL OR covers_from < covers_to),
    CHECK ((released_at IS NULL) = (released_by IS NULL))
);
CREATE INDEX legal_holds_active_idx ON legal_holds (scope_id) WHERE released_at IS NULL;
CREATE INDEX legal_holds_created_idx ON legal_holds (created_at DESC, id DESC);

-- +goose StatementBegin
CREATE FUNCTION legal_hold_covers(ids uuid[], data_from timestamptz, data_to timestamptz) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT EXISTS (
        SELECT 1 FROM legal_holds h
        WHERE h.released_at IS NULL
          AND h.scope_id = ANY (ids)
          AND (h.covers_from IS NULL OR data_to IS NULL OR data_to >= h.covers_from)
          AND (h.covers_to IS NULL OR data_from IS NULL OR data_from < h.covers_to))
$$;
-- +goose StatementEnd

CREATE TABLE retention_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    periods    jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(periods) = 'object'),
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO retention_settings DEFAULT VALUES;

CREATE TABLE retention_runs (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trigger      text        NOT NULL CHECK (trigger IN ('schedule', 'manual')),
    requested_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    -- The data kinds to run; empty: all.
    kinds        text[]      NOT NULL DEFAULT '{}',
    status       text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ok', 'error')),
    -- Per kind: {"deleted": n, "held": n, "error": "..."}. Counts only.
    results      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    error        text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz
);
CREATE INDEX retention_runs_created_idx ON retention_runs (created_at DESC, id DESC);

CREATE TABLE usage_daily (
    day      date   NOT NULL,
    kind     text   NOT NULL,
    team_id  uuid,
    agent_id uuid,
    model_id uuid,
    channel  text   NOT NULL DEFAULT '',
    quantity bigint NOT NULL,
    events   bigint NOT NULL,
    CONSTRAINT usage_daily_key UNIQUE NULLS NOT DISTINCT (day, kind, team_id, agent_id, model_id, channel)
);
CREATE INDEX usage_daily_team_day_idx ON usage_daily (team_id, day);

CREATE TABLE deleted_files (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id      uuid,
    source_id    uuid        NOT NULL,
    document_id  uuid,
    prefix       text        NOT NULL CHECK (prefix <> ''),
    -- When the deleted content was created (for date-limited holds).
    content_from timestamptz,
    deleted_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deleted_files_deleted_idx ON deleted_files (deleted_at);

-- Retention scans.
CREATE INDEX conversations_deleted_idx ON conversations (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX team_invites_expires_idx ON team_invites (expires_at) WHERE accepted_at IS NULL;

-- +goose Down
DROP INDEX team_invites_expires_idx;
DROP INDEX conversations_deleted_idx;
DROP TABLE deleted_files;
DROP TABLE usage_daily;
DROP TABLE retention_runs;
DROP TABLE retention_settings;
DROP FUNCTION legal_hold_covers(uuid[], timestamptz, timestamptz);
DROP TABLE legal_holds;
