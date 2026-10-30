-- The content health report (roadmap B8, #22; docs/content-health.md, ADR-0027).
--
-- A team's editors ask for a report; a background job on its own queue reads the team's own documents,
-- sources, the latest completed crawl's record and the content-free answer events, and stores a bounded
-- snapshot of IDs, enums, counts and times. Titles and file names are not copied: they are read live when a
-- page of findings is read, so a removed or renamed document cannot leak through an old report. Findings
-- reference documents and sources ON DELETE CASCADE, so deleting either removes its findings at once.
--
-- Expand only (ADR-0013): this migration only CREATES tables. It alters no existing table and rewrites no
-- row; the previous release neither reads nor writes them and its workers do not take the new queue. The
-- feature is off until a platform admin turns it on.

-- +goose Up
CREATE TABLE content_health_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    -- Off by default: opt-in (docs/content-health.md).
    enabled    boolean     NOT NULL DEFAULT false,
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO content_health_settings DEFAULT VALUES;

CREATE TABLE content_health_reports (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id              uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    -- The scope: all of the team's own sources (both NULL), one source, or one knowledge base's sources.
    -- Deleting the source or the knowledge base deletes the report about it.
    scope_source_id      uuid        REFERENCES data_sources (id) ON DELETE CASCADE,
    scope_kb_id          uuid        REFERENCES knowledge_bases (id) ON DELETE CASCADE,
    stale_days           integer     NOT NULL CHECK (stale_days BETWEEN 30 AND 3650),
    citation_window_days integer     NOT NULL CHECK (citation_window_days BETWEEN 14 AND 365),
    status               text        NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    -- The instant every age and window is measured from: set when the job starts.
    as_of                timestamptz,
    -- Never shown: who asked is in the audit log, not in the report.
    requested_by         uuid        REFERENCES users (id) ON DELETE SET NULL,
    -- One result per signal: {signal, state, reason, found, truncated, counts, observedSince}. Numbers and
    -- enums only, never a name, a URL or a message.
    signals              jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- A coarse code ('', 'internal', 'timed_out', 'too_many_sources', 'disabled'), never an error message.
    error_code           text        NOT NULL DEFAULT '' CHECK (char_length(error_code) <= 64),
    created_at           timestamptz NOT NULL DEFAULT now(),
    started_at           timestamptz,
    finished_at          timestamptz,
    -- When the report is deleted: 30 days after it ended.
    expires_at           timestamptz,
    CONSTRAINT content_health_reports_one_scope CHECK (scope_source_id IS NULL OR scope_kb_id IS NULL)
);
-- One report in progress per team.
CREATE UNIQUE INDEX content_health_reports_active_key ON content_health_reports (team_id) WHERE status IN ('queued', 'running');
CREATE INDEX content_health_reports_team_idx ON content_health_reports (team_id, created_at DESC);
CREATE INDEX content_health_reports_scope_source_idx ON content_health_reports (scope_source_id) WHERE scope_source_id IS NOT NULL;
CREATE INDEX content_health_reports_scope_kb_idx ON content_health_reports (scope_kb_id) WHERE scope_kb_id IS NOT NULL;

-- When a team last asked for a report: the pause between two reports must survive a report being deleted.
CREATE TABLE content_health_pacing (
    team_id uuid        PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
    last_at timestamptz NOT NULL
);

-- What the report knew about each source in its scope.
CREATE TABLE content_health_sources (
    report_id        uuid        NOT NULL REFERENCES content_health_reports (id) ON DELETE CASCADE,
    source_id        uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    source_type      text        NOT NULL CHECK (char_length(source_type) <= 32),
    documents        integer     NOT NULL,
    ready            integer     NOT NULL,
    -- Ready documents with no processing date or no hash: counted, never judged.
    ready_no_date    integer     NOT NULL,
    ready_no_hash    integer     NOT NULL,
    -- Whether the source's links were observed: 'observed', 'unknown' or 'not_applicable' (an upload source).
    link_state       text        NOT NULL CHECK (link_state IN ('observed', 'unknown', 'not_applicable')),
    -- Why unknown: 'never_crawled', 'page_refetch_latest' or 'no_crawl_record'.
    link_reason      text        NOT NULL DEFAULT '' CHECK (char_length(link_reason) <= 32),
    link_crawl_at    timestamptz,
    link_truncated   boolean     NOT NULL DEFAULT false,
    link_failed      integer     NOT NULL DEFAULT 0,
    -- The crawl whose record was read (no foreign key: a pruned crawl must not delete coverage). A read compares it with the
    -- source's latest completed crawl, and hides the report's URLs once a newer one exists.
    link_crawl_id    uuid,
    -- The source's revision and classification when the report collected it: a read hides this source's URLs once either
    -- changed (a retargeted or reclassified source is not the one the crawl observed).
    source_revision        bigint NOT NULL DEFAULT 0,
    source_classification  text   NOT NULL DEFAULT '' CHECK (char_length(source_classification) <= 64),
    -- Not cited: whether this source's documents could be judged ('judged'), and why not: 'not_served' (no active published agent
    -- reaches it through a knowledge base), 'too_few_answers' (fewer than the minimum of such agents' kept answers since it was
    -- reachable), or '' (the signal did not measure it). exposed_since is when it was reachable (the later of its attachment
    -- to the knowledge base and the agent's publish time, rounded up to the next UTC day), never an invented time.
    cite_state       text        NOT NULL DEFAULT '' CHECK (cite_state IN ('', 'judged', 'not_served', 'too_few_answers')),
    exposed_since    timestamptz,
    exposure_answers integer     NOT NULL DEFAULT 0,
    PRIMARY KEY (report_id, source_id)
);
CREATE INDEX content_health_sources_source_idx ON content_health_sources (source_id);

-- One finding. IDs, enums, counts and times, and the URL a link failure is about.
CREATE TABLE content_health_findings (
    report_id   uuid        NOT NULL REFERENCES content_health_reports (id) ON DELETE CASCADE,
    -- A free-text name, not a CHECK: a later signal registers without a migration (docs/content-health.md).
    signal      text        NOT NULL CHECK (char_length(signal) BETWEEN 1 AND 32),
    ord         integer     NOT NULL,
    -- The report's team again, so a read can never join across teams.
    team_id     uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    source_id   uuid        NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    document_id uuid        REFERENCES documents (id) ON DELETE CASCADE,
    -- The failed URL of a broken link, without credentials, query or fragment (its path may still be sensitive); '' for every other signal.
    ref         text        NOT NULL DEFAULT '' CHECK (char_length(ref) <= 2048),
    -- Duplicates: which group (from 1), and how many documents it truly had when the report was made; 0 for every other signal.
    group_no    integer     NOT NULL DEFAULT 0,
    group_size  integer     NOT NULL DEFAULT 0,
    -- An enum: a link's failure kind, a failure's reason class, ...
    code        text        NOT NULL DEFAULT '' CHECK (char_length(code) <= 64),
    -- The raw error code of a failed document, or the HTTP status of a failed link.
    detail      text        NOT NULL DEFAULT '' CHECK (char_length(detail) <= 64),
    -- A number: age in days, the HTTP status of a link (0: a network error), the kept answers that could have cited a document
    -- of its source (not cited); 0 otherwise.
    value       bigint      NOT NULL DEFAULT 0,
    -- When the fact was true: the last processing, the crawl's end, the failure's time. NULL when unknown.
    observed_at timestamptz,
    -- Web pages: when a crawl last confirmed the page exists, when a crawl record is kept.
    confirmed_at timestamptz,
    PRIMARY KEY (report_id, signal, ord)
);
-- Deleting a document or a source (a crawl does it in bulk) finds its findings by these.
CREATE INDEX content_health_findings_document_idx ON content_health_findings (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX content_health_findings_source_idx ON content_health_findings (source_id);
CREATE INDEX content_health_findings_team_idx ON content_health_findings (team_id);

-- +goose Down
DROP TABLE content_health_findings;
DROP TABLE content_health_sources;
DROP TABLE content_health_reports;
DROP TABLE content_health_pacing;
DROP TABLE content_health_settings;
