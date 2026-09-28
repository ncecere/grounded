-- Publishing (docs/phase4-publishing.md §3, §5-§7; ADR-0009, ADR-0010,
-- ADR-0012): the platform's public switch, anonymous retention per level,
-- short names, publishable keys, anonymous sessions and their
-- conversations, the public and widget analytics channels, and an index for
-- per-agent daily caps.

-- +goose Up
-- One row. public_agents_enabled is off on a new install (§7).
CREATE TABLE platform_settings (
    singleton             boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    public_agents_enabled boolean     NOT NULL DEFAULT false,
    revision              bigint      NOT NULL DEFAULT 1,
    updated_by            uuid        REFERENCES users (id),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings DEFAULT VALUES;

-- How long anonymous conversations of agents at this level are kept
-- (ADR-0006, ADR-0010; default 24 hours).
ALTER TABLE classification_levels
    ADD COLUMN anonymous_retention_hours integer NOT NULL DEFAULT 24
        CHECK (anonymous_retention_hours BETWEEN 1 AND 876000);

-- Admin-assigned short names: /a/{short} (ADR-0009). The reserved list is
-- enforced in internal/agents.
CREATE TABLE agent_short_names (
    short_name text        PRIMARY KEY CHECK (short_name ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
    agent_id   uuid        NOT NULL UNIQUE REFERENCES agents (id) ON DELETE CASCADE,
    created_by uuid        REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-agent publishable keys for the widget (ADR-0012): pk_<prefix>_<secret>.
-- Only HMAC-SHA256(API_KEY_PEPPER, secret) is stored.
CREATE TABLE publishable_keys (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        uuid        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    team_id         uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    prefix          text        NOT NULL UNIQUE,
    secret_hash     bytea       NOT NULL,
    -- Normalised origins: https://host[:port] or https://*.example.edu.
    allowed_origins text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_origins) <= 20),
    -- Per-key overrides of public_queries_per_{ip,session}_per_minute.
    rate_limits     jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rate_limits) = 'object'),
    enabled         boolean     NOT NULL DEFAULT true,
    revision        bigint      NOT NULL DEFAULT 1,
    last_used_at    timestamptz,
    revoked_at      timestamptz,
    created_by      uuid        REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publishable_keys_agent_idx ON publishable_keys (agent_id, created_at);

-- Anonymous visitors of public agents (§5). The cookie secret is stored as
-- a SHA-256 digest; the address only as its /24 (IPv4) or /48 (IPv6) prefix.
CREATE TABLE anon_sessions (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    token_digest       text        NOT NULL UNIQUE,
    agent_id           uuid        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    channel            text        NOT NULL CHECK (channel IN ('public', 'widget')),
    publishable_key_id uuid        REFERENCES publishable_keys (id) ON DELETE SET NULL,
    ip_prefix          text        NOT NULL,
    user_agent_hash    text        NOT NULL,
    -- The session's current conversation (one at a time).
    conversation_id    uuid,
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL
);
CREATE INDEX anon_sessions_expires_idx ON anon_sessions (expires_at);

-- Anonymous conversations have no user; retention deletes them (ADR-0010).
ALTER TABLE conversations
    ALTER COLUMN user_id DROP NOT NULL,
    ADD COLUMN anonymous boolean NOT NULL DEFAULT false,
    ADD COLUMN anon_session_id uuid REFERENCES anon_sessions (id) ON DELETE SET NULL,
    ADD CONSTRAINT conversations_owner_check CHECK (anonymous OR user_id IS NOT NULL);
CREATE INDEX conversations_anonymous_idx ON conversations (updated_at) WHERE anonymous;
ALTER TABLE anon_sessions
    ADD CONSTRAINT anon_sessions_conversation_fkey
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL;

-- Analytics channels for anonymous public pages and the widget (00017
-- re-creates the same constraint; both are idempotent).
ALTER TABLE message_events DROP CONSTRAINT IF EXISTS message_events_channel_check;
ALTER TABLE message_events ADD CONSTRAINT message_events_channel_check
    CHECK (channel IN ('ui', 'api', 'openai', 'test', 'public', 'widget'));

-- Per-agent daily caps sum the ledger by agent (§7).
CREATE INDEX usage_events_agent_kind_time_idx ON usage_events (agent_id, kind, occurred_at)
    INCLUDE (quantity) WHERE agent_id IS NOT NULL;

-- +goose Down
DROP INDEX usage_events_agent_kind_time_idx;
DELETE FROM message_events WHERE channel IN ('public', 'widget');
ALTER TABLE message_events DROP CONSTRAINT IF EXISTS message_events_channel_check;
ALTER TABLE message_events ADD CONSTRAINT message_events_channel_check
    CHECK (channel IN ('ui', 'api', 'openai', 'test'));
ALTER TABLE anon_sessions DROP CONSTRAINT anon_sessions_conversation_fkey;
DELETE FROM conversations WHERE anonymous;
DROP INDEX conversations_anonymous_idx;
ALTER TABLE conversations
    DROP CONSTRAINT conversations_owner_check,
    DROP COLUMN anon_session_id,
    DROP COLUMN anonymous,
    ALTER COLUMN user_id SET NOT NULL;
DROP TABLE anon_sessions;
DROP TABLE publishable_keys;
DROP TABLE agent_short_names;
ALTER TABLE classification_levels DROP COLUMN anonymous_retention_hours;
DROP TABLE platform_settings;
