-- Repeated-boilerplate suppression at ingest (DESIGN.md §5.5, ADR-0021).
--   * source_boilerplate: a source's settings (NULL = the platform default
--     for its type) and the state of its classification.
--   * source_boilerplate_blocks: the blocks classified as boilerplate, with
--     how many documents contain each and the one document that keeps it.
--   * document_blocks: each processed document's block hashes, the hashes
--     left out of its chunks, and the classification revision applied.
-- Additive: older code ignores the tables.

-- +goose Up
CREATE TABLE source_boilerplate (
    source_id    uuid             PRIMARY KEY REFERENCES data_sources (id) ON DELETE CASCADE,
    enabled      boolean,
    min_docs     integer          CHECK (min_docs BETWEEN 2 AND 100000),
    ratio        double precision CHECK (ratio BETWEEN 0.05 AND 1),
    -- Bumped whenever the classified set changes; documents chunked under an
    -- older revision are re-checked by the boilerplate.refresh job.
    rev          integer          NOT NULL DEFAULT 0,
    -- A refresh is due while requested_at is later than refreshed_at.
    requested_at timestamptz,
    refreshed_at timestamptz,
    documents    integer          NOT NULL DEFAULT 0, -- documents counted at the last refresh
    threshold    integer          NOT NULL DEFAULT 0  -- documents a block needed then
);
CREATE INDEX source_boilerplate_requested_idx ON source_boilerplate (requested_at)
    WHERE requested_at IS NOT NULL;

CREATE TABLE source_boilerplate_blocks (
    source_id             uuid    NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    block_hash            bigint  NOT NULL,
    doc_count             integer NOT NULL,
    -- The start of the block's text, shown to the source's owners.
    sample                text    NOT NULL DEFAULT '' CHECK (length(sample) <= 200),
    -- The document that keeps the block (shortest URL), so its information
    -- is indexed once rather than never.
    canonical_document_id uuid    REFERENCES documents (id) ON DELETE SET NULL,
    PRIMARY KEY (source_id, block_hash)
);

CREATE TABLE document_blocks (
    document_id uuid     PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
    source_id   uuid     NOT NULL,
    hashes      bigint[] NOT NULL DEFAULT '{}',
    dropped     bigint[] NOT NULL DEFAULT '{}',
    rev         integer  NOT NULL DEFAULT -1
);
CREATE INDEX document_blocks_source_idx ON document_blocks (source_id, rev);

-- Existing web sources are on by default: schedule a refresh, which
-- records their documents' blocks from the stored parsed text and
-- re-chunks the pages that change.
INSERT INTO source_boilerplate (source_id, requested_at)
SELECT id, now() FROM data_sources WHERE type = 'web';

-- +goose Down
DROP TABLE document_blocks;
DROP TABLE source_boilerplate_blocks;
DROP TABLE source_boilerplate;
