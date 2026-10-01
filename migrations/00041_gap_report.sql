-- The unanswered-questions and gap report (docs/v0.4.0.md §2, ADR-0010 as
-- amended for v0.4.0): failed questions kept apart from transcripts and
-- grouped into topics.
--
--   * gap_questions: the question of an answer that failed (no context, a
--     strict refusal, every passage judged out, out of scope, unsupported or
--     uncited claims, a thumbs-down), with its embedding in the agent's
--     embedding profile (NULL until the topics job embeds it), the signals,
--     a pseudonymous asker key (message_events.pseudonymous_user: per team
--     for people, per agent and session for anonymous visitors) and whether
--     the asker shared it on a thumbs-down. Never a user ID. It goes with
--     its conversation (ON DELETE CASCADE), so it follows the transcript
--     retention of the agent's classification and legal holds exactly as
--     the conversation does.
--   * gap_topics: one agent's questions grouped by similarity by the
--     hourly topics job (internal/gaps), with a short label the agent's chat
--     model writes once at least 3 different askers are in it, a state
--     (open, dismissed, fixed, or resolved when its questions started being
--     answered well) and the centroid of its questions' embeddings. Counts
--     are read live from gap_questions, so a deleted conversation leaves
--     them at once.
--   * message_events.feedback_shared: the asker ticked "Share this question
--     with the team" with a thumbs-down.
--
-- Vectors use the untyped pgvector `vector` column: an agent's profile sets
-- the dimensions, and similarity is only ever computed within one profile.
--
-- New tables and a new column with a default only (expand/contract,
-- ADR-0013): the previous release never reads or writes them.

-- +goose Up
CREATE TABLE gap_topics (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id          uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    agent_id         uuid        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    -- The embedding profile of the centroid (NULL once the profile is gone:
    -- no question joins the topic any more).
    profile_id       uuid        REFERENCES embedding_profiles (id) ON DELETE SET NULL,
    centroid         vector,
    -- Written by the chat model from the topic's questions; '' until then.
    label            text        NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
    -- How many questions the label was written from (relabelled when the
    -- topic doubles).
    labelled_questions integer   NOT NULL DEFAULT 0,
    labelled_at      timestamptz,
    state            text        NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'dismissed', 'fixed', 'resolved')),
    -- The optional reason of a dismissal.
    state_reason     text        NOT NULL DEFAULT '' CHECK (char_length(state_reason) <= 500),
    state_changed_at timestamptz NOT NULL DEFAULT now(),
    -- Who dismissed it or marked it fixed (NULL: the topics job).
    state_changed_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    -- Good answers to a question near the topic since its last failure,
    -- and the last one: the topic resolves itself after enough of them.
    answered_since   integer     NOT NULL DEFAULT 0,
    last_answered_at timestamptz,
    -- The newest question assigned to the topic (reopening and resolving).
    last_failed_at   timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gap_topics_team_idx ON gap_topics (team_id, state);
CREATE INDEX gap_topics_agent_idx ON gap_topics (agent_id, profile_id) WHERE profile_id IS NOT NULL;

CREATE TABLE gap_questions (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id          uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    agent_id         uuid        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    conversation_id  uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    -- The failed answer.
    message_id       uuid        NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    question         text        NOT NULL CHECK (char_length(question) BETWEEN 1 AND 8000),
    profile_id       uuid        REFERENCES embedding_profiles (id) ON DELETE SET NULL,
    embedding        vector,
    -- no_context, refused, judged_out, out_of_scope, unsupported, uncited,
    -- thumbs_down.
    signals          text[]      NOT NULL DEFAULT '{}',
    feedback_reason  text,
    asker_key        text        NOT NULL CHECK (char_length(asker_key) BETWEEN 1 AND 128),
    shared           boolean     NOT NULL DEFAULT false,
    topic_id         uuid        REFERENCES gap_topics (id) ON DELETE SET NULL,
    -- The evaluation question a shared question was added to (by ID: the
    -- evaluation set may be deleted).
    evaluation_question_id uuid,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gap_questions_message_key UNIQUE (message_id)
);
CREATE INDEX gap_questions_topic_idx ON gap_questions (topic_id, created_at) WHERE topic_id IS NOT NULL;
CREATE INDEX gap_questions_pending_idx ON gap_questions (agent_id, created_at) WHERE topic_id IS NULL;
CREATE INDEX gap_questions_conversation_idx ON gap_questions (conversation_id);
CREATE INDEX gap_questions_team_time_idx ON gap_questions (team_id, created_at);

ALTER TABLE message_events ADD COLUMN feedback_shared boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE message_events DROP COLUMN feedback_shared;
DROP TABLE gap_questions;
DROP TABLE gap_topics;
