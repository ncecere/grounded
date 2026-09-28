-- Moderation (docs/phase4-publishing.md §4, ADR-0019): the provider of
-- moderation models, one platform policy per audience, and the content-free
-- moderation decisions of each answer.

-- +goose Up
-- How a model of kind moderation is called. NULL for other kinds (and read
-- as moderations_endpoint for moderation models added before this column).
ALTER TABLE models
    ADD COLUMN moderation_provider text
        CHECK (moderation_provider IN ('moderations_endpoint', 'guardrail_chat', 'chat_classifier', 'system_one')),
    ADD COLUMN moderation_family text
        CHECK (moderation_family IN ('llama_guard', 'granite_guardian', 'shieldgemma'));

-- One policy per audience. No row means the built-in defaults
-- (internal/moderation), which count as revision 1.
CREATE TABLE moderation_policies (
    audience   text        PRIMARY KEY CHECK (audience IN ('team', 'all_authenticated', 'public')),
    -- The provider; a model in use by a policy cannot be deleted.
    model_id   uuid        REFERENCES models (id) ON DELETE RESTRICT,
    -- Categories, thresholds and actions, output mode, fail-closed, notice.
    policy     jsonb       NOT NULL,
    revision   bigint      NOT NULL DEFAULT 2,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- {decision, topCategory, score, categories, provider, calibrated, latencyMs};
-- never content (ADR-0010). NULL when the stage was not moderated.
ALTER TABLE message_events
    ADD COLUMN moderation_input  jsonb,
    ADD COLUMN moderation_output jsonb;

-- +goose Down
ALTER TABLE message_events DROP COLUMN moderation_output, DROP COLUMN moderation_input;
DROP TABLE moderation_policies;
ALTER TABLE models DROP COLUMN moderation_family, DROP COLUMN moderation_provider;
