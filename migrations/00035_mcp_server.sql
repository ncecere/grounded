-- Grounded as an MCP server (docs/v0.3.0.md §3, §7; docs/mcp.md): the
-- platform switch for POST /mcp, the API-key scope mcp, and the analytics
-- channel mcp for answers asked over MCP.
--
-- The switch is its own one-row table rather than a column on
-- platform_settings, as with evaluation_settings (00034): the previous
-- release reads platform_settings with SELECT *, which a new column would
-- break during a rolling upgrade (expand/contract, ADR-0013). It is off on
-- every install until a platform admin turns it on.
--
-- Both CHECK constraints only widen: the previous release never writes
-- 'mcp', so it keeps working against this schema. The message_events
-- constraint is added NOT VALID and validated separately, so the table isn't
-- locked against writes while existing rows are checked.

-- +goose Up
CREATE TABLE mcp_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled    boolean     NOT NULL DEFAULT false,
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO mcp_settings DEFAULT VALUES;

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_scopes_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check
    CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['query', 'ingest', 'manage', 'mcp']::text[]);

ALTER TABLE message_events DROP CONSTRAINT IF EXISTS message_events_channel_check;
ALTER TABLE message_events ADD CONSTRAINT message_events_channel_check
    CHECK (channel IN ('ui', 'api', 'openai', 'test', 'public', 'widget', 'mcp')) NOT VALID;
ALTER TABLE message_events VALIDATE CONSTRAINT message_events_channel_check;

-- +goose Down
-- Answers asked over MCP are counted as API answers; keys lose the mcp
-- scope, and a key that had only mcp is revoked (it could do nothing else).
UPDATE message_events SET channel = 'api' WHERE channel = 'mcp';
ALTER TABLE message_events DROP CONSTRAINT IF EXISTS message_events_channel_check;
ALTER TABLE message_events ADD CONSTRAINT message_events_channel_check
    CHECK (channel IN ('ui', 'api', 'openai', 'test', 'public', 'widget'));

UPDATE api_keys SET revoked_at = coalesce(revoked_at, now()), scopes = ARRAY['query']::text[] WHERE scopes = ARRAY['mcp']::text[];
UPDATE api_keys SET scopes = array_remove(scopes, 'mcp') WHERE 'mcp' = ANY (scopes);
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_scopes_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check
    CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['query', 'ingest', 'manage']::text[]);

DROP TABLE mcp_settings;
