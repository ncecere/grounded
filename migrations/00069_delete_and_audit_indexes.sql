-- +goose NO TRANSACTION
-- Indexes only (v0.10.0): no table, column or row changes. Each is built CONCURRENTLY, so writes go on while it builds,
-- and the migration can be run again after an interrupted build (an invalid index left behind is dropped first).
--
-- Five foreign keys with ON DELETE SET NULL had no index on the referencing column, so deleting one referenced row
-- scanned the whole referencing table to find the rows to clear:
--   - retention deletes expired anonymous sessions and their conversations in batches (conversations.anon_session_id,
--     anon_sessions.conversation_id): one scan of the other table per deleted row;
--   - deleting a document (a re-crawl's stale pages, a deleted source) scanned contextual_calls and the two
--     boilerplate block tables.
-- The indexes are partial: most rows hold NULL and never need to be found.
--
-- The sixth serves a team's audit page, which reads its entries newest first by id (keyset on id); the existing
-- (team_id, occurred_at) index could not return them in that order.

-- +goose Up
-- +goose StatementBegin
DO $$
DECLARE
    name text;
BEGIN
    FOREACH name IN ARRAY ARRAY['conversations_anon_session_idx', 'anon_sessions_conversation_idx', 'contextual_calls_document_idx', 'source_boilerplate_blocks_canonical_idx', 'set_boilerplate_blocks_canonical_idx', 'audit_log_team_id_idx'] LOOP
        IF EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(name) AND NOT indisvalid) THEN
            EXECUTE format('DROP INDEX %I', name);
        END IF;
    END LOOP;
END
$$;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_anon_session_idx
    ON conversations (anon_session_id) WHERE anon_session_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS anon_sessions_conversation_idx
    ON anon_sessions (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS contextual_calls_document_idx
    ON contextual_calls (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS source_boilerplate_blocks_canonical_idx
    ON source_boilerplate_blocks (canonical_document_id) WHERE canonical_document_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS set_boilerplate_blocks_canonical_idx
    ON set_boilerplate_blocks (canonical_document_id) WHERE canonical_document_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_team_id_idx
    ON audit_log (team_id, id DESC) WHERE team_id IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS audit_log_team_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS set_boilerplate_blocks_canonical_idx;
DROP INDEX CONCURRENTLY IF EXISTS source_boilerplate_blocks_canonical_idx;
DROP INDEX CONCURRENTLY IF EXISTS contextual_calls_document_idx;
DROP INDEX CONCURRENTLY IF EXISTS anon_sessions_conversation_idx;
DROP INDEX CONCURRENTLY IF EXISTS conversations_anon_session_idx;
