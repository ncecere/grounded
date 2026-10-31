-- +goose Up
-- Expand only: ordinary audit writers and retention remain unchanged.
CREATE TABLE audit_exports (
    id uuid PRIMARY KEY,
    day date NOT NULL UNIQUE,
    coverage_start date NOT NULL,
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
    source_id bigint NOT NULL UNIQUE,
    occurred_at timestamptz NOT NULL,
    actor_kind text NOT NULL,
    actor_user_id uuid,
    team_id uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    PRIMARY KEY (export_id, source_id)
);

CREATE TABLE audit_export_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false,
 coverage_start date NOT NULL DEFAULT '2026-01-01',
 revision bigint NOT NULL DEFAULT 1
);
INSERT INTO audit_export_settings (singleton) VALUES (true);
CREATE TABLE audit_export_requests (
 id uuid PRIMARY KEY,
 day date UNIQUE NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','failed')),
 revision bigint NOT NULL DEFAULT 1,
 failure_code text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 lease uuid,
 lease_until timestamptz,
 export_id uuid REFERENCES audit_exports(id)
);

-- Journal every upload BEFORE network I/O. Expired non-published attempts can
-- be deleted; publication CAS refuses expired attempts. No exactly-once claim.
CREATE TABLE audit_export_uploads (
 object_key text PRIMARY KEY,
 deleting boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
