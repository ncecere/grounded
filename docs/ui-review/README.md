# UI review, 2026-09-26: plan for the owner

Every page was captured (61 screens: owner, editor, admin, signed-out) and reviewed for layout, crowding, order and consistency. The detailed findings are in [`workspace-findings.md`](workspace-findings.md) and [`admin-findings.md`](admin-findings.md). The results of the functional test (every feature exercised in a browser) are in [§5](#5-functional-test-results). I checked the key claims against the code and screenshots.

**How to use this:**
- Pick decisions by ID (**D1…**) and change sets (**W…**, **A…**, **Q…**), or say "all". Nothing is built until you choose.
- "Recommended" marks my view.
- Every change uses bitop-ui components. The ones Grounded doesn't use yet are marked (new).

## 1. What's wrong, in one paragraph

- **Workspace:** the pages are consistent in style but not in structure.
  - The sidebar changes shape between team pages and the rest, and there are two different "Agents".
  - Source, KB and agent detail pages each lay out their facts, actions, settings and delete differently.
  - The agent editor spreads one task over Configure, Test and Share, and Configure is one 2,460 px column.
  - Document tables wrap into 120 px rows, and their Delete action falls off the card.
- **Admin:**
  - There's no landing page, so things that need action (pending domain requests, disabled agents, missing moderation) are scattered.
  - The Agents table overflows at 1280 px and hides the kill switch.
  - Limits appear in three places, three different ways.
  - Moderation is 2,200 px with its tabs half-way down.
  - The logs are mostly sign-in noise.
  - A platform-admin role is granted by a dropdown with no confirmation.

## 2. Decisions (big structural choices)

| ID | Decision | Recommended |
|---|---|---|
| **D1** | **Stable workspace sidebar:**<br>• the team section is always shown (last-used team)<br>• "Agents" (directory) is renamed **Discover agents**<br>• a new **Conversations** page (searchable history) replaces the conversation lists in the directory and Home<br>• recents move to the bottom<br>• team management is consolidated into **Team settings**, with pill tabs Members · Usage & limits · API keys · Crawl domains · Audit log · General<br>• Domain requests and API keys leave the primary nav | ✔ |
| **D2** | **Agent "Build" split view:**<br>• the configuration in `accordion` sections on the left, with the **live Test chat** on the right (`resizable` (new); `drawer` below 1100 px), in the style of ChatGPT's GPT builder<br>• the Test tab goes away<br>• **Audience moves to Share**<br>• tabs become Build · Appearance · Share · Versions · Analytics | ✔ |
| **D3** | **One detail-page template** for source, KB and agent:<br>• header with one contextual primary action and a "…" menu (Pause, Delete)<br>• one facts line<br>• pill tabs Overview · content · type-specific · Settings (always last)<br>• stat cards only in Overview<br>• Settings in sections (General · type-specific · **Danger zone**) with one sticky save bar | ✔ |
| **D4** | **Sheets for leaf records:**<br>• documents, API and widget keys, domain requests, audit entries, crawl runs, models, connections and profiles open in a side `sheet` (view, test, edit) instead of centred dialogs or new pages<br>• containers (sources, KBs, agents, teams, users) keep full pages | ✔ |
| **D5** | **One list template:**<br>• `data-table` (sortable, toolbar filters with `toggle-group`/`combobox`/`date-picker` (new), row "…" menu with delete last, `pagination`, `time` relative dates)<br>• applies to every list and log | ✔ |
| **D6** | **Admin regroup and landing:**<br>• an **Overview** landing (attention queue, platform at a glance, setup checklist for new installs, recent changes)<br>• sidebar groups People · Content · Models · Policy · Monitoring<br>• the two logs merged into **Logs** (Audit · Access); Crawling renamed **Crawl domains** (Requests first); SystemOne under Models<br>• a single shell "Read-only" badge for auditors | ✔ |
| **D7** | **Limits in one shape everywhere:**<br>• 4 groups (`accordion` on the team page) with a **Usage** column<br>• Public access stops repeating the public limits | ✔ |
| **D8** | **Naming pass:**<br>• Discover agents<br>• Crawl domains<br>• "Passages" instead of chunks in the UI<br>• "Signed-in users" for the authenticated audience<br>• "Danger zone"<br>• Enabled/Disabled for switchable objects, Active/Retired/Archived/Suspended for lifecycle<br>• sidebar, page title and breadcrumb always agree | ✔ |

## 3. Change sets

Pick by ID. Priority: H = high user or admin impact. Effort: S = under a day, M = 1–3 days, L = more.

### Quick wins (no decision needed; about 2–3 days in total)
| ID | Change | Pri |
|---|---|---|
| Q1 | **Audit bug:** publishable keys (and moderation policies) show "(deleted)". Add them to the `ListAudit` live-label lookup and link keys to the agent's Share tab. | H |
| Q2 | **Confirm platform-role changes** (admin user page) in a dialog that states what the role can do. | H |
| Q3 | **Admin Agents table fits at 1280 px:** fewer columns, no mid-word wrapping, and the kill switch always visible (row menu plus a danger icon button). | H |
| Q4 | **Document tables:** 1-line titles, URL path only, merged Kind · Size, a fixed "…" row menu (fixes the clipped Delete). | H |
| Q5 | **Honest status:**<br>• Publish is disabled when nothing changed; remove the second Publish in Versions<br>• Editors aren't offered a publish that will fail<br>• fix "Draft — not saved" vs "Draft saved"<br>• no "Mark all as read" on an empty inbox<br>• the email footer on notification settings doesn't claim email is sent when it isn't set up | H |
| Q6 | Logs: **"Hide sign-ins" on by default** (admin audit and user Activity); drop the redundant Who column on Activity. | H |
| Q7 | Crawl domains: **Requests tab first**, defaulting to Pending, with a count. | H |
| Q8 | Moderation: **audience tabs at the top, Providers as a tab**; thresholds shown only when the action isn't Off. | H |
| Q9 | Public access: remove the duplicate limits table and link to Limits › Public agents. | M |
| Q10 | Team overview: an **Agents** stat, whole-card links, "Chunks indexed" dropped; "Add member" moves to Members. | M |
| Q11 | Model display names everywhere (Agents list, New agent dialog), instead of raw ids like `gpt-oss-120b`. | M |
| Q12 | Suspend and Archive become secondary or menu actions, not solid red header buttons. | M |
| Q13 | Date ranges: `date-picker` range plus presets instead of native `mm/dd/yyyy` inputs; analytics range in the URL. | M |
| Q14 | Small visual bugs: clipped welcome avatar in the agent Test tab, truncated hex field on Appearance, "MARKDOWN" casing, breadcrumb stuck on "Overview" for team tabs. | L |

### Workspace (after D1–D5)
| ID | Change | Pri · Effort |
|---|---|---|
| W1 | Sidebar and navigation per **D1**, plus the new Conversations page and the Team settings page. | H · M |
| W2 | Agent editor per **D2** (Build split view, Audience in Share, `model-selector` (new) for chat models, a summary on each collapsed accordion section). | H · L |
| W3 | Source detail per **D3**:<br>• the facts line replaces the Website card<br>• "Upload files" opens a `sheet`<br>• **document detail `sheet`** (metadata, error, passage previews, tags, re-fetch, delete)<br>• Settings in General / Crawling / Danger zone<br>• one save bar | H · M |
| W4 | KB detail per **D3**:<br>• stat cards only in Overview<br>• Try it as one query row with filters in a popover<br>• an explicit "Attach source" button<br>• fusion weights with `slider` (new) | M · S |
| W5 | Team Overview as a dashboard:<br>• 4 linked stats including Agents<br>• a **Needs attention** block (failed syncs, pending domain requests, limits over 80%, disabled agents)<br>• recent changes as compact rows<br>• "Getting started" for new teams | M · M |
| W6 | Lists per **D5**:<br>• sources with Used by and Last sync<br>• KBs with Used by<br>• agents with an **Audience** column and an "unpublished changes" dot<br>• API keys | M · M |
| W7 | Agent Analytics: a 5-stat KPI strip plus sections (Usage · Quality · Moderation · Content), satisfaction with sample size, and the data table behind "Show data". | M · M |
| W8 | Share tab: Audience → Links (short link first) → Widget (only when public; snippet and preview side by side; keys in a `sheet`). | M · M |
| W9 | New data source: two steps, choosing the type then a `sheet` or page with Name, Classification and Profile above the fold. New agent: Knowledge bases second, land on Build with Test open. | M · M |
| W10 | Usage & limits: usage meters sorted by % used, warnings over 80%, static rate limits in a disclosure, public caps hidden when the team has no public agent. | M · S |
| W11 | Chat page: the app sidebar collapses to icons on chat pages (two columns, not three); agent info `hover-card`; conversations grouped by day. | L · S |
| W12 | Public agent page: one header bar instead of two. | L · S |
| W13 | Member (read-only) experience: members see agents they can chat with and KBs they can query; Usage and Audit hidden (DESIGN §3.5). Needs a real member capture first. | M · S |

### Admin (after D4–D7)
| ID | Change | Pri · Effort |
|---|---|---|
| A1 | **Admin Overview** landing per **D6**. | H · M |
| A2 | Sidebar regroup per **D6**, with the rail in a `scroll-area` so the account menu stays pinned at short heights. | M · S |
| A3 | **Logs** page merging Audit and Access:<br>• one filter bar (person and agent `combobox`, action group, date range, channel)<br>• entries open in a `sheet` with before/after<br>• CSV export | H · M |
| A4 | Team detail:<br>• new **Overview** tab (counts, usage vs limits, pending domain requests, recent changes)<br>• Limits grouped with a **Usage** column<br>• Archive in a Danger zone<br>• an owner picker instead of a free-text field | H · M |
| A5 | Catalog (Connections, Models, Embedding profiles):<br>• a record `sheet` with details, test result and edit<br>• row menus<br>• "Used by"<br>• the model form in sections by kind<br>• connection test offers "Add as model" | M · M |
| A6 | Shared sources: a **Used by** column and tab (teams and KBs), with the impact preview before raising a classification. | H · M |
| A7 | Users: role and status filters, a Teams count, relative last sign-in. Teams list: Agents, Sources and Storage columns. | M · S–M |
| A8 | Classifications: show the per-level settings DESIGN §4 defines (retention, anonymous retention, allowed source types, direct `/retrieve`) and counts (models allowed, teams approved). Needs API work. | M · L |
| A9 | Analytics: pill tabs (Overview · Breakdown · Models & tokens · Top agents & teams), team and audience filters. | M · M |
| A10 | SystemOne admin page (being built now) follows the settings template: one card per feature with a switch, model, tunables and a latency note. Shown only when a SystemOne model exists. | H · — |

## 4. bitop-ui: what Grounded would need added

These go to the owner's bitop-ui agent. The rule is that components are added to bitop-ui first.

1. **Merge `bar-chart`** from branch `ragd-p4-analytics` into main. Also merge `ragd-ui-tweaks` if it isn't in yet.
2. **Charts:** a line/area chart and a `sparkline` for trends and stat-card mini-trends.
3. **`data-table` additions:**
   - column visibility (a "Columns" menu, persisted)
   - a faceted filter bar with active chips and "Clear all", synced to the URL
   - a bulk-action bar when rows are selected
4. **Description list** (key/value facts) for detail pages and sheets.
5. **Diff viewer** (text and JSON before/after) for audit entries and version compare.
6. **Meter:** `progress` with warning and critical tones and a limit marker, for usage against limits.
7. **Onboarding checklist** (steps with done states) for "Getting started" and the admin setup checklist.
8. **Sidebar landmark:** `Sidebar` should render an `<aside>` (it's a `div` today; Grounded works around it for axe).

## 5. Functional test results

Every feature was exercised in a browser as owner, editor, member, admin, auditor and signed-out visitor. Full steps and screenshots are in [`functional-findings.md`](functional-findings.md).

**Result:** no blockers and no console errors. There are 45 issues: 4 major, 20 minor and 21 polish. Where an issue duplicates a quick win, the quick win covers it.

| ID | Issue | Fix | Covered by |
|---|---|---|---|
| F-01 | **Major:** public moderation with the chat-as-classifier often passes the 10 s timeout and fails closed. Publish fails, and answers are withheld with a vague message. | Retry once on timeout; a per-provider timeout; the message "Safety check unavailable, try again"; cache a recent successful publish probe. | Foundation |
| F-02 | **Major:** a benign registrar question is blocked. The public policy blocks every category at 50 % with an uncalibrated classifier. | Uncalibrated providers flag instead of block below a higher threshold; a benign domain test set; the category shown in the access-log drill-down. | Foundation, plus the dev config (see below) |
| F-03 | **Major:** a platform role is granted by a dropdown without confirmation. | Confirmation dialog. | Q2 |
| F-04 | **Major:** an agent-editor save conflict throws away the user's text. | Keep the local value; offer "Keep mine / Use theirs" with the `diff-viewer`. | Foundation |
| F-05 | Several fields show only a red border. | Pass validation messages into the field error. | Foundation |
| F-06 | Upload tags typed without pressing Enter are dropped. | Commit pending tag text before uploading. | Foundation |
| F-07 | The public agent's "Team address" asks anonymous visitors to sign in. | Serve the public page on team URLs of public agents. | W8 |
| F-08 | A widget origin without a scheme silently becomes `https://`. | Require a scheme and show the normalised origin. | W8 |
| F-09 | The widget on a disallowed site opens a broken panel. | Check the origin before rendering the launcher. | W8 |
| F-10 | Chat errors look like answers, with rating buttons and "Answer ready". | An error style, no ratings, and an error announcement. | Foundation |
| F-12 | The breadcrumb doesn't follow team tabs. | — | Q14 |
| F-13 | "Mark all as read" only marks the filtered type. | Label it "Mark these as read", or mark all. | Q5 |
| F-14 | The crawl preview lists different pages from the ones the crawl fetches. | Make the preview use the crawl's ordering and filters. | W3 |
| F-15 | The publish dialog always says "Team members". | Name the audience. | Q5 |
| F-16 | An archived team gives the owner the wrong reason in the agent editor. | Show "This team is archived". | Foundation |
| F-17 | Limits pages have no unsaved-changes guard. | A navigation guard on every sticky-save page. | Foundation |
| F-18 | An agent moderation override has no effect when the audience's policy has no provider, and nothing says so. | A warning, with a link to Moderation. | W2 |
| F-19 | The classification-raise dialog gives the wrong reason. | Use the per-agent reasons from the table. | W3 |
| F-21 | A paused upload source still offers the drop zone; the button is labelled "Activate". | Disable the drop zone; use "Resume". | W3 |
| F-22 | The team switcher doesn't follow the chat page's team. | — | W1 |
| F-23 | The public-access switch turns off every public agent with no confirmation. | Confirmation naming the affected agents. | Foundation |
| F-24 | Members can see Usage & limits. | Hide it (DESIGN §3.5). | W13 |
| F-25 | API keys can't be restricted to agents; service keys have no responsible contact (DESIGN §3.3). | API and UI work. | W6 |
| F-26 | "Draft saved" and the summaries go stale while a field is invalid. | Show "Not saved: fix the highlighted field". | W2, W4 |
| P-01–P-21 | Polish: ⌘K doesn't find agents, KBs or sources by name; publish-probe feedback; self-suspend and sole-owner leave are offered; the not-found page; raw parser errors; "Cancelled Cancelled"; no-team Home copy; toasts covering buttons; missing confirmations for detach and invite revoke; an alt-text-only chunk; the widget preview limit; duplicate domain requests; no admin badge for pending requests; and others. | See the findings file. | Foundation, plus the matching W and A items |

**Dev configuration, owner's call:** on dev, the SystemOne moderation model on the Spark had no false positives on 20 benign messages and a p95 of 1.9 s, against 11.2 s for the classifier, so it would fix F-01 and F-02 on dev at once. However, it would send public chat messages to the owner's SystemOne server (`systemone.example.net`) instead of the university's AI gateway. Whether that is acceptable is a data-handling decision.

## 6. Suggested order

1. Quick wins **Q1–Q14** (no decisions needed).
2. Decisions **D1–D8**; then **W1, W2, W3** (the builder's daily path) and **A1, A3, A4** (the admin's).
3. The remaining W and A items. The bitop-ui additions from §4 go in first, wherever a change depends on one.

## 7. Status (built, 2026-09-27)

The owner approved everything. All of it is built and merged:

- **Decisions:** D1–D8.
- **Change sets:** quick wins Q1–Q14, workspace W1–W13, admin A1–A10.
- **Functional findings:** F-01…F-26 and P-01…P-21.

The last two change sets done were A6 (shared-source "Used by" tab) and A9 (analytics team and audience filters).

The final verification ([`verification.md`](verification.md)) checked 117 page/persona combinations at 1440 and 1280 px. It found 0 WCAG A/AA violations, no console errors, and old URLs redirecting correctly. The issues it found were fixed afterwards; screenshots are in `/tmp/ui-final/fixed/`.

Known limits:
- The admin Overview doesn't flag models that fail their tests, because test results aren't stored.
- Token use in analytics can be narrowed by team but not by audience, because the usage ledger doesn't record the audience.

The bitop-ui components used here live on the bitop-ui branch `ragd-integration`, which is waiting for the owner to merge it. These bitop-ui follow-ups remain:
- sidebar labels are clipped without an ellipsis (Grounded has a CSS workaround);
- `color-field`'s hex input is too narrow;
- `resizable` gets its first-render size wrong for a panel without `defaultSize`.
