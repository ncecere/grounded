-- Searching a source's documents by title, URL or file name (?q= on the
-- document lists). A trigram index serves the substring match; btree_gin
-- (00004) lets it lead with source_id. pg_trgm is a trusted extension
-- (Postgres 13+), so the database owner can create it.

-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX documents_search_idx ON documents
    USING gin (source_id, (title || ' ' || url || ' ' || filename) gin_trgm_ops);

-- +goose Down
DROP INDEX documents_search_idx;
