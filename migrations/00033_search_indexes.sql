-- The command palette's object search (GET /v1/search, docs/v0.2.0.md
-- §3.5). Names are matched case-insensitively as substrings (ILIKE
-- '%q%'), which trigram indexes serve (pg_trgm, 00012). Team-scoped
-- tables lead with team_id (btree_gin, 00004) so a member's search stays
-- within their teams; conversations lead with user_id (only the caller's
-- own are searched). The small catalog tables (models, connections,
-- embedding profiles) need no index.

-- +goose Up
CREATE INDEX teams_name_search_idx ON teams USING gin (name gin_trgm_ops);
CREATE INDEX users_search_idx ON users USING gin ((display_name || ' ' || email::text) gin_trgm_ops);
CREATE INDEX agents_name_search_idx ON agents USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX knowledge_bases_name_search_idx ON knowledge_bases USING gin (team_id, name gin_trgm_ops);
CREATE INDEX data_sources_name_search_idx ON data_sources USING gin (name gin_trgm_ops);
CREATE INDEX conversations_title_search_idx ON conversations USING gin (user_id, title gin_trgm_ops) WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX conversations_title_search_idx;
DROP INDEX data_sources_name_search_idx;
DROP INDEX knowledge_bases_name_search_idx;
DROP INDEX agents_name_search_idx;
DROP INDEX users_search_idx;
DROP INDEX teams_name_search_idx;
