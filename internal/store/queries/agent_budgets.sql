-- Per-agent budgets (docs/specs/agent-budgets/DESIGN.md).

-- name: GetAgentBudget :one
SELECT agent_id, team_id, amount::text AS amount, revision, updated_by, updated_at FROM agent_budgets WHERE agent_id = @agent_id;

-- name: ListAgentBudgets :many
SELECT agent_id, team_id, amount::text AS amount, revision, updated_by, updated_at FROM agent_budgets WHERE team_id = @team_id;

-- name: LockAgentBudget :one
SELECT revision FROM agent_budgets WHERE agent_id = @agent_id FOR UPDATE;

-- name: UpsertAgentBudget :one
-- A new budget starts at revision 2: revision 1 is "no budget" (If-Match revisions are at least 1).
INSERT INTO agent_budgets (agent_id, team_id, amount, updated_by, revision)
VALUES (sqlc.arg(agent_id), sqlc.arg(team_id), sqlc.arg(amount)::text::numeric, sqlc.arg(updated_by), 2)
ON CONFLICT (agent_id) DO UPDATE SET amount = EXCLUDED.amount, updated_by = EXCLUDED.updated_by,
    revision = agent_budgets.revision + 1, updated_at = now()
RETURNING agent_id, team_id, amount::text AS amount, revision, updated_by, updated_at;

-- name: DeleteAgentBudget :execrows
DELETE FROM agent_budgets WHERE agent_id = @agent_id;

-- name: InsertAgentBudgetNotice :execrows
INSERT INTO agent_budget_notices (agent_id, month, level) VALUES (@agent_id, @month, @level) ON CONFLICT DO NOTHING;
