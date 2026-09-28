-- Platform analytics (docs/phase4-publishing.md §9): the overview reads
-- message_events, conversations and the usage ledger by time across all
-- teams, which the existing per-agent and per-team indexes don't serve.
-- A year of events is aggregated directly (no rollup tables): measured at
-- about 100 ms for 200k events, so a rollup isn't worth its upkeep yet.

-- +goose Up
CREATE INDEX message_events_time_idx ON message_events (created_at);
CREATE INDEX conversations_time_idx ON conversations (created_at);
CREATE INDEX usage_events_time_idx ON usage_events (occurred_at);

-- Public and widget answers (§5, §6) are recorded with their own channels.
-- The audiences migration allows the same values; repeating it here keeps
-- this migration correct whichever of the two runs first.
ALTER TABLE message_events DROP CONSTRAINT IF EXISTS message_events_channel_check;
ALTER TABLE message_events ADD CONSTRAINT message_events_channel_check
    CHECK (channel IN ('ui', 'api', 'openai', 'test', 'public', 'widget'));

-- +goose Down
-- The channel constraint is left as it is: the audiences migration owns it.
DROP INDEX usage_events_time_idx;
DROP INDEX conversations_time_idx;
DROP INDEX message_events_time_idx;
