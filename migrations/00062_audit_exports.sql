-- +goose Up
-- Expand only: ordinary audit writers and retention remain unchanged.
CREATE TABLE audit_exports (
    id uuid PRIMARY KEY,
    day date NOT NULL UNIQUE,
    snapshot_at timestamptz NOT NULL,
    watermark bigint NOT NULL,
    previous_hash text NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed')),
    object_key text,
    envelope bytea,
    envelope_hash text,
    CHECK ((state = 'pending' AND object_key IS NULL AND envelope IS NULL AND envelope_hash IS NULL)
        OR (state = 'completed' AND object_key IS NOT NULL AND envelope IS NOT NULL AND envelope_hash IS NOT NULL))
);
CREATE TABLE audit_export_facts (
    export_id uuid NOT NULL REFERENCES audit_exports(id),
    source_id bigint NOT NULL,
    occurred_at timestamptz NOT NULL,
    actor_kind text NOT NULL,
    actor_user_id uuid,
    team_id uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    PRIMARY KEY (export_id, source_id)
);
