-- Data sources, documents, chunks, knowledge bases, API keys and the usage
-- ledger (ADR-0003, ADR-0004, ADR-0008, ADR-0012).
--
-- Vector tables are not created here: internal/vectorstore creates one table
-- per embedding profile (emb_<profile id>) because each has a fixed dimension.
--
-- pgvector is not a "trusted" extension: in production a superuser (or the
-- Postgres operator's bootstrap SQL) may need to run CREATE EXTENSION vector
-- before this migration.

-- +goose Up
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE TABLE data_sources (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL for platform-shared sources (Phase 2).
    team_id              uuid        REFERENCES teams (id) ON DELETE CASCADE,
    name                 text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    description          text        NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    -- Fixed at creation (ADR-0008).
    type                 text        NOT NULL CHECK (type IN ('upload', 'web')),
    config               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    classification       text        NOT NULL REFERENCES classification_levels (key) ON UPDATE RESTRICT ON DELETE RESTRICT,
    -- Fixed at creation; changing it is a profile migration (ADR-0007).
    embedding_profile_id uuid        NOT NULL REFERENCES embedding_profiles (id) ON DELETE RESTRICT,
    status               text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    revision             bigint      NOT NULL DEFAULT 1,
    created_by           uuid        REFERENCES users (id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    last_sync_at         timestamptz
);
CREATE UNIQUE INDEX data_sources_team_name_key ON data_sources (team_id, lower(name));
CREATE INDEX data_sources_profile_idx ON data_sources (embedding_profile_id);

CREATE TABLE documents (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id     uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    -- Copied from the source so the ingestion dispatcher can share capacity
    -- fairly between teams without a join. NULL for platform-shared sources.
    team_id       uuid        REFERENCES teams (id) ON DELETE CASCADE,
    -- Identity within the source: the file name for uploads, the URL for web pages.
    external_id   text        NOT NULL CHECK (length(external_id) BETWEEN 1 AND 2048),
    title         text        NOT NULL DEFAULT '',
    filename      text        NOT NULL DEFAULT '',
    url           text        NOT NULL DEFAULT '',
    kind          text        NOT NULL DEFAULT '',
    content_type  text        NOT NULL DEFAULT '',
    size_bytes    bigint      NOT NULL DEFAULT 0,
    sha256        text        NOT NULL DEFAULT '',
    version       integer     NOT NULL DEFAULT 1,
    blob_key      text        NOT NULL DEFAULT '',
    status        text        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'processing', 'ready', 'failed', 'skipped')),
    error_code    text        NOT NULL DEFAULT '',
    error_message text        NOT NULL DEFAULT '',
    parser        text        NOT NULL DEFAULT '',
    pages         integer     NOT NULL DEFAULT 0,
    warnings      jsonb       NOT NULL DEFAULT '[]'::jsonb,
    chunk_count   integer     NOT NULL DEFAULT 0,
    token_count   integer     NOT NULL DEFAULT 0,
    metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    tags          text[]      NOT NULL DEFAULT '{}',
    -- Reserved for per-document permissions from future connectors (ADR-0008).
    acl           jsonb,
    attempts      integer     NOT NULL DEFAULT 0,
    uploaded_by   uuid        REFERENCES users (id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    processed_at  timestamptz,
    CONSTRAINT documents_source_external_key UNIQUE (source_id, external_id)
);
CREATE INDEX documents_source_status_idx ON documents (source_id, status);
CREATE INDEX documents_source_created_idx ON documents (source_id, created_at DESC, id DESC);
CREATE INDEX documents_source_sha_idx ON documents (source_id, sha256);
-- Dispatcher: pending work per team, oldest first; and in-flight counts.
CREATE INDEX documents_pending_idx ON documents (team_id, updated_at, id) WHERE status = 'pending';
CREATE INDEX documents_inflight_idx ON documents (team_id) WHERE status IN ('queued', 'processing');

CREATE TABLE chunks (
    id           uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  uuid     NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    source_id    uuid     NOT NULL,
    ordinal      integer  NOT NULL,
    content      text     NOT NULL,
    heading_path text[]   NOT NULL DEFAULT '{}',
    page_start   integer  NOT NULL DEFAULT 0,
    page_end     integer  NOT NULL DEFAULT 0,
    token_count  integer  NOT NULL,
    -- Set by the application: to_tsvector('english', headings || content).
    content_tsv  tsvector NOT NULL,
    CONSTRAINT chunks_document_ordinal_key UNIQUE (document_id, ordinal)
);
-- Lexical search is always scoped to a KB's sources.
CREATE INDEX chunks_source_tsv_idx ON chunks USING gin (source_id, content_tsv);
CREATE INDEX chunks_source_idx ON chunks (source_id);

CREATE TABLE knowledge_bases (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id              uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    name                 text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    description          text        NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    -- All sources in a KB share this profile (ADR-0007).
    embedding_profile_id uuid        NOT NULL REFERENCES embedding_profiles (id) ON DELETE RESTRICT,
    top_k                integer     NOT NULL DEFAULT 8 CHECK (top_k BETWEEN 1 AND 50),
    revision             bigint      NOT NULL DEFAULT 1,
    created_by           uuid        REFERENCES users (id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX knowledge_bases_team_name_key ON knowledge_bases (team_id, lower(name));

CREATE TABLE kb_sources (
    kb_id      uuid        NOT NULL REFERENCES knowledge_bases (id) ON DELETE CASCADE,
    source_id  uuid        NOT NULL REFERENCES data_sources (id) ON DELETE RESTRICT,
    added_by   uuid        REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kb_id, source_id)
);
CREATE INDEX kb_sources_source_idx ON kb_sources (source_id);

CREATE TABLE api_keys (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id       uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    kind          text        NOT NULL CHECK (kind IN ('personal', 'service')),
    -- Personal: the owner. Service: the responsible contact.
    user_id       uuid        REFERENCES users (id) ON DELETE SET NULL,
    name          text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    -- Public identifier embedded in the key, used for lookup (e.g. "rag_7Kq2...").
    prefix        text        NOT NULL UNIQUE,
    -- HMAC-SHA256(API_KEY_PEPPER, secret). The secret itself is never stored.
    secret_hash   bytea       NOT NULL,
    scopes        text[]      NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['query', 'ingest', 'manage']::text[]),
    -- NULL = every KB of the team.
    kb_ids        uuid[],
    expires_at    timestamptz,
    last_used_at  timestamptz,
    revoked_at    timestamptz,
    created_by    uuid        REFERENCES users (id),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_team_idx ON api_keys (team_id);
CREATE INDEX api_keys_user_idx ON api_keys (user_id) WHERE kind = 'personal';

-- Append-only usage ledger. No foreign keys: usage outlives what it refers to.
CREATE TABLE usage_events (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    kind        text        NOT NULL,
    quantity    bigint      NOT NULL,
    team_id     uuid,
    user_id     uuid,
    api_key_id  uuid,
    source_id   uuid,
    kb_id       uuid,
    document_id uuid,
    model_id    uuid,
    metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX usage_events_team_time_idx ON usage_events (team_id, occurred_at);

-- +goose Down
DROP TABLE usage_events;
DROP TABLE api_keys;
DROP TABLE kb_sources;
DROP TABLE knowledge_bases;
DROP TABLE chunks;
DROP TABLE documents;
DROP TABLE data_sources;
