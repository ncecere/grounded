-- Drop duplicate GIN index on kb_chunks.tsv
-- Migration 0003 created kb_chunks_tsv_gin_idx and migration 0013 created
-- kb_chunks_tsv_idx — both are GIN indexes on the same column. Keep the one
-- from 0013 (created by the populate migration) and drop the older one.
DROP INDEX IF EXISTS kb_chunks_tsv_idx;
-- Keep kb_chunks_tsv_gin_idx (from 0003)
