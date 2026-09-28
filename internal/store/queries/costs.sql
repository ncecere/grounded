-- Costs and budgets (internal/costs, docs/costs.md). Amounts are numeric in
-- Postgres and travel as decimal strings, never floats.

-- name: GetCostSettings :one
SELECT mode, currency, time_zone, warn_percent, coalesce(default_budget::text, '')::text AS default_budget, generation, revision, updated_by, updated_at
FROM cost_settings WHERE singleton;

-- name: LockCostSettings :one
SELECT mode, currency, time_zone, warn_percent, coalesce(default_budget::text, '')::text AS default_budget, generation, revision, updated_by, updated_at
FROM cost_settings WHERE singleton FOR UPDATE;

-- name: UpdateCostSettings :exec
UPDATE cost_settings
SET mode = @mode, currency = @currency, time_zone = @time_zone, warn_percent = @warn_percent,
    default_budget = sqlc.narg(default_budget)::text::numeric, generation = generation + 1, revision = revision + 1,
    updated_by = @updated_by, updated_at = now()
WHERE singleton;

-- Every change that can move a team's budget state bumps the generation, so
-- cached spend and budget states are dropped in every process.
-- name: BumpCostGeneration :exec
UPDATE cost_settings SET generation = generation + 1 WHERE singleton;

-- The platform settings with one team's budget (NULL columns when it has none).
-- name: TeamCostConfig :one
SELECT s.mode AS platform_mode, s.currency, s.time_zone, s.warn_percent AS platform_warn_percent,
       coalesce(s.default_budget::text, '')::text AS default_budget, s.generation,
       coalesce(b.mode, 'inherit')::text AS team_mode, coalesce(b.amount::text, '')::text AS amount, b.warn_percent,
       coalesce(b.revision, 1)::bigint AS revision
FROM cost_settings s LEFT JOIN team_budgets b ON b.team_id = @team_id
WHERE s.singleton;

-- name: LockTeamBudget :one
SELECT mode, coalesce(amount::text, '')::text AS amount, warn_percent, revision FROM team_budgets WHERE team_id = $1 FOR UPDATE;

-- The first change of a team's budget: revision 1 was the implicit
-- "inherit everything" state. Zero rows means another admin inserted first.
-- name: InsertTeamBudget :execrows
INSERT INTO team_budgets (team_id, mode, amount, warn_percent, revision, updated_by)
VALUES (@team_id, @mode, sqlc.narg(amount)::text::numeric, sqlc.narg(warn_percent), 2, @updated_by)
ON CONFLICT (team_id) DO NOTHING;

-- name: UpdateTeamBudget :exec
UPDATE team_budgets
SET mode = @mode, amount = sqlc.narg(amount)::text::numeric, warn_percent = sqlc.narg(warn_percent),
    revision = revision + 1, updated_by = @updated_by, updated_at = now()
WHERE team_id = @team_id;

-- Active teams with their budget settings (the Budgets tab).
-- name: ListTeamBudgets :many
SELECT t.id, t.slug, t.name, coalesce(b.mode, 'inherit')::text AS mode, coalesce(b.amount::text, '')::text AS amount, b.warn_percent
FROM teams t LEFT JOIN team_budgets b ON b.team_id = t.id
WHERE t.status = 'active'
ORDER BY t.name, t.id;

-- Teams whose override is enforce (the dispatcher's candidates when the
-- platform mode is not enforce).
-- name: EnforcedTeamOverrides :many
SELECT team_id FROM team_budgets WHERE mode = 'enforce';

-- Teams whose override opts out of the platform mode.
-- name: TeamModeOverrides :many
SELECT team_id, mode FROM team_budgets WHERE mode <> 'inherit';

-- name: InsertBudgetExtension :one
INSERT INTO budget_extensions (team_id, month, amount, reason, created_by)
VALUES (@team_id, @month, sqlc.arg(amount)::text::numeric, @reason, @created_by)
RETURNING id, team_id, month, amount::text AS amount, reason, created_by, created_at;

-- name: ListBudgetExtensions :many
SELECT e.id, e.team_id, e.month, e.amount::text AS amount, e.reason, e.created_by, e.created_at,
       coalesce(u.display_name, '') AS created_by_name, coalesce(u.email, '') AS created_by_email
FROM budget_extensions e LEFT JOIN users u ON u.id = e.created_by
WHERE e.team_id = @team_id AND e.month = @month
ORDER BY e.created_at, e.id;

-- name: SumBudgetExtensions :one
SELECT coalesce(sum(amount), 0)::text AS total FROM budget_extensions WHERE team_id = @team_id AND month = @month;

-- name: ListModelPrices :many
SELECT p.id, p.model_id, p.unit, p.price::text AS price, p.effective_from, p.created_by, p.created_at,
       coalesce(u.display_name, '') AS created_by_name
FROM model_prices p LEFT JOIN users u ON u.id = p.created_by
WHERE p.model_id = @model_id
ORDER BY p.effective_from DESC, p.unit;

-- Every model's prices (the Prices tab picks the current row per unit).
-- name: ListAllModelPrices :many
SELECT id, model_id, unit, price::text AS price, effective_from, created_by, created_at
FROM model_prices ORDER BY model_id, unit, effective_from DESC;

-- name: GetModelPrice :one
SELECT id, model_id, unit, price::text AS price, effective_from, created_by, created_at
FROM model_prices WHERE id = @id AND model_id = @model_id;

-- name: InsertModelPrice :one
INSERT INTO model_prices (model_id, unit, price, effective_from, created_by)
VALUES (@model_id, @unit, sqlc.arg(price)::text::numeric, @effective_from, @created_by)
ON CONFLICT ON CONSTRAINT model_prices_key DO NOTHING
RETURNING id, model_id, unit, price::text AS price, effective_from, created_by, created_at;

-- name: DeleteModelPrice :execrows
DELETE FROM model_prices WHERE id = @id AND model_id = @model_id;

-- Records a notification level once per team and month; zero rows means it
-- was already sent.
-- name: InsertBudgetNotice :execrows
INSERT INTO budget_notices (team_id, month, level) VALUES (@team_id, @month, @level)
ON CONFLICT DO NOTHING;

-- name: ListBudgetNotices :many
SELECT team_id, level FROM budget_notices WHERE month = @month;

-- name: GetRollupState :one
SELECT rolled_until FROM usage_rollup_state WHERE singleton;

-- Taken by the rollup job (update) and by the retention purge (share), so a
-- purge never races a rollup of the same hours.
-- name: LockRollupState :one
SELECT rolled_until FROM usage_rollup_state WHERE singleton FOR UPDATE;

-- name: SetRollupState :exec
UPDATE usage_rollup_state SET rolled_until = @rolled_until, updated_at = now() WHERE singleton;

-- name: SumBudgetExtensionsByTeam :many
SELECT team_id, sum(amount)::text AS total FROM budget_extensions WHERE month = @month GROUP BY team_id;
