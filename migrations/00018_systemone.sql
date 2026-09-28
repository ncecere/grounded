-- Optional SystemOne models (ADR-0020, docs/systemone.md §1-§2): the model
-- kind, the per-connection concurrency cap, the platform SystemOne
-- settings, and the content-free judging record of each answer.

-- +goose Up
-- A SystemOne model is a catalog model of kind systemone.
ALTER TABLE models DROP CONSTRAINT IF EXISTS models_kind_check;
ALTER TABLE models ADD CONSTRAINT models_kind_check
    CHECK (kind IN ('chat', 'embedding', 'rerank', 'moderation', 'systemone'));

-- Moderation models with the System One provider become SystemOne models
-- (ADR-0020); moderation policies keep referencing them by ID. The
-- system_one provider value stays allowed until the next release
-- (expand/contract, ADR-0013).
UPDATE models
SET kind = 'systemone', moderation_provider = NULL, moderation_family = NULL,
    revision = revision + 1, updated_at = now()
WHERE kind = 'moderation' AND moderation_provider = 'system_one';

-- How many requests Grounded sends to a connection at once (per process). A
-- GPU serves SystemOne judgments largely one after another.
ALTER TABLE model_connections
    ADD COLUMN max_concurrent_requests integer NOT NULL DEFAULT 8
        CHECK (max_concurrent_requests BETWEEN 1 AND 256);

-- One row: the SystemOne model used by the features and each feature's
-- platform settings (internal/systemone). No row means everything off.
CREATE TABLE systemone_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    -- A model in use cannot be deleted.
    model_id   uuid        REFERENCES models (id) ON DELETE RESTRICT,
    settings   jsonb       NOT NULL DEFAULT '{}'::jsonb,
    revision   bigint      NOT NULL DEFAULT 2,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- {searches, candidates, evidence, conflicting, kept, dropped{reason},
-- skipped, requests, latencyMs, mode, noContextReason}; never content
-- (ADR-0010). NULL when nothing was judged.
ALTER TABLE message_events ADD COLUMN judging jsonb;

-- +goose Down
ALTER TABLE message_events DROP COLUMN judging;
DROP TABLE systemone_settings;
ALTER TABLE model_connections DROP COLUMN max_concurrent_requests;
UPDATE models SET kind = 'moderation', moderation_provider = 'system_one' WHERE kind = 'systemone';
ALTER TABLE models DROP CONSTRAINT models_kind_check;
ALTER TABLE models ADD CONSTRAINT models_kind_check
    CHECK (kind IN ('chat', 'embedding', 'rerank', 'moderation'));
