-- Web data sources: crawl allowlist, team domain requests, crawl runs with a
-- durable frontier, and scheduling (ADR-0008, DESIGN.md §5.3).

-- +goose Up
-- Host patterns the platform allows crawling. "*.example.edu" matches
-- example.edu and every subdomain; "*" allows any public host (SSRF protection
-- still applies). Empty on a new install: admins add patterns, or
-- CRAWL_ALLOWLIST_SEED adds them on first start (ADR-0018).
CREATE TABLE crawl_allowlist (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern    text        NOT NULL UNIQUE CHECK (pattern ~ '^(\*|(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)$'),
    note       text        NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    created_by uuid        REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Teams ask for hosts outside the allowlist; approved requests allow that
-- host (pattern) for the requesting team only.
CREATE TABLE crawl_domain_requests (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id      uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    pattern      text        NOT NULL CHECK (pattern ~ '^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
    reason       text        NOT NULL CHECK (length(reason) BETWEEN 10 AND 2000),
    status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'revoked')),
    requested_by uuid        REFERENCES users (id),
    reviewed_by  uuid        REFERENCES users (id),
    review_note  text        NOT NULL DEFAULT '',
    reviewed_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crawl_domain_requests_open_key ON crawl_domain_requests (team_id, pattern)
    WHERE status IN ('pending', 'approved');

-- One sync of a web source.
CREATE TABLE web_crawls (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id         uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    team_id           uuid        REFERENCES teams (id) ON DELETE CASCADE,
    status            text        NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    trigger           text        NOT NULL CHECK (trigger IN ('create', 'manual', 'schedule')),
    config            jsonb       NOT NULL,
    pages_discovered  integer     NOT NULL DEFAULT 0,
    pages_fetched     integer     NOT NULL DEFAULT 0,
    pages_changed     integer     NOT NULL DEFAULT 0,
    pages_unchanged   integer     NOT NULL DEFAULT 0,
    pages_skipped     integer     NOT NULL DEFAULT 0,
    pages_failed      integer     NOT NULL DEFAULT 0,
    documents_deleted integer     NOT NULL DEFAULT 0,
    -- True when the page limit stopped discovery; stale pages are then not deleted.
    truncated         boolean     NOT NULL DEFAULT false,
    error             text        NOT NULL DEFAULT '',
    created_by        uuid        REFERENCES users (id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    finished_at       timestamptz
);
CREATE UNIQUE INDEX web_crawls_one_active ON web_crawls (source_id) WHERE status IN ('queued', 'running');
CREATE INDEX web_crawls_source_idx ON web_crawls (source_id, created_at DESC);

-- URLs a crawl has discovered. Durable, so a crawl resumes after a restart.
CREATE TABLE web_frontier (
    crawl_id    uuid        NOT NULL REFERENCES web_crawls (id) ON DELETE CASCADE,
    url         text        NOT NULL,
    depth       integer     NOT NULL,
    status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped', 'failed')),
    reason      text        NOT NULL DEFAULT '',
    http_status integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (crawl_id, url)
);
CREATE INDEX web_frontier_pending_idx ON web_frontier (crawl_id, depth, created_at) WHERE status = 'pending';

-- Web documents: conditional fetches and stale-page detection.
ALTER TABLE documents ADD COLUMN http_etag text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN http_last_modified text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN last_seen_crawl_id uuid;

-- Scheduled re-syncs.
ALTER TABLE data_sources ADD COLUMN next_sync_at timestamptz;
CREATE INDEX data_sources_next_sync_idx ON data_sources (next_sync_at) WHERE next_sync_at IS NOT NULL;

-- Platform-shared sources (team_id NULL) have unique names among themselves;
-- data_sources_team_name_key treats NULL team IDs as distinct.
CREATE UNIQUE INDEX data_sources_platform_name_key ON data_sources (lower(name)) WHERE team_id IS NULL;

-- +goose Down
DROP INDEX data_sources_platform_name_key;
DROP INDEX data_sources_next_sync_idx;
ALTER TABLE data_sources DROP COLUMN next_sync_at;
ALTER TABLE documents DROP COLUMN last_seen_crawl_id;
ALTER TABLE documents DROP COLUMN http_last_modified;
ALTER TABLE documents DROP COLUMN http_etag;
DROP TABLE web_frontier;
DROP TABLE web_crawls;
DROP TABLE crawl_domain_requests;
DROP TABLE crawl_allowlist;
