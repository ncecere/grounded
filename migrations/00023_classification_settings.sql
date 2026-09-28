-- The per-level settings DESIGN.md §4 lists beside the audience ceiling and
-- anonymous retention (docs/ui-review A8):
--
--   * conversation_retention_days: signed-in conversations of agents at this
--     level are deleted this many days after their last activity; NULL keeps
--     them until their owner deletes them.
--   * allowed_source_types: the data source types that may hold data at
--     this level (checked when a source is created or reclassified).
--   * direct_retrieve: whether team API keys may call a knowledge base's
--     /retrieve directly (agents are unaffected).
--
-- The defaults keep today's behaviour.

-- +goose Up
ALTER TABLE classification_levels
    ADD COLUMN conversation_retention_days integer
        CHECK (conversation_retention_days BETWEEN 1 AND 36500),
    ADD COLUMN allowed_source_types text[] NOT NULL DEFAULT '{upload,web}'
        CHECK (cardinality(allowed_source_types) >= 1 AND allowed_source_types <@ ARRAY['upload', 'web']::text[]),
    ADD COLUMN direct_retrieve boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE classification_levels
    DROP COLUMN direct_retrieve,
    DROP COLUMN allowed_source_types,
    DROP COLUMN conversation_retention_days;
