-- +goose Up
-- A router agent's answer (docs/specs/v0.6.0/DESIGN.md §4): the routing decision, content-free:
-- {decision, confidence, candidates, agentId, conversationId, latencyMs}. decision is routed, none, small_talk or
-- unavailable; agentId and conversationId say where a routed question went (the asker's own conversation with that
-- agent). NULL for every other answer.
ALTER TABLE message_events ADD COLUMN routing jsonb;

-- +goose Down
ALTER TABLE message_events DROP COLUMN routing;
