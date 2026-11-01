-- +goose Up
-- Expand only: an export scope confers no general team role or write grant.
-- 00060 is reserved for lane 34. Existing writers and grants remain valid.
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check
 CHECK (cardinality(scopes)>0 AND scopes <@ ARRAY['query','ingest','manage','mcp','configuration:export']::text[]);

-- +goose Down
-- Do not silently give an export-only key query/write authority on downgrade.
-- Operators must revoke/remove export-scoped keys before downgrading.
ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_check
 CHECK (cardinality(scopes)>0 AND scopes <@ ARRAY['query','ingest','manage','mcp']::text[]);
