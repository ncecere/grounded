-- The connector runtime (ADR-0035, #258 step 2). Expand only: new tables, and two columns on documents that a pod of the
-- previous release ignores. Nothing here is used until a platform admin turns a connector type on.
--
-- source_connectors: one row per connector source, with its encrypted credentials, schedule and saved cursor.
--   The primary key is the source's id, so key rotation (internal/keyrotation) treats credentials_cipher like every
--   other ciphertext column.
-- source_syncs: a connector source's sync runs. At most one is queued or running per source.
-- source_sync_removals: the documents a sync would remove. They are removed when the sync ends, unless they are a large
--   share of the source: then removals is 'pending' until an editor confirms or dismisses them.
-- documents.external_version: the provider's version of the content (an ETag, a revision), so an unchanged item is not
--   downloaded again. documents.last_seen_sync_id: the last sync that listed the document.
-- Adding a column with a constant default does not rewrite the table.

-- +goose Up
CREATE TABLE source_connectors (
    id                  uuid        PRIMARY KEY REFERENCES data_sources (id) ON DELETE CASCADE,
    credentials_cipher  bytea,
    credentials_set_at  timestamptz,
    credentials_set_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    schedule            text        NOT NULL DEFAULT 'manual' CHECK (schedule IN ('manual', 'hourly', 'daily', 'weekly')),
    cursor              jsonb,
    cursor_at           timestamptz,
    last_complete_at    timestamptz
);

CREATE TABLE source_syncs (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id           uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    team_id             uuid        REFERENCES teams (id) ON DELETE CASCADE,
    status              text        NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    trigger             text        NOT NULL CHECK (trigger IN ('create', 'manual', 'schedule')),
    full_listing        boolean     NOT NULL DEFAULT false,
    complete            boolean     NOT NULL DEFAULT false,
    items_added         integer     NOT NULL DEFAULT 0,
    items_changed       integer     NOT NULL DEFAULT 0,
    items_unchanged     integer     NOT NULL DEFAULT 0,
    items_skipped       integer     NOT NULL DEFAULT 0,
    items_removed       integer     NOT NULL DEFAULT 0,
    permissions_changed integer     NOT NULL DEFAULT 0,
    -- '' (none to decide), pending (held for an editor), confirmed, dismissed, or superseded by a later sync.
    removals            text        NOT NULL DEFAULT ''
        CHECK (removals IN ('', 'pending', 'confirmed', 'dismissed', 'superseded')),
    removals_pending    integer     NOT NULL DEFAULT 0,
    removals_reason     text        NOT NULL DEFAULT '',
    stopped_reason      text        NOT NULL DEFAULT '',
    error               text        NOT NULL DEFAULT '',
    -- The first items left out, as [{"id","title","reason"}] (at most 50).
    problems            jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- Where a long sync got to, so a restart of the same sync continues from it. The source's cursor is saved only when
    -- a sync ends, so a failed sync never leaves the next one starting in the middle of a listing.
    checkpoint          jsonb,
    created_by          uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    started_at          timestamptz,
    finished_at         timestamptz
);
CREATE UNIQUE INDEX source_syncs_one_active ON source_syncs (source_id) WHERE status IN ('queued', 'running');
CREATE INDEX source_syncs_source_idx ON source_syncs (source_id, created_at DESC);
CREATE INDEX source_syncs_team_idx ON source_syncs (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX source_syncs_created_by_idx ON source_syncs (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX source_connectors_set_by_idx ON source_connectors (credentials_set_by) WHERE credentials_set_by IS NOT NULL;

CREATE TABLE source_sync_removals (
    sync_id     uuid NOT NULL REFERENCES source_syncs (id) ON DELETE CASCADE,
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    PRIMARY KEY (sync_id, document_id)
);
CREATE INDEX source_sync_removals_document_idx ON source_sync_removals (document_id);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS external_version text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_seen_sync_id uuid;

-- +goose Down
ALTER TABLE documents DROP COLUMN IF EXISTS last_seen_sync_id;
ALTER TABLE documents DROP COLUMN IF EXISTS external_version;
DROP TABLE IF EXISTS source_sync_removals;
DROP TABLE IF EXISTS source_syncs;
DROP TABLE IF EXISTS source_connectors;
