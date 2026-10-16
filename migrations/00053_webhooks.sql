-- Webhooks (v0.6.0, F3; docs/specs/v0.6.0/DESIGN.md §5): signed, retried events for other systems.
--
-- A platform admin turns the feature on (off by default) and approves destination hosts; team admins and owners make webhooks for their team's
-- events, platform admins for the platform's. An event is recorded in the transaction that made the change, with one delivery per matching
-- webhook (an outbox); a River job sends each delivery and retries it. The webhook's secret is kept encrypted (internal/secrets) because Grounded
-- must sign with it, and is shown once.

-- +goose Up
CREATE TABLE webhook_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled    boolean     NOT NULL DEFAULT false,
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO webhook_settings DEFAULT VALUES;

-- The hosts a webhook's address may name: "hooks.example.edu" or "*.example.edu" (lower-case IDNA ASCII, as the crawl allowlist stores them).
CREATE TABLE webhook_destinations (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern    text        NOT NULL UNIQUE CHECK (char_length(pattern) BETWEEN 1 AND 253),
    note       text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
    created_by uuid        REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL: a platform webhook (platform events).
    team_id              uuid        REFERENCES teams (id) ON DELETE CASCADE,
    url                  text        NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
    description          text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 200),
    -- The event types it receives (at least one).
    events               text[]      NOT NULL CHECK (cardinality(events) >= 1),
    -- The signing secret, sealed with internal/secrets (associated data: the webhook's ID). It is also registered for key rotation.
    secret_cipher        bytea       NOT NULL,
    -- The last four characters of the secret, so the list can tell secrets apart without showing one.
    secret_hint          text        NOT NULL CHECK (char_length(secret_hint) = 4),
    enabled              boolean     NOT NULL DEFAULT true,
    -- Why it is not sending although it was turned on: '' (nothing), 'failing' (deliveries gave up several times in a row) or 'gone' (the receiver answered 410).
    paused_reason        text        NOT NULL DEFAULT '' CHECK (paused_reason IN ('', 'failing', 'gone')),
    -- Deliveries that gave up since the last success.
    consecutive_failures integer     NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    created_by           uuid        REFERENCES users (id),
    revision             bigint      NOT NULL DEFAULT 1,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_team_idx ON webhooks (team_id) WHERE team_id IS NOT NULL;

CREATE TABLE webhook_deliveries (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id      uuid        NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
    -- The event's ID: the same for every delivery of one event, and for a redelivery.
    event_id        uuid        NOT NULL,
    event_type      text        NOT NULL,
    -- The body that is signed and sent: IDs and summaries, never transcripts or document text.
    payload         jsonb       NOT NULL,
    status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    attempts        integer     NOT NULL DEFAULT 0,
    -- The receiver's last HTTP status (NULL: no answer) and a short error; never the receiver's body.
    last_status     integer,
    last_error      text        NOT NULL DEFAULT '' CHECK (char_length(last_error) <= 500),
    last_attempt_at timestamptz,
    delivered_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_webhook_idx ON webhook_deliveries (webhook_id, created_at DESC);
CREATE INDEX webhook_deliveries_created_idx ON webhook_deliveries (created_at);

-- +goose Down
DROP TABLE webhook_deliveries;
DROP TABLE webhooks;
DROP TABLE webhook_destinations;
DROP TABLE webhook_settings;
