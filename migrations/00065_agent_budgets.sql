-- +goose Up
-- Per-agent budgets (E17, #38; docs/specs/agent-budgets/DESIGN.md). Expand only: the previous release ignores both tables,
-- and a rollback stops enforcing agent budgets.
CREATE TABLE agent_budgets (
    agent_id   uuid          PRIMARY KEY REFERENCES agents (id) ON DELETE CASCADE,
    team_id    uuid          NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    amount     numeric(20,6) NOT NULL CHECK (amount >= 0),
    revision   bigint        NOT NULL DEFAULT 1,
    updated_by uuid          REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX agent_budgets_team_idx ON agent_budgets (team_id);

-- One notice per agent, month and level (team notices stay in budget_notices).
CREATE TABLE agent_budget_notices (
    agent_id   uuid        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    month      date        NOT NULL,
    level      text        NOT NULL CHECK (level IN ('warning', 'exhausted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, month, level)
);

-- +goose Down
DROP TABLE agent_budget_notices;
DROP TABLE agent_budgets;
