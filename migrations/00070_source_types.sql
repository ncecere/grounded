-- +goose NO TRANSACTION
-- Source types come from a registry in the code (ADR-0035, #258), so adding a connector needs no migration.
--
-- data_sources.type and classification_levels.allowed_source_types were checked against the list ('upload', 'web').
-- The lists go; the type keeps a format check, and the application validates both against the registered types. A pod of
-- the previous release only ever writes 'upload' and 'web', which stay valid, and no other type can exist until a
-- platform admin turns one on (source_type_settings), which the upgrade guide says to do after the rollout.
--
-- This file runs outside a transaction: each new check is added NOT VALID and validated in its own statement, so the scan
-- does not hold the lock that blocks writes. Every statement can be run again.

-- +goose Up
ALTER TABLE data_sources DROP CONSTRAINT IF EXISTS data_sources_type_check;
ALTER TABLE data_sources DROP CONSTRAINT IF EXISTS data_sources_type_format_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_type_format_check CHECK (type ~ '^[a-z][a-z0-9_]{1,39}$') NOT VALID;
ALTER TABLE data_sources VALIDATE CONSTRAINT data_sources_type_format_check;

ALTER TABLE classification_levels DROP CONSTRAINT IF EXISTS classification_levels_allowed_source_types_check;
ALTER TABLE classification_levels DROP CONSTRAINT IF EXISTS classification_levels_allowed_source_types_some_check;
ALTER TABLE classification_levels ADD CONSTRAINT classification_levels_allowed_source_types_some_check
    CHECK (cardinality(allowed_source_types) >= 1) NOT VALID;
ALTER TABLE classification_levels VALIDATE CONSTRAINT classification_levels_allowed_source_types_some_check;

-- A platform admin's switch for one source type. No row: the type's default (on for upload and web, off for the others).
CREATE TABLE IF NOT EXISTS source_type_settings (
    type       text        PRIMARY KEY CHECK (type ~ '^[a-z][a-z0-9_]{1,39}$'),
    enabled    boolean     NOT NULL,
    updated_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS source_type_settings;
ALTER TABLE classification_levels DROP CONSTRAINT IF EXISTS classification_levels_allowed_source_types_some_check;
ALTER TABLE classification_levels ADD CONSTRAINT classification_levels_allowed_source_types_check
    CHECK (cardinality(allowed_source_types) >= 1 AND allowed_source_types <@ ARRAY['upload', 'web']::text[]) NOT VALID;
ALTER TABLE data_sources DROP CONSTRAINT IF EXISTS data_sources_type_format_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_type_check CHECK (type IN ('upload', 'web')) NOT VALID;
