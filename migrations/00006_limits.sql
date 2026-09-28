-- Team limits (DESIGN.md §11.1): platform defaults and ceilings, per-team
-- overrides, and crawl-run state for limits (waiting and truncation reasons).
--
-- The limit keys themselves are defined in Go (internal/limits); these
-- tables only hold values, so adding a key needs no migration.

-- +goose Up
-- One row. settings maps a key to {"default": n|null, "ceiling": n|null}:
-- default null = unlimited, ceiling null = no ceiling. A key missing here
-- uses its built-in default from internal/limits.
CREATE TABLE platform_limits (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    settings   jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_limits DEFAULT VALUES;

-- Per-team overrides: key -> n (0 = blocked). A missing key inherits the
-- platform default. A team without a row has no overrides (revision 1).
CREATE TABLE team_limits (
    team_id    uuid        PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
    overrides  jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(overrides) = 'object'),
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Why a crawl stopped early (max_pages, documents_limit, storage_limit) and
-- why an active crawl is waiting (concurrent_crawls: queued until a slot
-- frees; daily_page_limit: paused until waiting_until, the next UTC day).
ALTER TABLE web_crawls ADD COLUMN truncated_reason text NOT NULL DEFAULT '';
ALTER TABLE web_crawls ADD COLUMN waiting_reason text NOT NULL DEFAULT ''
    CHECK (waiting_reason IN ('', 'concurrent_crawls', 'daily_page_limit'));
ALTER TABLE web_crawls ADD COLUMN waiting_until timestamptz;
CREATE INDEX web_crawls_team_active_idx ON web_crawls (team_id, created_at) WHERE status IN ('queued', 'running');

-- Team storage and document counts; daily usage sums from the ledger.
CREATE INDEX documents_team_idx ON documents (team_id) INCLUDE (size_bytes);
CREATE INDEX usage_events_team_kind_time_idx ON usage_events (team_id, kind, occurred_at) INCLUDE (quantity);

-- +goose Down
DROP INDEX usage_events_team_kind_time_idx;
DROP INDEX documents_team_idx;
DROP INDEX web_crawls_team_active_idx;
ALTER TABLE web_crawls DROP COLUMN waiting_until;
ALTER TABLE web_crawls DROP COLUMN waiting_reason;
ALTER TABLE web_crawls DROP COLUMN truncated_reason;
DROP TABLE team_limits;
DROP TABLE platform_limits;
