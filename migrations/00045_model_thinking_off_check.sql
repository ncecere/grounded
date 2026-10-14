-- What a chat model's Test found about "How to turn thinking off" (#7, #52): some models keep reasoning whatever
-- switch is sent. The result is a fact about the model's configuration, not about whether the service is up, so it
-- lives on the model and not in health_checks (which is healthy or failing, drives "failing since", the Overview
-- count and the grounded_health_failing metric, and must not turn a model that merely thinks too much into an outage).
--
-- NULL: never checked, or the setting it described has changed (UpdateModel clears it when the compatibility settings
-- or the upstream model change). A Test stores it without touching the model's revision: a check is not a change.

-- +goose Up
ALTER TABLE models
    ADD COLUMN thinking_off_result     text        CONSTRAINT models_thinking_off_result CHECK (thinking_off_result IN ('honoured', 'ignored')),
    ADD COLUMN thinking_off_checked_at timestamptz,
    ADD CONSTRAINT models_thinking_off_both CHECK ((thinking_off_result IS NULL) = (thinking_off_checked_at IS NULL));

-- +goose Down
ALTER TABLE models
    DROP CONSTRAINT models_thinking_off_both,
    DROP COLUMN thinking_off_checked_at,
    DROP COLUMN thinking_off_result;
