-- The MCP client in agents (docs/v0.3.0.md §4, docs/mcp-client.md): remote
-- MCP servers registered by platform admins, the tools each server lists
-- (each approved or not), the tools a published agent version may call,
-- the mcp_calls price unit, and MCP servers as a stored-health subject.
--
--   * mcp_servers: a Streamable HTTP endpoint with an optional static
--     header (its value sealed like connection keys, internal/secrets, bound
--     to the row), a classification ceiling (the highest data level it may
--     receive, ADR-0006 rule 4 as for models), a timeout and a switch.
--   * mcp_server_tools: the server's tools as of its last refresh. A tool the
--     server no longer lists is marked gone (and unapproved), not deleted:
--     agents that chose it keep a readable reference and are told why it no
--     longer works. A tool whose description or input schema changed is
--     unapproved too (the description is a prompt the model reads).
--   * agent_tools: the tools of a published version, like its KBs
--     (agent_version_kbs). The draft lists tool IDs in its config.
--
-- New tables and widened CHECK constraints only (expand/contract,
-- ADR-0013): the previous release never writes mcp_server or mcp_calls, so
-- it keeps working against this schema. The widened constraints are added
-- NOT VALID and validated separately.

-- +goose Up
CREATE TABLE mcp_servers (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text        NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 100),
    description       text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
    -- The Streamable HTTP endpoint, for example https://status.example.edu/mcp.
    url               text        NOT NULL CHECK (url ~ '^https?://' AND char_length(url) <= 500),
    -- A static header sent with every request (for example Authorization),
    -- its value sealed with ENCRYPTION_KEY; both NULL when the server needs
    -- no credentials.
    auth_header_name  text        CHECK (auth_header_name ~ '^[A-Za-z0-9!#$%&''*+.^_`|~-]{1,100}$'),
    auth_value_cipher bytea,
    auth_value_hint   text        NOT NULL DEFAULT '',
    max_classification text       NOT NULL REFERENCES classification_levels (key) ON UPDATE RESTRICT ON DELETE RESTRICT,
    timeout_seconds   integer     NOT NULL DEFAULT 30 CHECK (timeout_seconds BETWEEN 1 AND 120),
    enabled           boolean     NOT NULL DEFAULT true,
    -- When the tool list was last fetched (NULL: never).
    tools_refreshed_at timestamptz,
    revision          bigint      NOT NULL DEFAULT 1,
    created_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mcp_servers_auth_pair CHECK ((auth_header_name IS NULL) = (auth_value_cipher IS NULL))
);

CREATE TABLE mcp_server_tools (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id    uuid        NOT NULL REFERENCES mcp_servers (id) ON DELETE CASCADE,
    name         text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 128),
    title        text        NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
    description  text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 10000),
    input_schema jsonb       NOT NULL DEFAULT '{"type":"object"}'::jsonb,
    approved     boolean     NOT NULL DEFAULT false,
    approved_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    approved_at  timestamptz,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    -- Set when a refresh no longer finds the tool (NULL while listed).
    gone_at      timestamptz,
    CONSTRAINT mcp_server_tools_server_name_key UNIQUE (server_id, name),
    CONSTRAINT mcp_server_tools_gone_unapproved CHECK (gone_at IS NULL OR NOT approved)
);

CREATE TABLE agent_tools (
    version_id uuid NOT NULL REFERENCES agent_versions (id) ON DELETE CASCADE,
    -- Deleting a server removes its tools from past versions; the service
    -- refuses while a published (current) version uses one.
    tool_id    uuid NOT NULL REFERENCES mcp_server_tools (id) ON DELETE CASCADE,
    PRIMARY KEY (version_id, tool_id)
);
CREATE INDEX agent_tools_tool_idx ON agent_tools (tool_id);

-- MCP tool calls are priced per call, per server (model_prices.model_id is
-- the server's ID; it has no foreign key).
ALTER TABLE model_prices DROP CONSTRAINT IF EXISTS model_prices_unit_check;
ALTER TABLE model_prices ADD CONSTRAINT model_prices_unit_check
    CHECK (unit IN ('chat_tokens_in', 'chat_tokens_out', 'embed_tokens', 'systemone_tokens', 'systemone_requests',
                    'moderation_requests', 'vision_tokens_in', 'vision_tokens_out', 'mcp_calls')) NOT VALID;
ALTER TABLE model_prices VALIDATE CONSTRAINT model_prices_unit_check;

-- MCP servers are a stored-health subject (00036).
ALTER TABLE health_checks DROP CONSTRAINT health_checks_subject_kind;
ALTER TABLE health_checks ADD CONSTRAINT health_checks_subject_kind
    CHECK (subject_kind IN ('connection', 'model', 'mcp_server')) NOT VALID;
ALTER TABLE health_checks VALIDATE CONSTRAINT health_checks_subject_kind;

CREATE OR REPLACE VIEW health_subjects AS
SELECT 'connection'::text AS subject_kind, c.id AS subject_id, c.name AS name, c.enabled AS enabled
FROM model_connections c
UNION ALL
SELECT 'model'::text, m.id, m.display_name, m.enabled AND c.enabled
FROM models m
JOIN model_connections c ON c.id = m.connection_id
UNION ALL
SELECT 'mcp_server'::text, s.id, s.name, s.enabled
FROM mcp_servers s;

-- +goose Down
CREATE OR REPLACE VIEW health_subjects AS
SELECT 'connection'::text AS subject_kind, c.id AS subject_id, c.name AS name, c.enabled AS enabled
FROM model_connections c
UNION ALL
SELECT 'model'::text, m.id, m.display_name, m.enabled AND c.enabled
FROM models m
JOIN model_connections c ON c.id = m.connection_id;

DELETE FROM health_checks WHERE subject_kind = 'mcp_server';
ALTER TABLE health_checks DROP CONSTRAINT health_checks_subject_kind;
ALTER TABLE health_checks ADD CONSTRAINT health_checks_subject_kind CHECK (subject_kind IN ('connection', 'model'));

DELETE FROM model_prices WHERE unit = 'mcp_calls';
ALTER TABLE model_prices DROP CONSTRAINT IF EXISTS model_prices_unit_check;
ALTER TABLE model_prices ADD CONSTRAINT model_prices_unit_check
    CHECK (unit IN ('chat_tokens_in', 'chat_tokens_out', 'embed_tokens', 'systemone_tokens', 'systemone_requests',
                    'moderation_requests', 'vision_tokens_in', 'vision_tokens_out'));

DROP TABLE agent_tools;
DROP TABLE mcp_server_tools;
DROP TABLE mcp_servers;
