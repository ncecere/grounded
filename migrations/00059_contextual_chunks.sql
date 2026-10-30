-- Contextual chunks (A4, #21; docs/contextual-chunks.md, ADR-0028): a model writes a short description of a document's section, and it is put
-- in front of each passage in the text sent to the embedding model. The description is embedding input only: nothing here touches chunks.
--
--   * embedding_profiles.contextual: a profile whose sets are built with context for the sources that opted in (a candidate of an index
--     preview with contextualChunks; kept when it is switched). false for every existing profile.
--   * source_contextual: a source's opt-in and settings. No row = off. Saving it changes no vector.
--   * set_contextual: the settings a source was snapshotted with for a profile when its set was started (model, failure policy, prompt
--     version), so a later change to the source's settings cannot change what a half-built set means. Caps are read live.
--   * contextual_cache: the generated text, one row per section of a document, keyed by a hash of the exact bounded inputs, the model, the
--     prompt version and the limits. Deleted with the document.
--   * contextual_calls: one row per model attempt (counts, tokens when reported, outcome; never text). Counts against the caps.
--   * document_contextual: how a document was embedded for a profile (with context, or without and why), so a mixed index is visible.
--
-- Expand only (ADR-0013): new tables and one defaulted column. Code of the previous release ignores them and, with nothing written here,
-- behaves as before. No existing table is rewritten.

-- +goose Up
ALTER TABLE embedding_profiles ADD COLUMN contextual boolean NOT NULL DEFAULT false;

CREATE TABLE source_contextual (
    source_id         uuid        PRIMARY KEY REFERENCES data_sources (id) ON DELETE CASCADE,
    enabled           boolean     NOT NULL DEFAULT false,
    -- A chat model; a model in use cannot be deleted.
    model_id          uuid        REFERENCES models (id) ON DELETE RESTRICT,
    -- fail: a document whose context cannot be made is not embedded for the set; plain: it is embedded as it is, and marked.
    failure_policy    text        NOT NULL DEFAULT 'fail' CHECK (failure_policy IN ('fail', 'plain')),
    -- The most model calls (attempts) one build of a set may make, and the most per UTC day for documents processed after the build.
    max_calls         integer     NOT NULL DEFAULT 200 CHECK (max_calls BETWEEN 1 AND 100000),
    max_calls_per_day integer     NOT NULL DEFAULT 200 CHECK (max_calls_per_day BETWEEN 1 AND 100000),
    -- Explicit additional admission caps; absent while disabled, never an implicit spend approval.
    max_tokens         bigint CHECK (max_tokens BETWEEN 1 AND 1000000000),
    max_tokens_per_day bigint CHECK (max_tokens_per_day BETWEEN 1 AND 1000000000),
    max_amount         numeric(20,6) CHECK (max_amount > 0 AND max_amount <> 'NaN'::numeric),
    max_amount_per_day numeric(20,6) CHECK (max_amount_per_day > 0 AND max_amount_per_day <> 'NaN'::numeric),
    currency           text CHECK (currency ~ '^[A-Z]{3}$'),
    revision          bigint      NOT NULL DEFAULT 1,
    updated_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_contextual_model_needed CHECK (NOT enabled OR model_id IS NOT NULL),
    CONSTRAINT source_contextual_admission_needed CHECK (NOT enabled OR
        (max_tokens IS NOT NULL AND max_tokens_per_day IS NOT NULL AND max_amount IS NOT NULL AND max_amount_per_day IS NOT NULL AND currency IS NOT NULL))
);

CREATE TABLE set_contextual (
    source_id      uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    profile_id     uuid        NOT NULL REFERENCES embedding_profiles (id) ON DELETE CASCADE,
    model_id       uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
    failure_policy text        NOT NULL CHECK (failure_policy IN ('fail', 'plain')),
    prompt_version smallint    NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_id, profile_id)
);
CREATE INDEX set_contextual_profile_idx ON set_contextual (profile_id);

CREATE TABLE contextual_cache (
    document_id uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    key         bytea       NOT NULL CHECK (octet_length(key) = 32),
    source_id   uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    context     text        NOT NULL CHECK (char_length(context) BETWEEN 1 AND 1000),
    tokens_in   integer,
    tokens_out  integer,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, key)
);
CREATE INDEX contextual_cache_source_idx ON contextual_cache (source_id);

CREATE TABLE contextual_calls (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id   uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    -- Historical identity, not a cascading FK: discarding an index cannot restore daily headroom.
    profile_id  uuid        NOT NULL,
    -- Survives the document's deletion: the attempt happened.
    document_id uuid        REFERENCES documents (id) ON DELETE SET NULL,
    model_id    uuid        NOT NULL,
    -- build: the set was being built; live: a document processed after it.
    phase       text        NOT NULL CHECK (phase IN ('build', 'live')),
    -- started: sent, not settled (a crash leaves it: an attempt of unknown cost); ok; refused / invalid: the reply could not be used;
    -- error: the call failed; timeout: no answer in time (the provider may still have billed it); cancelled: stopped in flight.
    outcome     text        NOT NULL DEFAULT 'started' CHECK (outcome IN ('started', 'ok', 'refused', 'invalid', 'error', 'timeout', 'cancelled')),
    -- What the provider reported; NULL = unknown.
    tokens_in   integer,
    tokens_out  integer,
    -- One database-derived admission instant/bucket, independent of client clocks or later gateway delivery.
    admission_day date NOT NULL,
    reserved_tokens bigint NOT NULL CHECK (reserved_tokens > 0),
    reserved_amount numeric(20,6) NOT NULL CHECK (reserved_amount >= 0 AND reserved_amount <> 'NaN'::numeric),
    charged_tokens bigint NOT NULL CHECK (charged_tokens >= 0),
    charged_amount numeric(20,6) NOT NULL CHECK (charged_amount >= 0 AND charged_amount <> 'NaN'::numeric),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    input_price numeric(20,6) NOT NULL CHECK (input_price >= 0 AND input_price <> 'NaN'::numeric),
    output_price numeric(20,6) NOT NULL CHECK (output_price >= 0 AND output_price <> 'NaN'::numeric),
    created_at  timestamptz NOT NULL,
    finished_at timestamptz
);
CREATE INDEX contextual_calls_source_time_idx ON contextual_calls (source_id, created_at);
CREATE INDEX contextual_calls_set_idx ON contextual_calls (source_id, profile_id, phase);
CREATE INDEX contextual_calls_day_idx ON contextual_calls (source_id, admission_day);

CREATE TABLE document_contextual (
    document_id uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    profile_id  uuid        NOT NULL REFERENCES embedding_profiles (id) ON DELETE CASCADE,
    source_id   uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    -- The document version the mark describes.
    version     integer     NOT NULL,
    -- context: embedded with context; fallback: without it under the plain policy; too_large: more sections than the limit;
    -- off: the source was switched off (or the platform switch); no_room: every passage was too long to add context to.
    state       text        NOT NULL CHECK (state IN ('context', 'fallback', 'too_large', 'off', 'no_room')),
    code        text        NOT NULL DEFAULT '',
    passages    integer     NOT NULL DEFAULT 0,
    -- Passages that got a context (a passage with no room for one is embedded as it is).
    contextual  integer     NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, profile_id)
);
CREATE INDEX document_contextual_set_idx ON document_contextual (source_id, profile_id, state);

-- +goose Down
DROP TABLE document_contextual;
DROP TABLE contextual_calls;
DROP TABLE contextual_cache;
DROP TABLE set_contextual;
DROP TABLE source_contextual;
ALTER TABLE embedding_profiles DROP COLUMN contextual;
