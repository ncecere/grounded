-- Index preview (#18): a migration that builds the new index and then waits for an admin to switch, instead of switching by itself.
--
-- hold:   set at start; when every source has the target's vectors the migration becomes 'ready' (and the KB keeps its profile)
--         instead of switching.
-- ready:  built, not switched. It still counts as the KB's one active migration, and its sets are kept by the cleanup job.
--
-- Rows are only ever created as 'ready' by code that knows the status, so a rolling update (old pods still running the previous
-- version while this runs) is safe: the previous version inserts 'running' and never reads 'ready'.

-- +goose Up
ALTER TABLE profile_migrations
    ADD COLUMN hold boolean NOT NULL DEFAULT false,
    DROP CONSTRAINT profile_migrations_status_check,
    ADD CONSTRAINT profile_migrations_status_check
        CHECK (status IN ('running', 'ready', 'switched', 'completed', 'cancelled', 'switched_back')),
    ADD CONSTRAINT profile_migrations_ready_needs_hold CHECK (status <> 'ready' OR hold);

DROP INDEX profile_migrations_one_active;
CREATE UNIQUE INDEX profile_migrations_one_active ON profile_migrations (kb_id) WHERE status IN ('running', 'ready', 'switched');
DROP INDEX profile_migrations_active_idx;
CREATE INDEX profile_migrations_active_idx ON profile_migrations (status) WHERE status IN ('running', 'ready', 'switched');

-- +goose Down
-- A ready migration has not changed anything the KB uses: cancelling it is the same as discarding it.
UPDATE profile_migrations SET status = 'cancelled', finished_at = coalesce(finished_at, now()) WHERE status = 'ready';

DROP INDEX profile_migrations_active_idx;
CREATE INDEX profile_migrations_active_idx ON profile_migrations (status) WHERE status IN ('running', 'switched');
DROP INDEX profile_migrations_one_active;
CREATE UNIQUE INDEX profile_migrations_one_active ON profile_migrations (kb_id) WHERE status IN ('running', 'switched');

ALTER TABLE profile_migrations
    DROP CONSTRAINT profile_migrations_ready_needs_hold,
    DROP CONSTRAINT profile_migrations_status_check,
    ADD CONSTRAINT profile_migrations_status_check
        CHECK (status IN ('running', 'switched', 'completed', 'cancelled', 'switched_back')),
    DROP COLUMN hold;
