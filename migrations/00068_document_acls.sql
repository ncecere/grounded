-- +goose NO TRANSACTION
-- Document permissions (B6, #41; docs/specs/document-acls/DESIGN.md). Expand only.
--
-- documents.acl_principals: NULL is unrestricted (every document before this release); a list restricts the document to
-- those principals (namespaced, lower-case strings: user:, subject:, email:, group:, source:); an empty list is nobody.
-- data_sources.acl_principals is a restriction set by hand on a whole source; ingest copies it to the source's documents.
-- data_sources.restricted_documents is set by a trigger as soon as any of the source's documents is restricted and is never
-- cleared by the application: search adds the permission condition to candidate retrieval only for such sources, and always
-- applies it where passage text is read. A pod of the previous release ignores these columns, so restrictions stay behind
-- the Document permissions switch (document_access_settings), off by default.
-- The GIN index is built concurrently (this file runs outside a transaction), with 00066's guard for an invalid leftover.

-- +goose Up
ALTER TABLE documents ADD COLUMN IF NOT EXISTS acl_principals text[];
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS acl_principals text[];
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS restricted_documents boolean NOT NULL DEFAULT false;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION documents_mark_restricted_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.acl_principals IS NOT NULL THEN
        UPDATE data_sources SET restricted_documents = true WHERE id = NEW.source_id AND NOT restricted_documents;
    END IF;
    RETURN NEW;
END
$$;
-- +goose StatementEnd

DROP TRIGGER IF EXISTS documents_mark_restricted_source ON documents;
CREATE TRIGGER documents_mark_restricted_source BEFORE INSERT OR UPDATE OF acl_principals ON documents
    FOR EACH ROW EXECUTE FUNCTION documents_mark_restricted_source();

CREATE TABLE IF NOT EXISTS document_access_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled    boolean     NOT NULL DEFAULT false,
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO document_access_settings DEFAULT VALUES ON CONFLICT DO NOTHING;

-- A connector's own groups, expanded to their members' principals at sync (source:<source id>:<group id>).
CREATE TABLE IF NOT EXISTS source_group_members (
    source_id uuid NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    group_id  text NOT NULL CHECK (char_length(group_id) BETWEEN 1 AND 512),
    principal text NOT NULL CHECK (char_length(principal) BETWEEN 1 AND 600),
    PRIMARY KEY (source_id, group_id, principal)
);
CREATE INDEX IF NOT EXISTS source_group_members_principal_idx ON source_group_members (principal);

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('documents_acl_principals_idx') AND NOT indisvalid) THEN
        DROP INDEX documents_acl_principals_idx;
    END IF;
END
$$;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS documents_acl_principals_idx ON documents USING gin (acl_principals)
    WHERE acl_principals IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS documents_acl_principals_idx;
DROP TABLE IF EXISTS source_group_members;
DROP TABLE IF EXISTS document_access_settings;
DROP TRIGGER IF EXISTS documents_mark_restricted_source ON documents;
DROP FUNCTION IF EXISTS documents_mark_restricted_source();
ALTER TABLE data_sources DROP COLUMN IF EXISTS restricted_documents;
ALTER TABLE data_sources DROP COLUMN IF EXISTS acl_principals;
ALTER TABLE documents DROP COLUMN IF EXISTS acl_principals;
