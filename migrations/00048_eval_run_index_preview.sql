-- Index preview (#18): evaluation runs a held migration starts to compare the live index with its candidate. They are ordinary retrieval runs of
-- the knowledge base's evaluation sets with a new trigger, 'index_preview', and the config says which index each retrieved from; every team-facing
-- list, trend and regression check leaves them out (the comparison is the platform admin's).

-- +goose Up
ALTER TABLE eval_runs DROP CONSTRAINT eval_runs_trigger_check;
ALTER TABLE eval_runs ADD CONSTRAINT eval_runs_trigger_check
    CHECK (trigger IN ('manual', 'agent_published', 'profile_switched', 'nightly', 'index_preview'));

-- +goose Down
DELETE FROM eval_runs WHERE trigger = 'index_preview';
ALTER TABLE eval_runs DROP CONSTRAINT eval_runs_trigger_check;
ALTER TABLE eval_runs ADD CONSTRAINT eval_runs_trigger_check
    CHECK (trigger IN ('manual', 'agent_published', 'profile_switched', 'nightly'));
