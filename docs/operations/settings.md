# Admin → Settings

**Admin → Operations → Settings** (`/admin/settings`, or "settings", "time zone" or "currency" in ⌘K) holds the platform's general settings in one place (v0.4.2). Platform admins change them; platform auditors see the page read-only, with the reason.

## Money and time

| Setting | Default | Meaning |
|---|---|---|
| Currency | `USD` | The ISO 4217 code amounts are shown in (a code that names a currency: "XYZ" is refused). It's a display code only: nothing is converted, so enter prices in it. The budget field's label follows it once it's a valid code. |
| Time zone | `UTC` | The budget month, cost report days, the date agents are told ("Today is …") and the day saved answers to questions about relative dates are kept for follow this zone (an IANA name such as `America/New_York`). Changing it needs no rebuild. Daily limits still reset at midnight UTC. |
| Default monthly budget | none | The budget of teams without their own: enforced while cost tracking is Enforce, progress only in Track only. Without one, such teams are tracked but never refused. |

They're stored with the cost settings: saving is audited as `costs.settings_update` and takes a revision check, so two admins can't overwrite each other. Before v0.4.2 they were under Admin → Costs → Settings, which keeps the **cost tracking mode** and the **warning threshold** ([`costs.md`](costs.md) §2).

## Features

The platform's switches, each applied at once and audited; turning one off asks first and says what stops:

- **Evaluations** (on by default): evaluation sets for knowledge bases and agents ([`evaluations.md`](evaluations.md)).
- **MCP server** (off by default): AI tools connecting to `<APP_URL>/mcp` ([`../mcp.md`](../mcp.md)).
- **OAuth sign-in for MCP clients** (experimental, off by default): AI tools signing in as the person using them.
- **Saved answers** (on by default): reusing answers to the same question ([`../answer-cache.md`](../answer-cache.md)).

Admin → Overview → Features still shows whether each is on, with a link here. Before v0.4.2 the switches were on the Overview.

## From the environment

The instance name (`INSTANCE_NAME`), organisation name (`ORG_NAME`), theme (`UI_THEME`), logo (`UI_LOGO_URL`) and help link (`SUPPORT_URL`) are shown with the variable that sets each. They're changed in the deployment's environment and apply after a restart.

## Other settings

Areas that keep their own pages are linked at the end: Costs (mode and warning threshold), Moderation, Public access, Limits, Retention, Reranking, SystemOne, and Parsing & OCR.
