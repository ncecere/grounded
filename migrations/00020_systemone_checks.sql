-- SystemOne citation checks and scope check (ADR-0020, docs/systemone.md
-- §3-§4): the content-free record of each answer's checks. The platform
-- settings live in systemone_settings.settings (new "citations" and
-- "scope" sections, defaults when absent), and verdicts on the stored
-- message's citations, so neither needs a column.

-- +goose Up
-- {mode, claims, pairs, checked, verified, unsupported, contradicted,
-- unchecked, lowConfidence, removed, refused, requests, latencyMs}; never
-- content (ADR-0010). NULL when citations were not checked.
ALTER TABLE message_events ADD COLUMN citations jsonb;

-- {decision, action, smallTalk, inScope, latencyMs}: the scope check's
-- decision and scores, never the message. NULL when not checked.
ALTER TABLE message_events ADD COLUMN scope jsonb;

-- +goose Down
ALTER TABLE message_events DROP COLUMN scope;
ALTER TABLE message_events DROP COLUMN citations;
