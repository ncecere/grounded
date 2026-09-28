# Costs and budgets (E2, v0.2)

Status: **agreed** (owner, 2026-09-28), for M3 of [`v0.2.0.md`](v0.2.0.md) §3.3. The owner's decisions are in §9. **Implemented** (package `internal/costs`, [DESIGN §11.3](DESIGN.md#113-costs-and-budgets), runbook [`operations/costs.md`](operations/costs.md)); where the implementation settles details this design left open, §10 says so.

Grounded already meters every model call in the usage ledger (`usage_events`, DESIGN §11.2). E2 puts prices on that usage, reports spend, and optionally enforces a monthly budget per team. It is **off by default**: with the mode on *Off*, nothing on screen or in the API changes.

## 1. Modes

A platform setting with per-team overrides:

| Mode | What happens |
|---|---|
| **Off** (default) | Nothing. Prices can still be entered, ready for later. |
| **Track only** | Spend is reported to platform admins, auditors and the team's owners and admins. No budgets, no warnings, nothing refused. |
| **Enforce** | Track only, plus monthly budgets: a warning at the threshold (default 80%) and, at 100%, the team's model work is refused until an admin raises the budget, grants an extension, or the month ends. |

A team's override is *Inherit* (default), *Off*, *Track only* or *Enforce*, so one team can be enforced as a pilot while the rest are only tracked.

## 2. Prices

Admins enter a price per model, per unit the ledger records. Prices are **dated**: a change adds a row with an *effective from* date (UTC), and each day's usage is priced at the row in effect that day. Rows are never edited, so past spend doesn't change when a price does. An admin may date a price in the past to price usage already recorded (the form says so). Deleting a mistaken row is allowed and audited.

| Model kind | Units (prices per 1M units unless noted) | Ledger kind |
|---|---|---|
| chat | input tokens · output tokens | `chat_tokens_in` · `chat_tokens_out` |
| embedding | tokens (or characters, when the gateway counts characters: the ledger keeps whatever the gateway reports) | `embed_tokens` |
| systemone | input tokens · per request | `systemone_tokens` · **new** `systemone_requests` |
| moderation | per request | **new** `moderation_requests` |
| vision (OCR, [`ocr.md`](ocr.md)) | input tokens · output tokens | `vision_tokens_in` · `vision_tokens_out` |

Two ledger kinds are new: SystemOne's meter already counts requests but only its tokens are written, and moderation calls are not in the ledger today. Usage of a model with no price costs $0 and is flagged **Unpriced** in every report, so a missing price is visible rather than silently free.

Currency is one platform setting (ISO code, default `USD`), used for display only; there is no conversion. Amounts are `numeric` in Postgres and strings in the API, never floats.

## 3. Rollup: spend without scanning the ledger

Reports and enforcement read a new **hourly** rollup, `usage_rollup` (UTC hour, kind, team, agent, model, channel → quantity, events). Hours, not days, because the budget month and report days follow the platform time zone (§4), and a local midnight falls inside a UTC day:
- A River periodic job rolls up each **closed** UTC hour once, 10 minutes after it ends (for late commits), from `usage_events`. Retention keeps events at least a day, so every hour is rolled before its events can be purged, and the rollup doesn't double count.
- **Open hours** (since the last rolled hour) are read live from `usage_events`, which is indexed by team and time.
- The first run backfills every past hour with usage. Events retention purged before E2 existed are only in `usage_daily`, by UTC day; the backfill puts each such day in its first hour, so month boundaries before E2 are exact only to the UTC day.
- Changing the time zone needs no rebuild: hours are converted at read time. In zones with a :30 or :45 offset, a boundary falls inside an hour; that hour counts on the side where it starts.

Spend = rollup quantities × the price in effect on each (local) day, per unit, computed in SQL.

## 4. Budgets and enforcement

- **A team's budget** is a monthly amount (the calendar month in the platform time zone, default UTC) with a warning threshold (default 80%, platform setting). A platform **default budget** (optional) applies to enforced teams without their own.
- **Extensions:** an admin adds an amount to the current month only, with a reason. It lapses when the month ends. Audited.
- **The check** runs where `chat_tokens_per_day` is checked (`limits.CheckChat`), plus the retrieval path (`CheckQuery`) and the ingestion dispatcher. Month-to-date spend is the rollup's closed days plus the live open days, cached per team for 30 seconds, so a team can overshoot by at most about 30 seconds of use.
- **At 100%:**
  - Chats are refused with 429 `budget_exhausted` (`details: {budget, spent, currency, resetsAt}`), in every channel: the app, the API, the widget and public pages (which show a generic "unavailable right now" to anonymous visitors).
  - Ingestion waits: the dispatcher skips the team, and its documents and crawls show "Waiting: the team's monthly budget is used up", like the daily page limit (G4). Raising the budget or an extension wakes them at once.
  - Retrieval queries (`/retrieve`, the Search tab) are refused with the same 429.
  - Nothing is deleted or failed.
- **Notifications** (new, can't be turned off, like other limit events): the team's owners and admins at the threshold and at 100%, once per month each. Platform admins see those teams in Admin → Costs → Budgets and on the Admin overview's "near limits" list.

## 5. What people see

- **Admin → Costs** (new, under Monitoring, next to Analytics). Hidden while the mode is Off, except the Settings and Prices tabs.
  - **Overview:** a date range, total spend, a daily chart by kind (chat, embedding, SystemOne, moderation), and top teams, agents and models with spend, tokens and "Unpriced" flags. CSV export.
  - **Budgets:** each team's mode, budget, month-to-date spend, percentage and projected month-end; a team opens its record.
  - **Prices:** every model with its current prices and "Unpriced" where missing; a model opens its record.
  - **Settings:** mode, currency, time zone, warning threshold, default budget.
- **A model's record page:** a **Pricing** section with the current prices and their history, and "Change prices".
- **Admin → Teams → a team:** a **Budget** card: mode override, monthly budget, extensions this month.
- **Team settings → Usage** (owners and admins): "Spend this month" with the budget meter when enforced, and spend by agent and model. Editors and members see no money.
- **A banner** in the team's workspace at the threshold and when blocked, for everyone in the team (members need to know why chat stopped), without amounts for members.

## 6. API (OpenAPI first)

- `GET/PUT /v1/admin/costs/settings` (mode, currency, time zone, threshold, default budget; If-Match)
- `GET /v1/admin/costs/prices` (every model's current prices) · `GET/POST /v1/admin/models/{modelId}/prices` · `DELETE /v1/admin/models/{modelId}/prices/{priceId}`
- `GET /v1/admin/costs/report?from&to&groupBy=team|agent|model|day` and `…/report.csv`
- `GET /v1/admin/costs/budgets` · `GET/PUT /v1/admin/teams/{team}/budget` (mode override, amount, threshold; If-Match) · `POST /v1/admin/teams/{team}/budget/extensions`
- `GET /v1/teams/{team}/spend?from&to` (owners, admins; 404 while the effective mode is Off)

All classified in the authorization matrix: admin writes are platform-admin only; auditors read the admin views.

## 7. Data

Migration (next number at merge):
- `cost_settings` (singleton: mode, currency, time_zone default `UTC`, warn_percent, default_budget, revision)
- `model_prices` (id, model_id, unit, price numeric(20,6), effective_from date, created_by, created_at; unique per model, unit and date)
- `team_budgets` (team_id PK, mode override, amount, warn_percent override, revision)
- `budget_extensions` (id, team_id, month, amount, reason, created_by, created_at)
- `usage_rollup` (hourly) and a watermark of the last rolled hour
- `budget_notices` (team, month, level) so each notification is sent once

## 8. Tests and gates

Pricing arithmetic and effective dating (unit), the rollup against `usage_events` + `usage_daily` with retention in between (integration), enforcement in chat, retrieval and dispatch with the wake-up (integration), the authorization matrix, web tests for every page and form, and an E2E flow: set a price, set a tiny budget, chat until blocked, grant an extension, chat again, with axe on every screen.

## 9. Owner decisions (2026-09-28)

1. ~~Who sets a team's budget?~~ **Platform admins only** (owner, 2026-09-28). Team owners and admins see their spend and budget but can't change them, like limits.
2. ~~Per-agent budgets in v0.2?~~ **No** (owner, 2026-09-28). Reports show spend per agent; per-agent caps can come later.
3. ~~What is refused at 100%?~~ **Everything that calls a model** (owner, 2026-09-28): chats, retrieval queries (`/retrieve`, the Search tab) and ingestion.
4. ~~Budget month?~~ **The calendar month in a platform time zone, default UTC** (owner, 2026-09-28). Admins set the zone (an IANA name such as `America/New_York`) in Admin → Costs → Settings; reports' days use it too. Daily limits still reset at midnight UTC.

## 10. Implementation notes

- **Pricing in Go:** SQL sums quantities per local day, unit and model; the price in effect is applied in Go with exact decimals (`math/big`), so the dating and arithmetic are unit-tested. Amounts are rounded to six decimals only when shown.
- **Price dates** are days in the platform time zone (not UTC), matching the local days usage is priced on.
- **Budget state for members:** `GET /v1/teams/{team}/budget-status` (every member; amounts only for owners, admins and platform readers) drives the workspace banner and the "Waiting" hint on sources, in addition to §6.
- **Cache:** besides the 30-second expiry, every change to settings, prices, budgets or extensions bumps `cost_settings.generation`, which drops cached figures in every process at once; and usage a process records is added to its cached figure as it's written, so a team is refused on its next request rather than up to 30 seconds later.
- **Retention:** the purge adds events of hours the rollup hasn't reached to `usage_rollup` under a share lock on the watermark, so a stopped worker can't lose usage and nothing is counted twice.
- **The dispatcher** reads the blocked teams once per dispatch job (every 5 seconds, and on every kick, including the one a budget change sends), outside its transaction; dispatches run by finishing documents reuse that list, so a team can start at most about 5 seconds of extra ingestion after it runs out.
- **Crawls wait** at their next invocation (reason `monthly_budget`, re-checked every 15 minutes and woken on a change); documents already queued finish.
- **The Budget card** on a team's admin page is hidden while the platform mode is Off and the team inherits (with Off nothing changes on screen); to pilot Enforce on one team, set the platform to Track only first, or set the team's mode through the API.
