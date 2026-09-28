-- Fixes from the 2026-09 UI review and functional QA (docs/ui-review).
--
-- F-01: a moderation model may set its own check timeout; NULL uses the
-- platform default (MODERATION_TIMEOUT, longer for chat classifiers).
-- F-25: API keys can be restricted to agents (DESIGN.md §3.3), beside the
-- existing KB restriction; a service key's user_id is its responsible
-- contact, chosen from the team's members.

-- +goose Up
ALTER TABLE models
    ADD COLUMN moderation_timeout_seconds integer
        CHECK (moderation_timeout_seconds BETWEEN 1 AND 120);

-- NULL = every agent of the team.
ALTER TABLE api_keys ADD COLUMN agent_ids uuid[];

-- +goose Down
ALTER TABLE api_keys DROP COLUMN agent_ids;
ALTER TABLE models DROP COLUMN moderation_timeout_seconds;
