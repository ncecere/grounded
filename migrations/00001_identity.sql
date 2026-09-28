-- Identity, browser sessions and the append-only audit log.
--
-- Migration rules (ADR-0013): every migration must be compatible with the
-- previous release's code (expand/contract). Never rename or drop in the same
-- release that stops using a column; ship the destructive step one release later.

-- +goose Up
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_issuer   text        NOT NULL,
    oidc_subject  text        NOT NULL,
    email         citext      NOT NULL,
    display_name  text        NOT NULL DEFAULT '',
    platform_role text        NOT NULL DEFAULT 'none'
        CHECK (platform_role IN ('none', 'platform_admin', 'platform_auditor')),
    status        text        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
    -- All OIDC claims from the latest login, kept so audiences can later be
    -- restricted by affiliation or group without a redesign (ADR-0009).
    claims        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    CONSTRAINT users_identity_key UNIQUE (oidc_issuer, oidc_subject)
);
CREATE INDEX users_email_idx ON users (email);

-- Records that the configured bootstrap identity was promoted once, so a later
-- intentional demotion is not undone by logging in again.
CREATE TABLE platform_bootstrap (
    oidc_issuer  text        NOT NULL,
    oidc_subject text        NOT NULL,
    applied_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (oidc_issuer, oidc_subject)
);

CREATE TABLE sessions (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- SHA-256 of the cookie secret; the secret itself is never stored.
    token_digest text        NOT NULL UNIQUE,
    csrf_token   text        NOT NULL,
    user_agent   text        NOT NULL DEFAULT '',
    client_ip    text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE audit_log (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    actor_kind    text        NOT NULL CHECK (actor_kind IN ('user', 'api_key', 'system')),
    actor_user_id uuid        REFERENCES users (id),
    team_id       uuid,
    action        text        NOT NULL,
    target_type   text        NOT NULL,
    target_id     text        NOT NULL DEFAULT '',
    before_state  jsonb,
    after_state   jsonb,
    metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    request_id    text        NOT NULL DEFAULT '',
    client_ip     text        NOT NULL DEFAULT ''
);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_team_idx ON audit_log (team_id, occurred_at DESC) WHERE team_id IS NOT NULL;
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, occurred_at DESC);

-- The audit log is append-only. Updates are always rejected. Deletes are only
-- allowed for the retention job, which sets ragd.audit_purge = 'on' for its
-- transaction (and honours legal holds before doing so).
-- +goose StatementBegin
CREATE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('ragd.audit_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- +goose Down
DROP TABLE audit_log;
DROP FUNCTION audit_log_append_only();
DROP TABLE sessions;
DROP TABLE platform_bootstrap;
DROP TABLE users;
