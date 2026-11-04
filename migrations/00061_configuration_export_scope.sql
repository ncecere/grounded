-- +goose Up
-- Expand only: the configuration scopes (#32) confer no general team role. configuration:apply is honoured only
-- with manage on an unrestricted key of the same team. Existing writers and grants remain valid.
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check
 CHECK (cardinality(scopes)>0 AND scopes <@ ARRAY['query','ingest','manage','mcp','configuration:export','configuration:apply']::text[]);

-- +goose Down
-- Do not silently give a configuration-only key other authority on downgrade: revoke or remove keys with a
-- configuration scope before downgrading (the constraint refuses while they exist).
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check
 CHECK (cardinality(scopes)>0 AND scopes <@ ARRAY['query','ingest','manage','mcp']::text[]);
