-- API key pepper rotation (docs/phase5-deploy.md E10,
-- docs/operations/rotate-keys.md). Each stored key digest records the id of
-- the pepper that made it (internal/secrets.PepperID: 8 bytes derived from
-- the pepper, not the pepper itself). A key still on API_KEY_PEPPER_PREVIOUS
-- is re-hashed with the current pepper, and its id updated, when next used.
-- NULL marks a digest from before this column: it was made with the pepper
-- configured at the time. Nullable, so the previous release keeps working
-- (expand/contract, ADR-0013).

-- +goose Up
ALTER TABLE api_keys ADD COLUMN pepper_id bytea CHECK (length(pepper_id) = 8);
ALTER TABLE publishable_keys ADD COLUMN pepper_id bytea CHECK (length(pepper_id) = 8);

-- +goose Down
ALTER TABLE publishable_keys DROP COLUMN pepper_id;
ALTER TABLE api_keys DROP COLUMN pepper_id;
