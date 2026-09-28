-- One-time first-run steps (ADR-0018). A row records that a step ran, so it
-- never runs again: for example, deleting every crawl allowlist pattern
-- must not bring back CRAWL_ALLOWLIST_SEED on the next start.

-- +goose Up
CREATE TABLE bootstrap_state (
    key        text        PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
    details    jsonb       NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE bootstrap_state;
