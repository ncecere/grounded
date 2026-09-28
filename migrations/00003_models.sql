-- Model connections (OpenAI-compatible proxies), models and embedding
-- profiles (ADR-0005, ADR-0007).

-- +goose Up
CREATE TABLE model_connections (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text        NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100),
    description         text        NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    -- OpenAI-compatible base URL including the version prefix, e.g. https://proxy/v1
    base_url            text        NOT NULL CHECK (base_url ~ '^https?://'),
    -- AES-256-GCM ciphertext (internal/secrets); NULL when the proxy needs no key.
    api_key_ciphertext  bytea,
    api_key_hint        text        NOT NULL DEFAULT '', -- last 4 characters, for display
    timeout_seconds     integer     NOT NULL DEFAULT 60 CHECK (timeout_seconds BETWEEN 1 AND 600),
    enabled             boolean     NOT NULL DEFAULT true,
    revision            bigint      NOT NULL DEFAULT 1,
    created_by          uuid        REFERENCES users (id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE models (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id      uuid        NOT NULL REFERENCES model_connections (id) ON DELETE RESTRICT,
    -- Stable platform name used in configuration and the API, e.g. "nomic-embed".
    key                text        NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9][a-z0-9._-]{0,62}$'),
    -- Model ID sent to the proxy, e.g. "nomic-embed-text-v1.5".
    upstream_model     text        NOT NULL CHECK (length(upstream_model) BETWEEN 1 AND 200),
    display_name       text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
    description        text        NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    kind               text        NOT NULL CHECK (kind IN ('chat', 'embedding', 'rerank', 'moderation')),
    -- Highest classification this model may process (ADR-0006 rule 4).
    max_classification text        NOT NULL REFERENCES classification_levels (key) ON UPDATE RESTRICT ON DELETE RESTRICT,
    enabled            boolean     NOT NULL DEFAULT true,
    -- Chat capabilities.
    context_window     integer     CHECK (context_window > 0),
    max_output_tokens  integer     CHECK (max_output_tokens > 0),
    supports_tools     boolean     NOT NULL DEFAULT false,
    supports_vision    boolean     NOT NULL DEFAULT false,
    -- Embedding capabilities.
    dimensions         integer     CHECK (dimensions BETWEEN 1 AND 16000),
    max_input_tokens   integer     CHECK (max_input_tokens > 0),
    -- OpenAI-compatibility flags for proxy quirks (ADR-0017).
    compat             jsonb       NOT NULL DEFAULT '{}'::jsonb,
    revision           bigint      NOT NULL DEFAULT 1,
    created_by         uuid        REFERENCES users (id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT models_connection_upstream_kind_key UNIQUE (connection_id, upstream_model, kind),
    CONSTRAINT models_embedding_dimensions CHECK (kind <> 'embedding' OR dimensions IS NOT NULL)
);
CREATE INDEX models_connection_idx ON models (connection_id);

CREATE TABLE embedding_profiles (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    key             text        NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9][a-z0-9._-]{0,62}$'),
    name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    description     text        NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    -- Immutable after creation: changing any of these means a new profile.
    model_id        uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
    dimensions      integer     NOT NULL,
    storage_type    text        NOT NULL CHECK (storage_type IN ('halfvec', 'vector')),
    document_prefix text        NOT NULL DEFAULT '' CHECK (length(document_prefix) <= 200),
    query_prefix    text        NOT NULL DEFAULT '' CHECK (length(query_prefix) <= 200),
    chunk_size      integer     NOT NULL CHECK (chunk_size BETWEEN 64 AND 8192),
    chunk_overlap   integer     NOT NULL CHECK (chunk_overlap >= 0),
    chunker_version integer     NOT NULL DEFAULT 1,
    -- Mutable.
    status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    is_default      boolean     NOT NULL DEFAULT false,
    revision        bigint      NOT NULL DEFAULT 1,
    created_by      uuid        REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- pgvector HNSW index limits.
    CONSTRAINT embedding_profiles_dimensions CHECK (
        (storage_type = 'halfvec' AND dimensions BETWEEN 1 AND 4000) OR
        (storage_type = 'vector' AND dimensions BETWEEN 1 AND 2000)),
    CONSTRAINT embedding_profiles_overlap CHECK (chunk_overlap < chunk_size),
    CONSTRAINT embedding_profiles_default_active CHECK (NOT is_default OR status = 'active')
);
CREATE UNIQUE INDEX embedding_profiles_one_default ON embedding_profiles (is_default) WHERE is_default;

-- +goose Down
DROP TABLE embedding_profiles;
DROP TABLE models;
DROP TABLE model_connections;
