-- Maintenance mode (docs/phase5-deploy.md §5 P5, ADR-0013): a platform
-- switch that pauses new ingestion while chat and retrieval keep working.
--
-- Its own one-row table, not columns on platform_settings: code still running
-- the previous release reads platform_settings with SELECT *, which new
-- columns would break during a rolling upgrade (expand/contract), and the
-- switch keeps its own revision so editing it never conflicts with the
-- public-access switch.

-- +goose Up
CREATE TABLE maintenance_mode (
    singleton      boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled        boolean     NOT NULL DEFAULT false,
    -- Shown to users while on; empty while off.
    reason         text        NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
    -- When the admin expects to turn it off (informational: it never ends by itself).
    planned_end_at timestamptz,
    started_by     uuid        REFERENCES users (id),
    started_at     timestamptz,
    revision       bigint      NOT NULL DEFAULT 1,
    updated_by     uuid        REFERENCES users (id),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT enabled OR (reason <> '' AND started_at IS NOT NULL))
);
INSERT INTO maintenance_mode DEFAULT VALUES;

-- A crawl run parked by maintenance mode waits with this reason until it
-- ends. Widening the check is compatible with the previous release.
ALTER TABLE web_crawls DROP CONSTRAINT web_crawls_waiting_reason_check;
ALTER TABLE web_crawls ADD CONSTRAINT web_crawls_waiting_reason_check
    CHECK (waiting_reason IN ('', 'concurrent_crawls', 'daily_page_limit', 'maintenance')) NOT VALID;
ALTER TABLE web_crawls VALIDATE CONSTRAINT web_crawls_waiting_reason_check;

-- +goose Down
UPDATE web_crawls SET waiting_reason = '', waiting_until = NULL WHERE waiting_reason = 'maintenance';
ALTER TABLE web_crawls DROP CONSTRAINT web_crawls_waiting_reason_check;
ALTER TABLE web_crawls ADD CONSTRAINT web_crawls_waiting_reason_check
    CHECK (waiting_reason IN ('', 'concurrent_crawls', 'daily_page_limit'));
DROP TABLE maintenance_mode;
