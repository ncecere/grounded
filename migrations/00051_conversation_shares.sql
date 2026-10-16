-- Sharing a conversation (v0.6.0, C12; ADR-0010 amendment): a user hands a read-only view of their own conversation to others by a link.
--
-- A share is a pointer, not a copy: it names the conversation and the last message it covers when it was made (up_to_seq). Messages are
-- never updated or deleted one by one (internal/agents: TestMessagesAreAppendOnly pins it), so the snapshot is exactly those messages. The
-- conversation's deletion, by the user (soft: the view checks deleted_at) or by retention (the cascade), ends the share with it.
--
-- Only a hash of the link's secret is kept: the link is shown once, when it is made.

-- +goose Up
CREATE TABLE conversation_shares (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    token_hash      bytea       NOT NULL CHECK (octet_length(token_hash) = 32),
    -- The last message of the snapshot (an answer).
    up_to_seq       integer     NOT NULL CHECK (up_to_seq >= 1),
    -- agent_users: signed-in people who may chat with the agent. anyone: open to anyone, only for a public agent.
    audience        text        NOT NULL CHECK (audience IN ('agent_users', 'anyone')),
    show_name       boolean     NOT NULL DEFAULT false,
    created_by      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT conversation_shares_token_key UNIQUE (token_hash)
);
CREATE INDEX conversation_shares_conversation_idx ON conversation_shares (conversation_id, created_at DESC);

-- +goose Down
DROP TABLE conversation_shares;
