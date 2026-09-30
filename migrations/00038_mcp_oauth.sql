-- OAuth sign-in for MCP clients (docs/v0.3.0.md §3, docs/mcp.md "Signing in
-- with OAuth (experimental)"): Grounded as a small OAuth 2.1 authorization
-- server in front of the platform's sign-in, for POST /mcp only.
--
--   * mcp_settings.oauth_enabled: the platform setting, off by default. It
--     only takes effect while the MCP server itself is on.
--   * oauth_clients: clients registered with Dynamic Client Registration
--     (RFC 7591). Clients identified by a Client ID Metadata Document (an
--     https URL) aren't stored: their document is fetched and cached in
--     memory. A registered client unused for 30 days is deleted.
--   * oauth_grants: a person's consent for a client (one active grant per
--     person and client). Revoking it (the person, a platform admin, reuse
--     of a rotated refresh token, or RFC 7009) ends every token of the grant.
--   * oauth_codes: authorization codes (hashed), single use, 60 seconds,
--     bound to the client, redirect URI, PKCE challenge, resource and grant.
--   * oauth_tokens: access and refresh tokens, stored as HMAC-SHA256 digests
--     under the API-key pepper (like API keys), never in clear. Expired and
--     revoked tokens are deleted (a revoked grant keeps no tokens).
--
-- A new column with a default and new tables only (expand/contract,
-- ADR-0013): the previous release never reads them.

-- +goose Up
ALTER TABLE mcp_settings ADD COLUMN oauth_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE oauth_clients (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     text        NOT NULL UNIQUE CHECK (char_length(client_id) BETWEEN 1 AND 100),
    client_name   text        NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 200),
    redirect_uris text[]      NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
    client_uri    text        CHECK (char_length(client_uri) <= 500),
    logo_uri      text        CHECK (char_length(logo_uri) <= 500),
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_clients_last_used_idx ON oauth_clients (last_used_at);

CREATE TABLE oauth_grants (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        NOT NULL REFERENCES users (id),
    -- The client as it identified itself: an https URL (a metadata
    -- document) or a registered client's id.
    client_id      text        NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 500),
    client_kind    text        NOT NULL CHECK (client_kind IN ('metadata', 'registered')),
    -- The name and address shown when consent was given.
    client_name    text        NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 200),
    client_uri     text        CHECK (char_length(client_uri) <= 500),
    resource       text        NOT NULL,
    scopes         text[]      NOT NULL DEFAULT ARRAY['mcp']::text[],
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_used_at   timestamptz,
    revoked_at     timestamptz,
    revoked_reason text        CHECK (revoked_reason IN ('user', 'admin', 'client', 'refresh_reuse'))
);
CREATE UNIQUE INDEX oauth_grants_active_idx ON oauth_grants (user_id, client_id) WHERE revoked_at IS NULL;
CREATE INDEX oauth_grants_user_idx ON oauth_grants (user_id, created_at DESC);

CREATE TABLE oauth_codes (
    code_hash      bytea       PRIMARY KEY,
    grant_id       uuid        NOT NULL REFERENCES oauth_grants (id) ON DELETE CASCADE,
    client_id      text        NOT NULL,
    redirect_uri   text        NOT NULL,
    code_challenge text        NOT NULL,
    resource       text        NOT NULL,
    expires_at     timestamptz NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_codes_expires_idx ON oauth_codes (expires_at);

CREATE TABLE oauth_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    grant_id    uuid        NOT NULL REFERENCES oauth_grants (id) ON DELETE CASCADE,
    kind        text        NOT NULL CHECK (kind IN ('access', 'refresh')),
    token_hash  bytea       NOT NULL UNIQUE,
    pepper_id   bytea       NOT NULL,
    resource    text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    -- A refresh token exchanged for a new pair: presenting it again is
    -- reuse, which revokes the grant. Revoked tokens are deleted.
    rotated_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_grant_idx ON oauth_tokens (grant_id);
CREATE INDEX oauth_tokens_expires_idx ON oauth_tokens (expires_at);

-- +goose Down
DROP TABLE oauth_tokens;
DROP TABLE oauth_codes;
DROP TABLE oauth_grants;
DROP TABLE oauth_clients;
ALTER TABLE mcp_settings DROP COLUMN oauth_enabled;
