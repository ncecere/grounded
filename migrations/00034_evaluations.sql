-- Evaluation sets and regression runs (docs/evaluations.md, docs/v0.2.0.md
-- §3.1 A2): a team's test questions for one knowledge base or one agent,
-- runs that check retrieval (and answers) against them, and the platform
-- switch that turns the feature off.
--
-- The switch is its own one-row table rather than a column on
-- platform_settings: the previous release reads platform_settings with
-- SELECT *, which a new column would break during a rolling upgrade
-- (expand/contract, ADR-0013).
--
-- A set belongs to exactly one knowledge base or one agent; deleting either
-- deletes its sets (knowledge bases are deleted outright; agents are
-- soft-deleted, so internal/agents deletes their sets in the same
-- transaction, and the foreign key covers a team purge).
--
-- Results keep a copy of their question, so deleting a question leaves
-- past runs readable. Runs (with their results) are removed by the retention
-- kind evaluation_runs (default 180 days); legal holds don't apply (they hold
-- no user content, only questions editors wrote and the agent's test output).

-- +goose Up
CREATE TABLE evaluation_settings (
    singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    -- On by default (docs/v0.2.0.md §6 decision 1): editors see the tabs.
    enabled    boolean     NOT NULL DEFAULT true,
    revision   bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO evaluation_settings DEFAULT VALUES;

CREATE TABLE eval_sets (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    kb_id       uuid        REFERENCES knowledge_bases (id) ON DELETE CASCADE,
    agent_id    uuid        REFERENCES agents (id) ON DELETE CASCADE,
    name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200 AND name = btrim(name)),
    description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
    -- Automatic retrieval checks (after a publish, a profile switch, and
    -- nightly when documents changed); opt-in.
    auto_run    boolean     NOT NULL DEFAULT false,
    created_by  uuid        REFERENCES users (id),
    revision    bigint      NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT eval_sets_one_target CHECK ((kb_id IS NULL) <> (agent_id IS NULL))
);
CREATE INDEX eval_sets_team_idx ON eval_sets (team_id, lower(name));
CREATE INDEX eval_sets_kb_idx ON eval_sets (kb_id) WHERE kb_id IS NOT NULL;
CREATE INDEX eval_sets_agent_idx ON eval_sets (agent_id) WHERE agent_id IS NOT NULL;

-- expected: {"documentIds": [uuid], "urls": [text], "filenames": [text]};
-- a URL ending in * is a prefix. Any expected document counts.
CREATE TABLE eval_cases (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id       uuid        NOT NULL REFERENCES eval_sets (id) ON DELETE CASCADE,
    question     text        NOT NULL CHECK (char_length(question) BETWEEN 1 AND 4000),
    expected     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    must_mention text[]      NOT NULL DEFAULT '{}',
    note         text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
    created_by   uuid        REFERENCES users (id),
    revision     bigint      NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eval_cases_set_idx ON eval_cases (set_id, created_at, id);

-- config: what the run tested (agent version, embedding profile, results
-- per search), for the markers on the score chart. summary: recall@k, MRR,
-- pass rate and counts, written when the run ends.
CREATE TABLE eval_runs (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id      uuid        NOT NULL REFERENCES eval_sets (id) ON DELETE CASCADE,
    team_id     uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    kind        text        NOT NULL CHECK (kind IN ('retrieval', 'answer')),
    trigger     text        NOT NULL CHECK (trigger IN ('manual', 'agent_published', 'profile_switched', 'nightly')),
    status      text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    started_by  uuid        REFERENCES users (id),
    config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    summary     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    total       integer     NOT NULL DEFAULT 0,
    done        integer     NOT NULL DEFAULT 0,
    error       text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    started_at  timestamptz,
    finished_at timestamptz
);
CREATE INDEX eval_runs_set_idx ON eval_runs (set_id, created_at DESC, id DESC);
CREATE INDEX eval_runs_created_idx ON eval_runs (created_at);
CREATE INDEX eval_runs_active_idx ON eval_runs (status) WHERE status IN ('queued', 'running');

-- One question's result in a run. hits: the top results that came back
-- (titles and links); scores: the full-answer scores.
CREATE TABLE eval_results (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id     uuid        NOT NULL REFERENCES eval_runs (id) ON DELETE CASCADE,
    case_id    uuid        REFERENCES eval_cases (id) ON DELETE SET NULL,
    question   text        NOT NULL,
    status     text        NOT NULL CHECK (status IN ('pass', 'fail', 'missing', 'error')),
    rank       integer,
    hits       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    answer     text,
    scores     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    error      text        NOT NULL DEFAULT '',
    latency_ms integer     NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT eval_results_run_case_key UNIQUE (run_id, case_id)
);
CREATE INDEX eval_results_case_idx ON eval_results (case_id, created_at DESC) WHERE case_id IS NOT NULL;

-- +goose Down
DROP TABLE eval_results;
DROP TABLE eval_runs;
DROP TABLE eval_cases;
DROP TABLE eval_sets;
DROP TABLE evaluation_settings;
