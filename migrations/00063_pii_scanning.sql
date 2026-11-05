-- +goose Up
-- PII scanning at ingest (B7, docs/v0.9.0.md, docs/pii-scanning.md). Expand only: a singleton settings row, on by
-- default (scanning flags; it never changes indexing until a platform admin chooses classification levels to hold).
-- Findings live in documents.metadata.pii (type, count and pages only), like metadata.ocr. Older binaries ignore both.
CREATE TABLE pii_settings (
    singleton    boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled      boolean     NOT NULL DEFAULT true,
    block_levels text[]      NOT NULL DEFAULT '{}',
    patterns     jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(patterns) = 'array'),
    revision     bigint      NOT NULL DEFAULT 1,
    updated_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pii_settings DEFAULT VALUES;
-- Documents waiting for review, counted per team (Needs attention) without reading their findings.
CREATE INDEX documents_pii_review_idx ON documents (team_id) WHERE metadata->'pii'->>'state' IN ('flagged', 'held');

-- +goose Down
DROP INDEX documents_pii_review_idx;
DROP TABLE pii_settings;
