-- The answer cache (docs/v0.4.0.md §1, roadmap A8, docs/answer-cache.md): a
-- question answered recently under the same conditions gets the stored
-- answer again instead of the whole pipeline.
--
--   * knowledge_bases.content_revision: raised whenever what a search of
--     the knowledge base can find changes. Triggers raise it, so every path
--     (ingestion, re-crawls, uploads, deletions, tags, profile migrations
--     and switches, attaching and detaching sources) is covered, the
--     previous release's included:
--       - a document finishing (re)processing, deleted, or changing its
--         title, URL, tags or chunk counts: a deferred trigger at commit,
--         once per source and transaction (so a bulk change raises each
--         knowledge base once, and the row lock is held only while the
--         transaction commits);
--       - a source attached or detached, a source or knowledge base moving
--         to another embedding profile: at once.
--     A re-chunk (boilerplate) raises it from the code (internal/ingest).
--   * answer_cache: the stored answers, keyed by the agent, a hash of the
--     key's conditions (published version, audience, the knowledge bases'
--     revisions, the settings revision, and the day for questions about
--     relative dates) and the normalised question's hash. The question's
--     embedding (near-identical matching) is in the agent's embedding
--     profile. Retention deletes expired entries and entries past the
--     transcript retention of the agent's classification (internal/retention,
--     kind answer_cache); legal holds on the team or agent keep them (they
--     are never served once expired).
--   * agent_answer_cache: an agent's cache settings (no row: the defaults,
--     on for public agents). Not versioned: a change applies at once.
--   * answer_cache_settings: the platform switch (on by default).
--   * message_events.cached / cache_entry_id / tokens_saved: an answer
--     served from the cache, the entry it came from (a thumbs-down removes
--     it) and the original's model tokens (analytics: tokens saved).
--
-- Expand only (ADR-0013): new tables, new columns with defaults, triggers
-- that only write the new column.

-- +goose Up
ALTER TABLE knowledge_bases ADD COLUMN content_revision bigint NOT NULL DEFAULT 1;

-- +goose StatementBegin
CREATE FUNCTION raise_kb_content_revision(src uuid) RETURNS void LANGUAGE sql AS $$
    WITH k AS (
        SELECT kb.id FROM knowledge_bases kb JOIN kb_sources ks ON ks.kb_id = kb.id
        WHERE ks.source_id = src ORDER BY kb.id FOR UPDATE OF kb
    )
    UPDATE knowledge_bases SET content_revision = content_revision + 1 FROM k WHERE knowledge_bases.id = k.id;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION documents_content_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    src  uuid;
    done text := coalesce(current_setting('grounded.content_raised', true), '');
BEGIN
    IF TG_OP = 'DELETE' THEN
        src := OLD.source_id;
    ELSE
        src := NEW.source_id;
    END IF;
    IF position(src::text IN done) > 0 THEN
        RETURN NULL;
    END IF;
    PERFORM set_config('grounded.content_raised', done || src::text || ',', true);
    PERFORM raise_kb_content_revision(src);
    RETURN NULL;
END $$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER documents_content_update AFTER UPDATE ON documents
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (OLD.processed_at IS DISTINCT FROM NEW.processed_at OR OLD.tags IS DISTINCT FROM NEW.tags
          OR OLD.title IS DISTINCT FROM NEW.title OR OLD.url IS DISTINCT FROM NEW.url
          OR OLD.chunk_count IS DISTINCT FROM NEW.chunk_count OR OLD.token_count IS DISTINCT FROM NEW.token_count)
    EXECUTE FUNCTION documents_content_changed();

CREATE CONSTRAINT TRIGGER documents_content_delete AFTER DELETE ON documents
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION documents_content_changed();

-- +goose StatementBegin
CREATE FUNCTION kb_sources_content_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE knowledge_bases SET content_revision = content_revision + 1 WHERE id = OLD.kb_id;
    ELSE
        UPDATE knowledge_bases SET content_revision = content_revision + 1 WHERE id = NEW.kb_id;
    END IF;
    RETURN NULL;
END $$;
-- +goose StatementEnd

CREATE TRIGGER kb_sources_content AFTER INSERT OR DELETE ON kb_sources
    FOR EACH ROW EXECUTE FUNCTION kb_sources_content_changed();

-- +goose StatementBegin
CREATE FUNCTION data_sources_profile_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM raise_kb_content_revision(NEW.id);
    RETURN NULL;
END $$;
-- +goose StatementEnd

CREATE TRIGGER data_sources_profile_content AFTER UPDATE OF embedding_profile_id ON data_sources
    FOR EACH ROW WHEN (OLD.embedding_profile_id IS DISTINCT FROM NEW.embedding_profile_id)
    EXECUTE FUNCTION data_sources_profile_changed();

-- +goose StatementBegin
CREATE FUNCTION knowledge_bases_profile_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.content_revision := OLD.content_revision + 1;
    RETURN NEW;
END $$;
-- +goose StatementEnd

CREATE TRIGGER knowledge_bases_profile_content BEFORE UPDATE OF embedding_profile_id ON knowledge_bases
    FOR EACH ROW WHEN (OLD.embedding_profile_id IS DISTINCT FROM NEW.embedding_profile_id)
    EXECUTE FUNCTION knowledge_bases_profile_changed();

CREATE TABLE answer_cache_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled    boolean     NOT NULL DEFAULT true,
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO answer_cache_settings DEFAULT VALUES;

CREATE TABLE agent_answer_cache (
    agent_id       uuid        PRIMARY KEY REFERENCES agents (id) ON DELETE CASCADE,
    -- NULL: the default (on for agents published to the public).
    enabled        boolean,
    near_identical boolean     NOT NULL DEFAULT false,
    expiry_hours   integer     NOT NULL DEFAULT 24 CHECK (expiry_hours BETWEEN 1 AND 720),
    revision       bigint      NOT NULL DEFAULT 1,
    updated_by     uuid        REFERENCES users (id),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE answer_cache (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id           uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    agent_id          uuid        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    agent_version_id  uuid        NOT NULL REFERENCES agent_versions (id) ON DELETE CASCADE,
    -- team, all_authenticated or public: the audience it was answered for.
    audience          text        NOT NULL,
    -- A hash of the key's conditions other than the question.
    conditions        text        NOT NULL,
    -- The knowledge bases' revisions and the settings revision of the key
    -- (for reading; the hash is what matches).
    kb_revisions      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    settings_revision text        NOT NULL DEFAULT '',
    -- The normalised question and its hash.
    question          text        NOT NULL CHECK (char_length(question) BETWEEN 1 AND 8000),
    question_hash     text        NOT NULL,
    profile_id        uuid        REFERENCES embedding_profiles (id) ON DELETE SET NULL,
    embedding         vector,
    -- {text, citations, claims, uncited, sources, retrieval, citationCheck}.
    answer            jsonb       NOT NULL,
    -- The original answer's model tokens (each hit saves them).
    tokens            integer     NOT NULL DEFAULT 0,
    -- The live answer it was stored from (NULL for stateless callers).
    source_message_id uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL,
    hits              integer     NOT NULL DEFAULT 0,
    last_hit_at       timestamptz,
    CONSTRAINT answer_cache_key UNIQUE (agent_id, conditions, question_hash)
);
CREATE INDEX answer_cache_expires_idx ON answer_cache (expires_at);
CREATE INDEX answer_cache_message_idx ON answer_cache (source_message_id) WHERE source_message_id IS NOT NULL;

ALTER TABLE message_events
    ADD COLUMN cached         boolean NOT NULL DEFAULT false,
    ADD COLUMN cache_entry_id uuid,
    ADD COLUMN tokens_saved   integer NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE message_events DROP COLUMN tokens_saved, DROP COLUMN cache_entry_id, DROP COLUMN cached;
DROP TABLE answer_cache;
DROP TABLE agent_answer_cache;
DROP TABLE answer_cache_settings;
DROP TRIGGER knowledge_bases_profile_content ON knowledge_bases;
DROP FUNCTION knowledge_bases_profile_changed();
DROP TRIGGER data_sources_profile_content ON data_sources;
DROP FUNCTION data_sources_profile_changed();
DROP TRIGGER kb_sources_content ON kb_sources;
DROP FUNCTION kb_sources_content_changed();
DROP TRIGGER documents_content_delete ON documents;
DROP TRIGGER documents_content_update ON documents;
DROP FUNCTION documents_content_changed();
DROP FUNCTION raise_kb_content_revision(uuid);
ALTER TABLE knowledge_bases DROP COLUMN content_revision;
