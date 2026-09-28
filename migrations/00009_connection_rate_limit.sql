-- Per-connection request rate limit (requests per minute across all Grounded
-- processes, enforced in Valkey). NULL = unlimited. Many gateways limit each
-- key (e.g. 120 requests/min); ingest paces itself below this instead of
-- collecting 429s. Additive: older code ignores it.

-- +goose Up
ALTER TABLE model_connections
    ADD COLUMN requests_per_minute integer CHECK (requests_per_minute BETWEEN 1 AND 1000000);

-- +goose Down
ALTER TABLE model_connections DROP COLUMN requests_per_minute;
