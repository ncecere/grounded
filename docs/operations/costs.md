# Costs and budgets: prices, modes and monthly team budgets

Grounded meters every model call in the usage ledger. With prices entered, it reports what that use costs, and it can hold each team to a monthly budget. The design and the owner's decisions are in [`costs.md`](../costs.md) (E2, v0.2); the data model is in [DESIGN §11.3](../DESIGN.md#113-costs-and-budgets).

Costs are **off** by default: nothing changes for anyone until a platform admin chooses a mode. Everything below is in **Admin → Costs** (under Monitoring, next to Analytics). Platform admins change it; platform auditors can read it.

## 1. Enter prices

Prices can be entered while the mode is still Off, so tracking starts with correct figures.

1. Open **Admin → Costs → Prices**. It lists every chat, embedding, SystemOne and moderation model with its price today; a missing price shows **Unpriced**.
2. Open a model (**View details**), then **Change prices** in its **Pricing** section.
3. Choose **Effective from** (a day in the platform time zone) and fill in the units you're changing. Units you leave empty keep their current price.

| Model kind | Units |
|---|---|
| Chat | input tokens and output tokens, per 1M tokens |
| Embedding | tokens per 1M (characters per 1M, if your gateway reports characters: the ledger keeps whatever the gateway sends) |
| SystemOne | input tokens per 1M, and per answered request |
| Moderation | per answered request |

Rerank models aren't priced.

- **Prices are dated, never edited.** A change adds rows; each day's usage is priced at the row in effect that day, so past spend doesn't change when a price does.
- **Pricing past usage:** choose a date in the past. Usage already recorded from that day on is priced at once, since spend is always computed from the ledger.
- **A mistake:** delete the row from the model's price history. Usage on its days goes back to the row before it (or to unpriced). Adding and deleting prices are audited (`costs.price_add`, `costs.price_delete`).
- **Unpriced usage costs nothing** and is flagged **Unpriced** in every report, so a missing price is visible rather than silently free. Check the Prices tab after adding a model.

The currency (Settings) is a display code only; there is no conversion. Enter every price in that currency.

## 2. Choose a mode

In **Admin → Costs → Settings**:

| Setting | Default | Meaning |
|---|---|---|
| Cost tracking | Off | **Off**: nothing is tracked or refused. **Track only**: spend is reported to platform admins, auditors and each team's owners and admins; a team with a budget shows progress against it ("not enforced"), and nothing is refused or notified. **Enforce**: Track only, plus enforced monthly budgets. |
| Currency | `USD` | The ISO 4217 code amounts are shown in. |
| Time zone | `UTC` | The budget month and report days follow this zone (an IANA name such as `America/New_York`). Changing it needs no rebuild. Daily limits still reset at midnight UTC. |
| Warning threshold | 80% | Owners and admins are notified once a month when spend reaches this share of the budget. |
| Default monthly budget | none | The budget of teams without their own: enforced in Enforce, progress only in Track only. Without one, such teams are tracked but never refused. |

Saving is audited (`costs.settings_update`) and takes a revision check, so two admins can't overwrite each other.

**A team's own mode** (on its page, **Admin → Teams → the team → Overview → Budget → Change budget**, or **Change budget…** in a row's menu on Costs → Budgets) overrides the platform's: *Inherit*, *Off*, *Track only* or *Enforce*. A common rollout:

1. Enter prices; set the platform to **Track only** for a month and compare the Overview with your gateway's bill. Budgets set now show each team's progress without stopping anything.
2. Give a pilot team a budget and the mode **Enforce**.
3. Set the platform to **Enforce** with a default budget, and give larger teams their own.

While the platform mode is Off, the Budget card only shows for teams that have their own mode, and the Overview and Budgets tabs are hidden.

## 3. Reading spend

- **Overview:** total spend over a date range, a daily chart by kind (chat, embedding, SystemOne, moderation), and the top teams, agents and models, each with a CSV download (`GET /v1/admin/costs/report.csv`). The first columns name the row and depend on the grouping (`team_id,team_slug,team_name`; `agent_id,agent_name,team_slug,team_name`; `model_id,model_name,model_kind`; or `day`), followed by `currency,spend`, the spend per kind, `tokens,requests,unpriced`.
- **Budgets:** every active team's mode, budget (plus this month's extensions), month-to-date spend, share and projected month-end; a Track-only budget is labelled "Not enforced". **Change budget…** in a row's menu changes it in place; **Open** goes to the team.
- **Team settings → Usage & limits → Spend this month:** a team's owners and admins see their spend, the budget meter (in Track only, "Tracking: 12% of $5.00 · not enforced"), and spend by agent and model. Editors and members see no money.
- Spend for usage outside agents (searches through `/retrieve`, ingestion) is listed as "Not from an agent".

Figures come from an hourly rollup of the ledger plus the last hour or so read live. Budgets are checked against a figure cached for up to 30 seconds per server, so a busy team can go slightly over its budget.

## 4. What happens at the threshold and at 100%

- **In Track only** nothing below happens: a tracked budget shows progress and never warns, notifies, pauses or refuses.
- **At the threshold:** the team's owners and admins get a notification (in the app and by email; it can't be turned off), once a month. Everyone in the team sees a banner; only owners and admins see amounts.
- **At 100% (Enforce only):** everything that calls a model stops for the team:
  - chats in every channel (the app, the API, the OpenAI-compatible API, the widget and public pages) are refused with 429 `budget_exhausted` (`details: {budget, spent, currency, resetsAt}`); anonymous visitors of public agents see only "This assistant is unavailable right now";
  - searches (`/retrieve`, a knowledge base's Search tab) are refused the same way;
  - new ingestion waits: pending documents stay queued and crawls pause with "Waiting: the team's monthly budget is used up".
- Nothing is deleted or failed. The owners and admins are notified once a month, and the team appears in **Needs attention** on the admin Overview.
- At the start of the next month (in the platform time zone) everything continues by itself.

## 5. Handling a team whose budget is used up

1. Check **Admin → Costs → Budgets** (or the team's Budget card): the spend, the budget and the projection. The Overview, filtered to the month, shows which agents and models used it.
2. Decide:
   - **Grant an extension** (**Grant extension** on the Budget card): an amount added to this month only, with a reason. It lapses when the month ends. Audited as `costs.extension_grant`.
   - **Raise the budget** (**Change budget**): for this and later months. Audited as `costs.budget_update`.
   - **Do nothing:** the team resumes next month.
3. Either change takes effect at once: waiting documents are queued and paused crawls continue within seconds, and chats and searches are admitted again.

If a team was refused but its figures look wrong, check for a price entered with the wrong unit (per token instead of per million) in the model's price history, and delete that row.

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| Spend is zero but models were used | The Prices tab: the models are **Unpriced**, or their prices start after the usage. |
| A team is refused although an admin raised its budget | The team's own mode and budget on its Budget card (its own budget wins over the default). Servers drop cached figures at once on any change. |
| Documents stay queued | The team's Budget card state; maintenance mode; the team's concurrent-ingestion limit. |
| Figures differ from the gateway's bill | Unpriced models, prices dated too late, and embedding units (tokens or characters). Usage purged by retention before costs existed is kept per UTC day, so month boundaries before then are exact only to the day. |

API reference: `api/openapi.yaml`, tag `costs`.
