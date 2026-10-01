-- Cross-encoder reranking (docs/v0.4.0.md §3, roadmap A1b): the platform's
-- rerank model and its settings, and the priced units of rerank requests.
--
-- Expand only (ADR-0013): a new table nobody reads before this release,
-- and two more allowed values in model_prices_unit_check.

-- +goose Up
-- One row: the rerank model every search uses (Admin → Models) and its
-- settings ({candidates, timeLimitMs}; internal/rerank). No row, or no
-- model, means no reranking: retrieval is as before.
CREATE TABLE rerank_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    -- A model in use cannot be deleted.
    model_id   uuid        REFERENCES models (id) ON DELETE RESTRICT,
    settings   jsonb       NOT NULL DEFAULT '{}'::jsonb,
    revision   bigint      NOT NULL DEFAULT 2,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Rerank models are priced per million tokens and per request.
ALTER TABLE model_prices DROP CONSTRAINT IF EXISTS model_prices_unit_check;
ALTER TABLE model_prices ADD CONSTRAINT model_prices_unit_check
    CHECK (unit IN ('chat_tokens_in', 'chat_tokens_out', 'embed_tokens', 'systemone_tokens', 'systemone_requests',
                    'moderation_requests', 'vision_tokens_in', 'vision_tokens_out', 'mcp_calls',
                    'rerank_tokens', 'rerank_requests')) NOT VALID;
ALTER TABLE model_prices VALIDATE CONSTRAINT model_prices_unit_check;

-- +goose Down
DELETE FROM model_prices WHERE unit IN ('rerank_tokens', 'rerank_requests');
ALTER TABLE model_prices DROP CONSTRAINT IF EXISTS model_prices_unit_check;
ALTER TABLE model_prices ADD CONSTRAINT model_prices_unit_check
    CHECK (unit IN ('chat_tokens_in', 'chat_tokens_out', 'embed_tokens', 'systemone_tokens', 'systemone_requests',
                    'moderation_requests', 'vision_tokens_in', 'vision_tokens_out', 'mcp_calls'));

DROP TABLE rerank_settings;
