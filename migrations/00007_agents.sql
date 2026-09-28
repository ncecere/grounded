-- Agents, versions, audience grants, conversations, analytics events and the
-- access log (Phase 3; ADR-0009, ADR-0010, docs/phase3-agents.md §2).

-- +goose Up
CREATE TABLE agents (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id              uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    -- Same rules as team slugs; unique per team among live agents.
    slug                 text        NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
    name                 text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    description          text        NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    -- #rrggbb, contrast-checked by the API; '' = the platform default.
    accent_color         text        NOT NULL DEFAULT '' CHECK (accent_color = '' OR accent_color ~ '^#[0-9a-f]{6}$'),
    welcome_message      text        NOT NULL DEFAULT '' CHECK (length(welcome_message) <= 1000),
    starter_questions    text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(starter_questions) <= 6),
    status               text        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled_by_team', 'disabled_by_platform')),
    disabled_reason      text        NOT NULL DEFAULT '' CHECK (length(disabled_reason) <= 500),
    disabled_by          uuid        REFERENCES users (id),
    disabled_at          timestamptz,
    -- The editable AgentConfig (internal/agents); saved leniently.
    draft                jsonb       NOT NULL DEFAULT '{}'::jsonb,
    draft_revision       bigint      NOT NULL DEFAULT 1,
    published_version_id uuid,
    revision             bigint      NOT NULL DEFAULT 1,
    created_by           uuid        REFERENCES users (id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    -- Soft delete: conversations stay readable by their owners.
    deleted_at           timestamptz
);
CREATE UNIQUE INDEX agents_team_slug_key ON agents (team_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX agents_team_idx ON agents (team_id, lower(name)) WHERE deleted_at IS NULL;

-- Immutable snapshots of an agent's configuration.
CREATE TABLE agent_versions (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id       uuid        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    version        integer     NOT NULL CHECK (version >= 1),
    config         jsonb       NOT NULL,
    chat_model_id  uuid        NOT NULL REFERENCES models (id),
    -- max(rank of the version's KBs) when published; recomputed per query.
    effective_rank integer     NOT NULL,
    note           text        NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    published_by   uuid        REFERENCES users (id),
    published_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_versions_agent_version_key UNIQUE (agent_id, version)
);
ALTER TABLE agents ADD CONSTRAINT agents_published_version_fkey
    FOREIGN KEY (published_version_id) REFERENCES agent_versions (id);

-- +goose StatementBegin
CREATE FUNCTION agent_versions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'agent_versions rows are immutable';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER agent_versions_immutable
    BEFORE UPDATE ON agent_versions
    FOR EACH ROW EXECUTE FUNCTION agent_versions_immutable();

-- The KBs a version searches. NO ACTION (checked at the end of the
-- statement) rather than RESTRICT so deleting a whole team still cascades;
-- a direct KB delete is refused while a version references it.
CREATE TABLE agent_version_kbs (
    version_id uuid NOT NULL REFERENCES agent_versions (id) ON DELETE CASCADE,
    kb_id      uuid NOT NULL REFERENCES knowledge_bases (id),
    PRIMARY KEY (version_id, kb_id)
);
CREATE INDEX agent_version_kbs_kb_idx ON agent_version_kbs (kb_id);

-- Who may use an agent (ADR-0009). v1: exactly one row per agent; Phase 3
-- writes only principal_type 'team'.
CREATE TABLE agent_audience_grants (
    agent_id       uuid        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    principal_type text        NOT NULL CHECK (principal_type IN ('team', 'all_authenticated', 'public')),
    principal_id   uuid,
    created_by     uuid        REFERENCES users (id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_audience_grants_agent_key UNIQUE (agent_id)
);

-- Transcripts belong to their user (ADR-0010).
CREATE TABLE conversations (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        uuid        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title           text        NOT NULL DEFAULT '' CHECK (length(title) <= 200),
    last_version_id uuid        REFERENCES agent_versions (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- Soft delete: hidden at once, purged by retention (Phase 5).
    deleted_at      timestamptz
);
CREATE INDEX conversations_user_idx ON conversations (user_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX conversations_agent_idx ON conversations (agent_id, created_at);

-- Transcript content lives only here.
CREATE TABLE messages (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    seq              integer     NOT NULL,
    role             text        NOT NULL CHECK (role IN ('user', 'assistant', 'tool_result')),
    -- user: {"text"}; assistant: llm content blocks; tool_result: llm tool result.
    content          jsonb       NOT NULL,
    citations        jsonb,
    agent_version_id uuid        REFERENCES agent_versions (id),
    model_id         uuid,
    usage            jsonb,
    stop_reason      text        NOT NULL DEFAULT '',
    error_code       text        NOT NULL DEFAULT '',
    latency_ms       integer,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT messages_conversation_seq_key UNIQUE (conversation_id, seq)
);

-- Analytics: one row per assistant answer. Never content, never a user ID.
CREATE TABLE message_events (
    id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id            uuid        NOT NULL,
    agent_id           uuid        NOT NULL,
    -- NULL for draft test chats.
    agent_version_id   uuid,
    -- The assistant message; NULL when not persisted (API service keys,
    -- the OpenAI-compatible endpoint, test chats) or purged.
    message_id         uuid        REFERENCES messages (id) ON DELETE SET NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    channel            text        NOT NULL CHECK (channel IN ('ui', 'api', 'openai', 'test')),
    audience_type      text        NOT NULL,
    model_id           uuid,
    latency_ms         integer     NOT NULL DEFAULT 0,
    first_token_ms     integer,
    input_tokens       integer     NOT NULL DEFAULT 0,
    output_tokens      integer     NOT NULL DEFAULT 0,
    reasoning_tokens   integer     NOT NULL DEFAULT 0,
    hit_count          integer     NOT NULL DEFAULT 0,
    top_similarity     real,
    no_context         boolean     NOT NULL DEFAULT false,
    refused            boolean     NOT NULL DEFAULT false,
    tool_calls         integer     NOT NULL DEFAULT 0,
    cited_document_ids uuid[]      NOT NULL DEFAULT '{}',
    stop_reason        text        NOT NULL DEFAULT '',
    error_code         text        NOT NULL DEFAULT '',
    -- HMAC of the user ID with a per-team key; NULL for service keys.
    pseudonymous_user  text,
    feedback           text        CHECK (feedback IN ('up', 'down')),
    feedback_reason    text        CHECK (feedback_reason IN ('incorrect', 'not_helpful', 'missing_sources',
                                        'wrong_sources', 'outdated', 'harmful_or_unsafe', 'other')),
    feedback_at        timestamptz
);
CREATE INDEX message_events_agent_time_idx ON message_events (agent_id, created_at);
CREATE UNIQUE INDEX message_events_message_key ON message_events (message_id) WHERE message_id IS NOT NULL;

-- Every use of a Sensitive or Restricted agent (DESIGN §8). No foreign
-- keys: the log outlives what it refers to.
CREATE TABLE access_log (
    id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          uuid,
    api_key_id       uuid,
    agent_id         uuid        NOT NULL,
    agent_version_id uuid,
    rank             integer     NOT NULL,
    channel          text        NOT NULL,
    at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_log_at_idx ON access_log (at DESC, id DESC);
CREATE INDEX access_log_agent_idx ON access_log (agent_id, at DESC);
CREATE INDEX access_log_user_idx ON access_log (user_id, at DESC);

-- The usage ledger records the agent (DESIGN §11.2).
ALTER TABLE usage_events ADD COLUMN agent_id uuid;

-- Metadata filters match any of a document's tags.
CREATE INDEX documents_tags_idx ON documents USING gin (tags);

-- +goose Down
DROP INDEX documents_tags_idx;
ALTER TABLE usage_events DROP COLUMN agent_id;
DROP TABLE access_log;
DROP TABLE message_events;
DROP TABLE messages;
DROP TABLE conversations;
DROP TABLE agent_audience_grants;
DROP TABLE agent_version_kbs;
ALTER TABLE agents DROP CONSTRAINT agents_published_version_fkey;
DROP TABLE agent_versions;
DROP FUNCTION agent_versions_immutable();
DROP TABLE agents;
