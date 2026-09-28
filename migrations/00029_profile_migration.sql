-- Embedding profile migration (docs/phase5-deploy.md §5 P2, ADR-0007,
-- DESIGN.md §10 "Changing embedding profiles"): a knowledge base moves to
-- another embedding profile in the background, and switches in one step.
--
--   * chunks.profile_id: the profile a chunk was cut and embedded for. A
--     document has one chunk set per profile its source is embedded with:
--     normally one (its source's embedding_profile_id); two while a
--     migration runs and during its grace period. Chunk settings belong to
--     the profile, so a profile with other chunk sizes gets its own rows;
--     one with the same sizes gets copies of the existing rows (no
--     re-chunking), each with a vector in its own profile's table.
--   * source_embedding_sets: the extra profiles a source is embedded with,
--     besides its own. Ingestion keeps every set current; a set nobody
--     needs any more (no KB uses the profile, no running migration targets
--     it and no switched migration can switch back to it) is deleted by the
--     cleanup job.
--   * embedding_set_failures: documents that could not be re-embedded for a
--     set (per document version), shown and retryable.
--   * profile_migrations: one KB's move from one profile to another.
--
-- Expand/contract (ADR-0013): code of the previous release inserts chunks
-- without profile_id; a trigger fills it in from the source, so it keeps
-- working during a rolling upgrade. The backfill rewrites every chunk row
-- once (seconds for a few hundred thousand chunks).

-- +goose Up
ALTER TABLE chunks ADD COLUMN profile_id uuid;
UPDATE chunks c SET profile_id = s.embedding_profile_id FROM data_sources s WHERE s.id = c.source_id;
-- Chunks of deleted sources (none are expected: documents cascade).
DELETE FROM chunks WHERE profile_id IS NULL;
ALTER TABLE chunks ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE chunks ADD CONSTRAINT chunks_profile_fkey
    FOREIGN KEY (profile_id) REFERENCES embedding_profiles (id) ON DELETE RESTRICT;

-- +goose StatementBegin
CREATE FUNCTION chunks_default_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.profile_id := (SELECT embedding_profile_id FROM data_sources WHERE id = NEW.source_id);
    RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER chunks_default_profile BEFORE INSERT ON chunks
    FOR EACH ROW WHEN (NEW.profile_id IS NULL) EXECUTE FUNCTION chunks_default_profile();

-- Ordinals are unique per document and profile.
CREATE UNIQUE INDEX chunks_document_profile_ordinal_key ON chunks (document_id, profile_id, ordinal);
ALTER TABLE chunks DROP CONSTRAINT chunks_document_ordinal_key;
-- Cleanup deletes one source's chunks of one profile.
CREATE INDEX chunks_source_profile_idx ON chunks (source_id, profile_id);
DROP INDEX chunks_source_idx;

CREATE TABLE source_embedding_sets (
    source_id  uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    profile_id uuid        NOT NULL REFERENCES embedding_profiles (id) ON DELETE RESTRICT,
    -- building: a migration is embedding it; ready: every ready document
    -- was embedded once (new documents follow within seconds); deleting:
    -- the cleanup job is removing its chunks (nothing writes to it).
    status     text        NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'ready', 'deleting')),
    -- Why the set can't progress right now (e.g. the model is disabled).
    last_error text        NOT NULL DEFAULT '' CHECK (char_length(last_error) <= 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    ready_at   timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, profile_id)
);
CREATE INDEX source_embedding_sets_profile_idx ON source_embedding_sets (profile_id);

CREATE TABLE embedding_set_failures (
    document_id   uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    profile_id    uuid        NOT NULL,
    source_id     uuid        NOT NULL,
    -- The document version that failed: a new version is tried again.
    version       integer     NOT NULL,
    error_code    text        NOT NULL DEFAULT '',
    error_message text        NOT NULL DEFAULT '' CHECK (char_length(error_message) <= 1000),
    attempts      integer     NOT NULL DEFAULT 1,
    -- Permanent failures wait for a retry by an admin; others are retried
    -- after retry_after.
    permanent     boolean     NOT NULL DEFAULT false,
    retry_after   timestamptz,
    failed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, profile_id)
);
CREATE INDEX embedding_set_failures_set_idx ON embedding_set_failures (source_id, profile_id);

CREATE TABLE profile_migrations (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id             uuid        NOT NULL REFERENCES knowledge_bases (id) ON DELETE CASCADE,
    team_id           uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    from_profile_id   uuid        NOT NULL REFERENCES embedding_profiles (id) ON DELETE CASCADE,
    to_profile_id     uuid        NOT NULL REFERENCES embedding_profiles (id) ON DELETE CASCADE,
    -- running: re-embedding; switched: the KB uses the new profile and the
    -- old vectors are kept until old_vectors_until (switch back possible);
    -- completed: old vectors deleted; cancelled; switched_back.
    status            text        NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'switched', 'completed', 'cancelled', 'switched_back')),
    grace_days        integer     NOT NULL CHECK (grace_days BETWEEN 0 AND 90),
    -- The preflight figures at start (counts only).
    estimate          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    started_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
    started_at        timestamptz NOT NULL DEFAULT now(),
    switched_at       timestamptz,
    old_vectors_until timestamptz,
    finished_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
    finished_at       timestamptz,
    -- Set when admins were told documents failed; cleared by a retry.
    attention_at      timestamptz,
    revision          bigint      NOT NULL DEFAULT 1,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (from_profile_id <> to_profile_id),
    CHECK (status <> 'switched' OR (switched_at IS NOT NULL AND old_vectors_until IS NOT NULL))
);
-- One migration at a time per KB, including its grace period.
CREATE UNIQUE INDEX profile_migrations_one_active ON profile_migrations (kb_id) WHERE status IN ('running', 'switched');
CREATE INDEX profile_migrations_kb_idx ON profile_migrations (kb_id, started_at DESC);
CREATE INDEX profile_migrations_active_idx ON profile_migrations (status) WHERE status IN ('running', 'switched');

-- +goose Down
DROP TABLE profile_migrations;
DROP TABLE embedding_set_failures;
DROP TABLE source_embedding_sets;
-- Keep each document's chunks of its source's profile only.
DELETE FROM chunks c USING data_sources s WHERE s.id = c.source_id AND c.profile_id <> s.embedding_profile_id;
CREATE INDEX chunks_source_idx ON chunks (source_id);
DROP INDEX chunks_source_profile_idx;
ALTER TABLE chunks ADD CONSTRAINT chunks_document_ordinal_key UNIQUE (document_id, ordinal);
DROP INDEX chunks_document_profile_ordinal_key;
DROP TRIGGER chunks_default_profile ON chunks;
DROP FUNCTION chunks_default_profile();
ALTER TABLE chunks DROP CONSTRAINT chunks_profile_fkey;
ALTER TABLE chunks DROP COLUMN profile_id;
