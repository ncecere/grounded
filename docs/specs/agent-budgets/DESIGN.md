# Per-agent budgets and the other budget follow-ups (E17, #38)

Status: accepted for v0.9.0. No owner decision was recorded for E17; the choices below were recommended on 2026-11-05 and
accepted with "follow your recommendations". Builds on [costs.md](../../costs.md) (E2): its modes, prices, rollup, budget month
and enforcement are unchanged.

## What it adds

1. **Per-agent monthly budgets**: a cap on one agent's spend inside its team's budget.
2. **Re-embedding during a profile migration** is checked against the team's budget.
3. **Documents already queued** when the budget runs out wait instead of finishing.
4. **A shorter cache** for teams close to their budget, so they overshoot less.

## 1. Per-agent budgets

| Question | Choice | Why |
|---|---|---|
| Who sets it | The team's **owners and admins** (the people who already see the team's spend), and platform admins. Audited (`costs.agent_budget_update`), If-Match. | The team decides how its budget is shared between its agents; platform admins set the team's total. |
| What it is | An optional monthly amount per agent, in the platform currency. Empty: no agent cap (the team budget still applies). An agent's budget may be larger than the team's; the team's still stops it first. | One number, like the team budget. |
| When it applies | Only when the team's **effective mode is Enforce**. In Track only it shows as progress ("40% of $20.00 · not enforced"); Off shows nothing. | The same rule as team budgets (owner decision 2 of v0.2.0). |
| What counts | The agent's usage in the rollup (`usage_rollup.agent_id`) priced as the team's spend is: chat, its tools' model calls, moderation and SystemOne, and MCP tool calls with a price; in every channel, including evaluation runs and editors' tests. | It is what the agent spent; the ledger already attributes it. |
| At 100% | That agent's chats are refused with 429 **`agent_budget_exhausted`** (`details: {budget, spent, currency, resetsAt, agentId}`), in every channel; public pages and the widget show the generic "unavailable right now". Its evaluation runs stop like a refused chat. Other agents and retrieval are not affected. | Only the agent that spent the money stops. |
| Warning | Owners and admins are notified at the team's warning threshold and at 100%, once per agent per month, like team notices (they can't be turned off). | Same as team budgets. |
| Extensions | None: owners and admins raise the agent's budget themselves (audited). | A per-agent extension would only duplicate raising the budget. |
| Where | Agent → Analytics shows the agent's spend this month with its budget meter (already shows spend). Team settings → Usage & spend → Spend breakdown lists each agent with its budget, and owners and admins set it there. Editors and members see no money: an editor's test chat refused by the agent budget reads "This agent's monthly budget is used up" without amounts. | Where the agent's spend is already shown. |

Storage: `agent_budgets (agent_id PK → agents ON DELETE CASCADE, team_id, amount numeric(20,6) NOT NULL CHECK ≥ 0,
revision, updated_by, updated_at)` and `budget_notices` gains an optional `agent_id` (the key becomes team, agent, month,
level, NULLS NOT DISTINCT). Expand only.

The check runs where the team budget is checked for a chat (`limits.CheckChat`), after it: a team that is over its budget is
refused as today (`budget_exhausted`), and an agent over its own as `agent_budget_exhausted`. Month-to-date per agent uses the
same cache as the team (§4), keyed by agent. An MCP tool call inside an answer checks the agent budget too, as it checks the
team's.

## 2. Re-embedding during a profile migration

Today a migration's re-embedding (`embedding_set.sync`) doesn't check the budget. From now on, when the source's team is over
its **enforced** budget, the sync job **waits** (snoozed until the budget's next check, at most 10 minutes) instead of
embedding, and the migration shows "Waiting: the team's monthly budget is used up". Raising the budget or an extension wakes it
at the next check. Shared (platform) sources have no team budget and are unaffected.

## 3. Documents already queued

Today the dispatcher stops starting documents for a team over its budget, but documents already dispatched finish. From now on
the processor checks the budget **when it starts a document**, before parsing, OCR, contextual chunks or embeddings: a team
over its enforced budget puts the document back to wait (`pending`, error code `monthly_budget`, like the daily OCR limit),
freeing its slot, and checks again within 10 minutes. Raising the budget or granting an extension wakes waiting documents at
once. A document already past that check finishes (a model call is never cut in half).

## 4. A shorter cache near the limit

Month-to-date spend is cached for 30 seconds per team. From the warning threshold on, it is cached for **5 seconds**, so a team
close to its budget overshoots by about 5 seconds of use rather than 30. Below the threshold nothing changes (spend reads stay
cheap). Agent budgets use the same rule with the agent's own threshold position.

## API

- `GET /v1/teams/{team}/agents/{agentId}/budget` (owners, admins, platform staff): amount, spent, state, enforced, revision.
- `PUT /v1/teams/{team}/agents/{agentId}/budget` `{amount: string | null}` (owners, admins, platform admins; If-Match; null
  removes it).
- `GET /v1/teams/{team}/spend` adds each agent's budget and state to `byAgent`.
- Errors: 429 `agent_budget_exhausted`.

All classified in the authorization matrix; editors and members are refused the budget endpoints (404 while the mode is Off,
as `/spend`).

## Compatibility

Migration: creates `agent_budgets`, adds `budget_notices.agent_id` with a new primary key built concurrently-safe (a small
table). The previous release ignores agent budgets; a rollback simply stops enforcing them.

## Tests

Agent budget refusal in the app, API and public channels; other agents and retrieval unaffected; Track only shows and never
refuses; the team budget wins first; notices once per agent per month; the migration sync waits and resumes; a queued
document waits before embedding and resumes after an extension; the near-limit cache; authorization matrix; web: the spend
breakdown's budget editor and the agent's meter, with axe.
