-- The gap report after the v0.4.0 walkthrough (docs/v0.4.0.md §2, owner
-- decisions 4 and 5 of 2026-10-01):
--
--   * gap_topics.dismiss_kind: a dismissal is "for now" (the topic reopens
--     when newer questions about it fail, as before) or "not for this
--     agent" (it stays closed: new questions still join it and are
--     counted, but it never reopens). NULL unless the topic is dismissed; a
--     topic the previous release dismissed reads as "for now".
--   * gap_topic_events: a topic's history (dismissed, fixed, reopened,
--     resolved, merged), with a dismissal's kind and reason and who acted
--     (NULL: the topics job). Shown to the team's editors, admins and
--     owners on the topic's page; never erased when the topic reopens.
--     Audit entries carry the kind and whether there was a reason, never
--     its text.
--   * gap_settings: a team's gap report settings. confirm_similar asks
--     SystemOne whether borderline questions and topics are about the same
--     subject in the hourly job (off by default).
--   * gap_topic_pairs: two topics SystemOne said are about different
--     subjects, so the job doesn't ask again every hour.
--
-- Expand only (ADR-0013): a new nullable column and new tables; the
-- previous release never reads or writes them.

-- +goose Up
ALTER TABLE gap_topics ADD COLUMN dismiss_kind text CHECK (dismiss_kind IN ('for_now', 'not_for_agent'));

CREATE TABLE gap_topic_events (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id     uuid        NOT NULL REFERENCES gap_topics (id) ON DELETE CASCADE,
    kind         text        NOT NULL CHECK (kind IN ('dismissed', 'fixed', 'reopened', 'resolved', 'merged')),
    dismiss_kind text        CHECK (dismiss_kind IN ('for_now', 'not_for_agent')),
    reason       text        NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
    -- Who acted (NULL: the topics job).
    actor_id     uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gap_topic_events_topic_idx ON gap_topic_events (topic_id, created_at);

CREATE TABLE gap_settings (
    team_id         uuid        PRIMARY KEY REFERENCES teams (id) ON DELETE CASCADE,
    confirm_similar boolean     NOT NULL DEFAULT false,
    revision        bigint      NOT NULL DEFAULT 1,
    updated_by      uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gap_topic_pairs (
    topic_a    uuid        NOT NULL REFERENCES gap_topics (id) ON DELETE CASCADE,
    topic_b    uuid        NOT NULL REFERENCES gap_topics (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (topic_a, topic_b),
    CHECK (topic_a < topic_b)
);
CREATE INDEX gap_topic_pairs_b_idx ON gap_topic_pairs (topic_b);

-- +goose Down
DROP TABLE gap_topic_pairs;
DROP TABLE gap_settings;
DROP TABLE gap_topic_events;
ALTER TABLE gap_topics DROP COLUMN dismiss_kind;
