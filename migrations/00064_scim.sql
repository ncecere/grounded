-- +goose Up
-- SCIM provisioning (E4, #35; docs/specs/scim/DESIGN.md). Expand only: the previous release ignores all of it.
-- scim_external_id is the identity provider's object ID (SCIM externalId), set on users SCIM created or linked; a
-- SCIM-created user who has not signed in has the subject 'scim-pending:<id>', which no sign-in can produce.
ALTER TABLE users ADD COLUMN scim_external_id text CHECK (char_length(scim_external_id) BETWEEN 1 AND 256);
ALTER TABLE users ADD COLUMN scim_user_name text NOT NULL DEFAULT '' CHECK (char_length(scim_user_name) <= 256);
CREATE UNIQUE INDEX users_scim_external_id_key ON users (scim_external_id) WHERE scim_external_id IS NOT NULL;

CREATE TABLE scim_tokens (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    digest       bytea       NOT NULL UNIQUE,
    created_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at   timestamptz
);

CREATE TABLE scim_groups (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text        NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 256),
    external_id  text        CHECK (char_length(external_id) BETWEEN 1 AND 256),
    revision     bigint      NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scim_groups_display_name_key ON scim_groups (lower(display_name));
CREATE UNIQUE INDEX scim_groups_external_id_key ON scim_groups (external_id) WHERE external_id IS NOT NULL;

CREATE TABLE scim_group_members (
    group_id uuid NOT NULL REFERENCES scim_groups (id) ON DELETE CASCADE,
    user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX scim_group_members_user_idx ON scim_group_members (user_id);

-- +goose Down
DROP TABLE scim_group_members;
DROP TABLE scim_groups;
DROP TABLE scim_tokens;
DROP INDEX users_scim_external_id_key;
ALTER TABLE users DROP COLUMN scim_user_name;
ALTER TABLE users DROP COLUMN scim_external_id;
