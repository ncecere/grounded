# Grounded workspace UI: information architecture review

Date: 2026-09-26. Scope: the workspace (non-admin) UI, public pages and create dialogs. This is a review only; no code was changed.
Inputs: `/tmp/ia-review/w01–w23, m01–m03, p01–p02, d01–d02`, `web/src` (pages, `components/layout`, `lib/tabs.ts`, `router.tsx`), `docs/DESIGN.md` §2/§3/§7, `docs/phase4-publishing.md` §10, and `/tmp/ui-review/NOTES.md`.

Caveats:
- **The member screenshots are an Editor, not a plain member.** `m01`–`m03` show Blair as "Your role: Editor". A read-only member view wasn't captured, so the member findings below come from code (`team/common.tsx`, `overview/page.tsx`) and DESIGN §3.5. Capture a `member` account before acting on them.
- The `w*`, `a*` and `d*` shots are 1280 px wide, not 1440. Layout judgements allow for this.
- NOTES.md items already fixed (seen in the shots): the audit log now has a Who column, filters and linked targets; the team overview link cards are gone; the web Pages list is paginated at 50; source, KB and team pages use pill tabs.

Where a recommendation uses a bitop-ui component, it's named in `code` style. Grounded uses about 55 of bitop-ui's 115 items today. The ones it doesn't use yet are marked **(new to Grounded)**.

---

## 1. Top 10 problems, ranked by user impact

| # | Problem | Evidence | Impact |
|---|---|---|---|
| 1 | **The sidebar changes shape depending on the route.** On Home, Agents and Chat the team section disappears and "Recent conversations" takes its place. On team pages it's the other way round (`sidebar.tsx`: `{!slug && <RecentConversationsNav/>}`, `{slug && <team section>}`). There are also two items called **"Agents"** that mean different things: the chat directory and the team's agent builder. Users lose the way back to their team's content everywhere except through the team switcher or the Home "Your teams" card. | w01, w02, w23 vs w05 | H: this is the basic wayfinding problem, and every builder hits it daily |
| 2 | **The agent editor splits one task over three tabs, and Configure is a 2,460 px stack of 7 cards.** Test is a separate tab, so you can't change instructions and try them side by side. Audience (who can chat) sits at the bottom of Configure while links and the widget live in Share. Appearance saves live while Configure is versioned. "Pinned filters" and "Advanced" are each a whole card wrapping a single disclosure. | w20-configure, w20-test, w20-share, w20-appearance | H: this is the primary builder task |
| 3 | **Detail pages don't share a template.** Source: header, type chips, tabs, then stat cards inside the Overview tab. KB: header, chips, stat cards *above* the tabs, repeated on every tab. Agent: no facts at all. Header actions vary: "Sync now" for a web source, nothing for an upload source or a KB, "Chat · Publish · …" for an agent. Deletion is under "Manage source" on sources and "Danger zone" on KBs, and in a "…" menu on agents. | w10, w13, w16–w18, w20-* | H: users relearn every page |
| 4 | **Document tables are unreadable at scale.** The Page column gets about 190 px, so titles wrap 3–4 lines and full URLs wrap under them. Kind, Size, Pages, Chunks and Tags (mostly "—") take the width. The **Tags · Delete row actions overflow off the card** ("Delete" is clipped in w11, "D" in w14). At about 120 px a row, 50 rows make a 6,425 px page. There's no document detail view: you can't see chunks, errors or metadata. | w11, w14 | H: this is the core ingestion workflow |
| 5 | **Status and primary actions don't tell the truth.** **Publish** is always a filled primary button, even when "The draft matches the live version", and Versions has a second "Publish…" button. The header says "Draft saved" while the Test tab says "Draft — not saved". An Editor sees Public selected with "Not available: only team admins and owners can publish beyond the team", and Publish is still enabled. "Mark all as read" is the primary button on an empty inbox. The notification settings footer says required notifications are "always sent … by email" directly under "Email isn't set up". | w20-versions, w20-test, m03, w03, w04 | H: this erodes trust and causes failed publishes |
| 6 | **Conversations appear in 4 places, and there's no real history page.** They're in the sidebar recents, the Home card (6 items), the **Agent directory** (14 rows under 3 agent cards, so the directory is mostly a history list) and the chat page's own list, which sits next to the sidebar list, giving 3 columns. There's no search. | w01, w02, w23 | M–H |
| 7 | **The team Overview mixes a dashboard with team management.** Its pill tabs (Overview, Members, Usage & limits, Audit log) repeat the sidebar's "Overview". The breadcrumb stays on "Overview" on every tab. "Add member" is the header action on all four tabs. The stats leave out **Agents**, the main object, and use the jargon "Chunks indexed". Recent activity is a smaller copy of the Audit log tab. | w05–w08, m01 | M |
| 8 | **The audit log is noisy, and one entry is wrong.** Each Action cell has two lines (label plus `agent.publish` code). The page shows about 50 rows with no paging (3,465 px). The date fields are native `mm/dd/yyyy` inputs. **Bug:** a publishable key that exists ("Widget demo") shows as "publishable key (deleted)". The `ListAudit` query in `internal/store/queries/audit.sql` has no `WHEN 'publishable_key'` branch in its live-label `CASE`, so `live_label` is '' and `TargetExists` is false (`internal/httpapi/audit.go:130`). `moderation_policy` targets have the same gap. | w05, w08, m01 | M (and the bug misleads owners about security objects) |
| 9 | **The create dialogs hide required fields.** In "New data source", Classification and Embedding profile are below the fold, and the Website variant adds URLs, mode and schedule to the same scrolling dialog. "New agent" shows the raw model id `gpt-oss-120b`, where the rest of the app says "GPT-OSS 120B (gateway)", and puts Knowledge bases below the fold. | d01, d02 | M |
| 10 | **The metrics pages are walls.** Usage & limits: three columns plus an orphaned fourth group ("Public agents") under column 1, and live meters mixed with static caps ("Up to 300 per minute"). Nothing near its limit is surfaced. Agent Analytics: 13 stat cards in 4 groups, a chart, then 6 tables (2,679 px), with native date inputs next to a Range select. "Satisfaction 100%" rests on 1 vote. | w07, w20-analytics | M |

What users will look for and can't find:
- A document's detail: chunks, errors, metadata, re-index.
- Relationships: which KBs use a source, which agents use a KB.
- The allowlist ("which domains can I already crawl?") on Domain requests.
- An audience column on the Agents list.
- Conversation search.
- Team settings (name and description) for owners.

---

## 2. Proposed information architecture

### 2.1 Sidebar (workspace mode): stable, and the same on every page

```
[Team switcher: remembers the last team]
WORKSPACE
  Home
  Discover agents        (was "Agents": the directory; renamed to end the collision)
  Conversations          (new: full, searchable history; replaces the long list in the directory)
<TEAM NAME>              (always shown for the current or last team, not only on /teams/*)
  Overview               (dashboard only, no tabs)
  Data sources
  Knowledge bases
  Agents                 (the builder)
  ── separator ──
  Team settings          (pill tabs: Members · Usage & limits · API keys · Crawl domains · Audit log · General)
RECENT                   (last 5 conversations, collapsible; shown on every page, hidden when the sidebar is collapsed)
```

- Use `app-shell` sections and keep one order everywhere. Recents move to the bottom so they don't push team navigation around.
- Show **member** role users a smaller team section: Overview (agents they can chat with plus KBs they can query), Knowledge bases (Try it only), Agents (chat links, no builder), and Team settings with Members (read-only) and API keys (query only). Hide Data sources unless the role can read them. Hide Usage and Audit log, since DESIGN §3.5 gives members no usage or audit access. **Check:** `overview/page.tsx` shows the Usage tab whenever `role` is set, which includes members.
- Move Domain requests out of primary navigation. They're a rare, web-source-only task. Put them in **Team settings › Crawl domains**, which should show the allowlist *and* requests. Also link "Request this domain" inline from the web-source form when a URL isn't allowed. That inline link is the real entry point.
- API keys become a Team settings tab: they're a developer and admin task. Widget keys stay under the agent's Share tab.
- Notifications: the bell opens a `popover` with the latest 5 and a "View all" link to the inbox page. Notification settings stay in the user menu.
- Make the chat page (w23) collapse the app sidebar to icons by default (`app-shell` collapsed), so it's 2 columns, not 3. Its own conversation list stays.

### 2.2 Team Overview (a dashboard, with no tabs)
1. Header: team name, role badge, classification badge. The primary action depends on state: "New data source" for an empty team, otherwise "New agent".
2. "Getting started" checklist (only for a new team; this is the owner's decision).
3. `stat-card` × 4, each with a whole-card link: **Agents** (live/total), Knowledge bases, Data sources (with failed-sync count), Conversations (7 days). Drop "Chunks indexed" from here; it belongs on source and KB pages as "passages".
4. **Needs attention** (new): failed syncs, pending domain requests, limits over 80%, agents disabled by the platform. Use `item` rows, and show nothing when all is well.
5. Recent activity: 5 rows as compact `item` rows ("Alex published Records helper · `time` 2 h ago"), with a link to Team settings › Audit log.

Members, Usage & limits and Audit log move out of Overview into Team settings. This removes the Overview-within-Overview duplication and gives "Add member" one home (the Members tab).

### 2.3 Detail-page template (source, KB, agent)
```
PageHeader   title · ≤2 badges (classification, status) · one-line description
             actions: ONE contextual primary · secondary · "…" `menu` (Pause, Duplicate, Delete [danger])
Facts strip  one inline line of key facts (type · embedding profile · N documents · last sync · used by N agents [`hover-card`])
Pill tabs    Overview (default) · <content tab> · <type-specific> · Settings (always last)
Content      Overview = stat-cards + recent history; content tab = data-table; Settings = sections
```
- Stat cards appear only inside the Overview tab, never above the tabs. They shouldn't repeat on every tab, as they do on KB w16–w18.
- **Settings tab:** use `accordion` (multiple open), or short labelled sections: **General** (name, description, classification), then type-specific settings (Crawling, Retrieval), then **Danger zone** (pause or disable and delete), always with that name and always last. One `save-bar` (sticky) per tab, not one Save button per card: w12 has "Save changes" *and* "Save crawl settings".
- Primary action by object: Web source → "Sync now". Upload source → "Upload files" (opens a `sheet` with `drop-zone` and tags). KB → "Try it" is a tab, so the header primary is "New agent from this KB". Agent → "Publish", enabled only when there are unpublished changes, with a `tooltip` giving the reason when it's disabled.

### 2.4 List-page template
```
PageHeader   title · ≤1-line description (move longer concept text to an info `hover-card` "What's a data source?")
Toolbar      search (data-table filter) · `toggle-group` quick filters (Type: All/Website/Upload; Status) · result count
`data-table` name column ≥ 35% width, one secondary line; ≤ 6 other columns; numeric right-aligned; sortable headers;
             row actions in a "…" `menu` (and `context-menu` on right-click); row click opens detail (or a `sheet` for leaf records)
`pagination` / load more; `query-state` for loading, error and empty; `empty-state` with the create action
```
- Leaf records (documents, API keys, widget keys, audit entries, domain requests, notifications) open in a **`sheet`** from the right, so you don't leave the list. Containers (sources, KBs, agents) open full pages.
- Dates are relative with an absolute tooltip, using `time` ("2 h ago").

### 2.5 Naming
| Now | Proposed | Why |
|---|---|---|
| Agents (workspace) | Discover agents | collides with the team's "Agents" |
| Domain requests | Crawl domains | it's about what you can crawl; requests are one part of that |
| Chunks / Chunks indexed | Passages | the UI already explains chunks as "Searchable passages" |
| Manage source | Danger zone (plus a Status row) | match the KB page |
| Authenticated (audience) | Everyone who signs in | "Authenticated" is jargon; the admin tabs already use `all_authenticated` |
| Results (top-k) | Passages per search | the same setting is labelled 3 ways today |
| Your teams **3** (directory) | From your teams · 3 agents | the count is of agents, not teams |
| Kind `MARKDOWN` | Markdown | casing differs from `PDF` / `HTML` |
| Recent activity | Recent changes | it is the audit log, not usage |

---

## 3. Page-by-page findings

Format: **Keep / Change**, then recommendations, then [priority H/M/L · effort S/M/L].

### w01 Home: *Keep, trim*
- The sidebar recents, the Home "Recent conversations" card (6 rows) and the directory all list the same conversations. Keep **one** "Continue where you left off" block (3 rows, using `item`) and link to Conversations. [M · S]
- The "Your teams" card for a single team is a big card with one entry. Show teams as compact `item` rows, with a card grid only for 3 or more teams. Add per-team quick links (Sources, KBs, Agents) so Home stays useful while the sidebar is still team-less. [M · S]
- Order: Agents first (the most common task), then Continue, then Your teams. [L · S]

### w02 Agent directory: *Change*
- The page is 80% conversation history. Remove the conversation list; it moves to the new Conversations page. [H · S]
- The design intends three groups: From your teams / Shared with everyone who signs in / Public. Show them as sections with counts. When one is empty, hide it rather than showing nothing. [M · S]
- Filters: replace the Team `select` with a `toggle-group` (All · Your teams · Everyone · Public) plus search. Use `combobox` for teams only when there are more than 5. [M · S]
- Cards: add an audience badge and a `hover-card` on the name showing the description, the KBs it answers from and the team. [L · S]
- Fix "Your teams 3". [L · S]

### w03 Notifications inbox: *Change (small)*
- Put the All/Unread tabs first, with the Type filter inline to their right (`toggle-group` + `select`), not stacked above them. [L · S]
- Disable or hide "Mark all as read" when nothing is unread, and make it secondary. The primary action on an inbox is none. [M · S]
- Add a bell `popover` with the latest 5 so people rarely need this page. Use `time` for relative dates and `item` for rows. [M · M]

### w04 Notification settings: *Keep, fix copy*
- When email isn't configured, hide the Email column or disable it with a `tooltip`. The footer claim "always sent … by email" contradicts the alert above it. [M · S]
- Group the 9 rows under small headings: Your teams (invites, role), Sources (sync failed, classification lowered, domain decided), Agents (disabled, published beyond team), Limits. [L · S]
- The locked "Required" toggles look like faded enabled toggles. Use a lock icon plus "Always on" text instead of a disabled switch. [L · S]

### w05 Team overview (Overview tab): *Change* (see §2.2)
- Remove the page tabs: move Members, Usage and Audit to Team settings. The breadcrumb reads "Overview" on every tab today (w06–w08). [H · M]
- Add an Agents stat card and make the cards links (`stat-card` whole-card link, as NOTES.md already decided). Drop "Chunks indexed". The "Knowledge bases 2" card has an empty lower half, so give every card a hint line, e.g. "1 used by agents". [M · S]
- Recent activity: 5 compact `item` rows with `time`, not a 5-column table with a "Show" column. [M · S]
- Add a "Needs attention" block. [M · M]
- Header primary: "Add member" is a management action. Use "New agent" or "New data source" here. [M · S]

### w06 Members: *Keep, move to Team settings › Members*
- "Add member" belongs in this tab's card header, not the page header. [M · S]
- "Leave team" and "Remove" are plain text on the right. Move them into a "…" `menu` with a danger tone. The `ConfirmMutationDialog` confirmation already exists; keep it. Stop showing a role `select` on your own row when you're the last owner: show a plain "Owner" badge. [M · S]
- Empty "Open invites" takes 200 px. Show it only when there are invites, or as a single line ("No open invites"). [L · S]
- For more than 20 members, use `data-table` with a search filter. [L · M]

### w07 Usage & limits: *Change*
- Split it into **Usage** (meters: storage, documents, sources, KBs, agents, today's pages, queries and tokens) and **Limits** (static caps: per-minute and per-person, public agent caps). Put Limits in a `disclosure` ("Rate limits and public caps"). [M · M]
- Sort meters by % used and highlight anything over 80% with a warning tone on `progress`. The empty-looking 0-of-N bars are noise. [M · S]
- Use a fixed 3-column grid, not 3 columns plus an orphaned "Public agents" group, and hide the public caps when the team has no public agent. [M · S]
- Put the "Ask a platform admin" text next to a "Request more" link to TEAM_REQUEST_URL or support. [L · S]

### w08 Team audit log: *Change*
- **Bug:** add `WHEN 'publishable_key' THEN (SELECT pk.name FROM publishable_keys pk WHERE pk.id = ids.target_uuid AND pk.revoked_at IS NULL)` to the `ListAudit` `CASE` in `internal/store/queries/audit.sql`, and a `moderation_policy` branch too. Then link the publishable key target to the agent's Share tab in `components/audit/target.tsx`. Add a test next to `web/src/test/overview-audit.test.tsx`. [H · S]
- One line per cell: show the human label only. Move the `agent.publish` code into the details `sheet`, or a `tooltip` on hover. Replace the "Show" column with row click that opens a `sheet` with the before/after `code-block`. [M · S]
- Filters: `date-picker` in range mode **(new to Grounded)** with presets in a `toggle-group` (Today · 7 d · 30 d), and `combobox` for Action (grouped by object) and Person. [M · S]
- Page with `data-table` cursor pagination or "Load more" (25 rows); group rows by day with a sticky day header. [M · M]

### w09 Data sources list (owner) / m02 (editor): *Keep, polish*
- Columns: drop Embedding profile from the list (it's a detail-page fact) and merge Documents, Chunks and Size into one "Content" column ("38 docs · 5.0 MB"). Add **Used by** (number of KBs) and **Last sync** as its own sortable column. [M · S]
- Move the header description into an info `hover-card` and keep one line. [L · S]
- Use `data-table` with a `toggle-group` Type filter once there are more than 10 sources. [L · M]
- Surface failed sync status here (a red badge plus the error in a `tooltip`). [M · S]

### w10 Web source › Overview: *Change (template)*
- Replace the "Website" chip and the "Embedding profile: …" chip with a single facts strip. The Website card (Start URL / Mode / Schedule) repeats Settings. Fold it into the facts strip ("registrar.example.edu · crawl, depth 2, ≤60 pages · weekly · next Oct 3"). [M · S]
- Stat cards: 4 in a fixed grid is fine. The "Last sync" card squeezes two dates into one card, so move it into the facts strip and give that slot to "Used by N KBs". [L · S]
- Crawl history: give it pagination, use `time` for Started, and open a run's host errors in a `sheet` on click. The Truncated footnote should be a `tooltip` on the badge. [L · S]
- Header: move Pause and Delete into a "…" `menu` next to "Sync now". [M · S]

### w11 Web source › Pages: *Change* [H]
- The title column should take the remaining width and **clamp titles to 1 line**. Show the URL *path* only (`/assets/pdfs/feewaiver.pdf`), in muted text on one line, with the full URL in a `tooltip`. [H · S]
- Remove the Pages and Tags columns (mostly "—"; tags show as chips under the title when present). Merge Kind and Size ("PDF · 592 KB"). [H · S]
- Row actions: one "…" `menu` (View, Tags, Re-fetch, Delete) with fixed width. **Fixes the clipped Delete.** Also add `context-menu`. [H · S]
- Row click opens a **document `sheet`**: metadata, status or error, chunk previews in a `scroll-area`, tags (`tag-input`), Delete. This is the missing document detail. [H · M]
- Use `data-table` (sortable Title, Updated, Size; row selection for bulk delete and tag), a `toggle-group` status filter (All · Ready · Failed · Skipped) with counts, and put the count on the left of `pagination` on one line ("1–50 of 58" wraps today). [M · M]

### w12 Web source › Settings: *Change*
- There are 3 cards with 2 Save buttons. Split them into `accordion` sections, or keep them stacked with headings: **General** (name, description, classification), **Crawling** (what to index, URLs, advanced, preview, tags, schedule), **Danger zone** (pause, delete). Use one sticky `save-bar` per form. [M · M]
- "Preview pages" is a strong feature hidden mid-form. Show the results in a `sheet` next to the form. [L · S]
- Rename "Manage source" to "Danger zone". Show the Pause status as a `switch` row ("Paused / Active"), with Delete at the end. [M · S]
- Show the classification warning (the "Raising it is blocked …" text) only when the user changes the value, rather than always. [L · S]

### w13 Upload source › Overview: *Change*
- The upload `drop-zone` belongs in the **Documents** tab, or better, in the header primary "Upload files", which opens a `sheet` with tags and `drop-zone` and closes to the Documents tab with progress (`progress` per file). Overview then becomes stats plus recent uploads, matching the web source's crawl history. [M · M]
- There are 3 stat cards here and 4 on the web source. Use the same grid and add "Used by N KBs". [L · S]

### w14 Upload source › Documents: *Change*
- Same fixes as w11: the clipped "D"elete, lowercase Kind, 1-line titles with the file name muted, a "…" row menu, and a document `sheet`. [H · S]
- Add a "Replace file" action to the sheet. The replace-on-same-name behaviour is only described in upload copy today. [L · S]

### w15 Knowledge bases list: *Keep, polish*
- Add a **Used by** column (agents, with a `hover-card` listing them); it's what people ask before changing a KB. Drop "Results per query" (a setting, not a list fact) and Embedding profile. [M · S]
- Show the Sources column as "3 sources" with a `hover-card` listing names; wrapped comma lists take 3 lines today. [L · S]

### w16 KB › Try it: *Change (template)*
- Move the stat cards out from above the tabs (see §2.3). "Results per query 8" isn't a metric: put it in the facts strip or Settings. The facts strip is "Open · Nomic 768 (gateway) · 1 source · 58 docs · used by 2 agents". [M · S]
- Try it layout: put the query `input` and a Search button on one row (`input-group`), with a top-k `number-input` and Filters as a `popover`, not a disclosure block. Results show below with `sources`/`inline-citation`-style cards. Today it's 4 stacked rows before any result. [M · S]
- Disabled Search looks like the primary colour at low contrast. Keep it enabled and validate on submit, or use the standard disabled style. [L · S]

### w17 KB › Data sources: *Keep, polish*
- Add an explicit "Attach source" button (header of the card, opening a `combobox` in a `popover` or `dialog`). The only affordance today is the "can't be attached" disclosure. [M · S]
- "3 sources can't be attached · Why?": make each reason a `tooltip` on a disabled row in the attach picker instead of a separate disclosure. [L · S]
- Add Documents and Last sync columns so the tab explains the KB's content. [L · S]

### w18 KB › Settings: *Keep, align*
- Match the template: General (name, description), Retrieval (passages per search `number-input` or `slider` 1–50, fusion weights with `slider` **(new to Grounded)**; NOTES.md says fusion weights aren't editable), then Danger zone. Use a sticky `save-bar`. [M · S]
- The Danger zone is already right. Use it as the model for sources. [—]

### w19 Agents list (team): *Change*
- Add an **Audience** column (Team / Signed-in / Public badge) and an "Unpublished changes" dot next to Status. Audience is the most consequential fact after status. [H · S]
- Model: show the display name everywhere ("GPT-OSS 120B (gateway)"; row 3 shows the raw `gpt-oss-120b`). [M · S]
- Version and Updated could merge ("v2 · 7:05 PM"). The accent colour square next to the name is decorative. Use the agent's avatar (`avatar`) for recognition. [L · S]
- Row actions: "Chat" plus a "…" `menu` (Test, Share, Duplicate, Disable). [L · S]

### w20 Agent editor (all tabs): *Change* [H]
Proposed structure, using pill tabs:

| Tab | Content |
|---|---|
| **Build** (default) | `resizable` **(new to Grounded)** split. Left: configuration in `accordion` sections (Instructions (open) · Knowledge & model · Retrieval & grounding (with Pinned filters folded in) · Moderation · Advanced). Right: a **live Test chat** of the draft, with a "Reset" button. The panel sizes persist. Below about 1100 px, the Test panel becomes a `drawer` **(new to Grounded)** from the right, opened by a "Test" button. |
| **Appearance** | As today: the form with a live preview. Add the note "Changes go live when saved, and are not versioned" to the tab label area as a `badge` ("Live"), not an alert. |
| **Share** | **Audience first** (moved from Configure), then Links, Widget (keys, embed, preview). |
| **Versions** | List plus a compare view. |
| **Analytics** | See below. |

- This removes the separate Test tab (6 tabs become 5) and the need to jump between Configure and Test. It matches the ChatGPT GPT builder model. [H · L]
- Header: badges are **Live** and "v2" only. Show "Unpublished changes" (already in code) instead of "Draft saved", and show save state as small text by the tabs. **Publish** is disabled with a `tooltip` "No changes since v2" when there's nothing to publish. Remove the second "Publish…" in Versions. [H · S]
- For Editors, when the draft's audience is beyond Team, turn the primary into "Publish to team only" or disable it with a reason (m03). Don't let them start a publish that will fail. [H · S]
- Chat model: `model-selector` **(new to Grounded)**, which gives grouped, searchable models with capability badges (classification ceiling, tools), instead of a long `select` label "(up to Sensitive, tools)". [M · M]
- Knowledge bases: use `item` rows with a checkbox and a `number-input` for passages, and show "Open · 1 source" as a `hover-card`. [L · S]

**w20-configure:** 7 cards and 2,460 px. The accordion shows each section's summary when collapsed (e.g. "Search every answer · answer only from sources · title+snippet+link"). `disclosure` already supports this. "Pinned filters" and "Advanced" stop being card-wrapped single disclosures. Audience moves to Share. [H · M]

**w20-appearance:** Keep the two-column form with preview. Fix the truncated hex field ("#0021a5 (defau"): widen it, or show "(default)" as helper text. Use `color-field` as is. The profile fields (name, address, description) are identity, not appearance. Consider moving them to a small "Details" section at the top of Build, or keep them and rename the tab "Profile & look". [L · S]

**w20-test:** It becomes the right panel of Build. Bugs: the welcome avatar is clipped at the top of the card, and the composer sits outside the card. The "Draft — not saved" badge contradicts the header. [M · S if the tab stays; otherwise part of the Build work]

**w20-share (2,031 px):** Order: **Audience** (radio cards, each with why not allowed) → **Links** (show the *short* address as the primary `copy-field`; team and stable addresses go in a "More addresses" `disclosure`) → **Widget** (hide unless Public; keys `data-table`, embed position `toggle-group`, then the snippet (`code-block`) and the preview **side by side**, since the preview occupies 40% width with empty space today). Widget key row actions go in a "…" `menu`. Create and edit a key in a `sheet`. [M · M]

**w20-versions:** Keep the list. Add "Compare with draft" (a diff **(missing in bitop-ui)**), open "View" in a `sheet`, and show the note on one line. "Revert draft" needs a confirmation `dialog`. [M · M]

**w20-analytics (2,679 px):**
- Put the date range in one `date-picker` range **(new to Grounded)** plus a `toggle-group` of presets (7 d · 30 d · 90 d), right-aligned in the tab toolbar, instead of a Range select and 2 native inputs.
- Show a KPI strip of 5 `stat-card`s: Conversations, Answers, Satisfaction (with n), Refusal rate, p50 latency. Move the other 8 into sections.
- Use pill **sub-sections** as a `toggle-group` view switch rather than nested tabs: Usage · Quality · Moderation · Content. Content holds the Top cited documents and Feedback reasons.
- The day table under the chart goes in a `disclosure` ("Show data").
- Label "Satisfaction 100%" with its sample size ("1 rating").

[M · M]

### w21 Domain requests: *Change: move to Team settings › Crawl domains*
- Show the allowlist the team can already crawl (read-only list) above the requests. That's the question people come with. [M · S]
- Put "Request a domain" in that tab and link it inline from the web-source URL field when validation fails. [M · M]
- Columns: Requested by and Review each have 3–4 lines. Use a compact row plus a `sheet` for the reviewer note and history. Use `time` for dates. [L · S]

### w22 API keys: *Keep, move to Team settings › API keys*
- Use `data-table`. Put Type and Scopes in one column ("Personal · query"). Show the key prefix without the ellipsis, as a copyable `snippet`-style id. Move Revoke into a "…" `menu` with the danger tone. [L · S]
- Show when a key expires soon (warning badge), and who owns it (personal keys belong to a person). [L · S]
- Explain the difference between widget keys (under agent Share) and API keys in a `hover-card` on the page description. [L · S]

### w23 Chat: *Change (layout)*
- There are 3 columns: the app sidebar with recents, the conversation list and the thread. Collapse the app sidebar to icons on chat routes, or hide sidebar recents on chat pages. [M · S]
- Add a small header actions area to the agent header: an agent info `hover-card` (team, what it answers from, audience), "New conversation" (move it from the list header into the chat header for discoverability), and a Share link for published agents. [L · S]
- The conversation list shows times only. Group it by day (Today / Yesterday / Earlier), with `scroll-area` and `time`. [L · S]

### m01 Team overview as Editor: *Change*
- An Editor sees the same page minus "Add member". After §2.2, an Editor sees the dashboard plus Team settings (Members read-only, Audit log read, API keys). A plain **member** should see Overview reduced to "Agents you can chat with" plus "Knowledge bases you can query". Hide Usage (DESIGN §3.5 gives members none) and Audit. **Verify:** the Usage tab is shown for any `role` today. [M · S]
- Same audit "(deleted)" bug. [H · S]

### m02 Data sources as Editor: *Keep*
- Correct: Editors can create sources. For a plain member, decide whether Data sources shows at all. DESIGN gives members query-only access, so hide it or make it read-only with no "New" button. [M · S]

### m03 Agent editor as Editor: *Change*
- The Audience cards show "Not available" in body text on the currently selected option (Public). Show the constraint as a disabled state plus a `tooltip`. If the current published audience is beyond the Editor's rights, show an `alert` at the top: "Only admins and owners can change this agent's audience or publish it beyond the team." Adapt Publish (see w20). [H · S]
- Editors can't see the "…" menu (correct), so the header right side shrinks. That's fine. [—]

### p01 Sign-in: *Keep*
- Dev-only list, fine. For production OIDC, one "Sign in with <IdP>" button above a collapsed "Development accounts" `disclosure` when both exist. Show team roles next to the dev accounts (Alex owner, Blair editor) to speed up testing. [L · S]

### p02 Public agent page: *Change (small)*
- Two stacked header bars (instance bar and agent bar), and the agent name and "RA" appear 3 times. Merge them into one bar: instance logo · agent avatar + name + team on the left, New chat and Sign in on the right. [L · S]
- The "New chat" button looks disabled when there's no conversation. Hide it until the first message. [L · S]
- Keep the privacy footer. [—]

### d01 New data source dialog: *Change*
- Make it a two-step flow. Step 1 is the type choice (the two radio cards, in the `dialog`). Step 2 opens a **`sheet`** or a full page with the type's form, where Name, Classification and Embedding profile are visible without scrolling, and for Website the URLs, mode and a "Preview pages" button. Today the required Classification is below the fold. [M · M]
- Pre-select the team's default embedding profile and the lowest classification, with a "What's classification?" `hover-card`. [L · S]

### d02 New agent dialog: *Change*
- Show the model display name via `model-selector`. Knowledge bases are below the fold: put them second, after Name, because an agent without a KB can't answer. [M · S]
- The Address field and its "Chat link" hint could move to Appearance/Profile later. In this dialog, derive it from the name and show it as helper text with an "Edit" link. [L · S]
- After creation, land on **Build** with the Test panel open, so the builder immediately sees the agent answer. [M · S, once Build exists]

---

## 4. Quick wins (each ≤ 1 day, highest value first)

1. **Audit bug:** add the `publishable_key` (and `moderation_policy`) live-label branches in `ListAudit`, and link publishable keys to the agent Share tab.
2. **Row actions overflow** on w11 and w14: collapse "Tags · Delete" into a fixed-width "…" `menu`. Clamp document titles to 1 line and show the URL path only.
3. **Publish honesty:** disable Publish when `!hasUnpublishedChanges`, with a `tooltip`. Remove the duplicate "Publish…" in Versions. Adapt it for Editors when the audience is beyond Team.
4. **Contradictory status text:** Test's "Draft — not saved" vs "Draft saved"; the email footer on notification settings; "Mark all as read" on an empty inbox.
5. **Rename the workspace "Agents" to "Discover agents"**, and fix "Your teams 3" to "3 agents".
6. **Remove the conversation list from the Agent directory** (link to Home or recents instead) until a Conversations page exists.
7. **Always show the team section in the sidebar** for the last-used team; move recents below it.
8. Team overview: add an **Agents** stat, make the stat cards links, replace "Chunks indexed" with passages or drop it, and move "Add member" to the Members tab.
9. Model names: show the display name in the Agents list (row 3) and in the New agent dialog.
10. KB detail: move the stat cards below the tabs (Overview-only) or into a facts line. Stop repeating them on every tab.
11. Usage: hide the public-agent caps when the team has no public agent; sort meters by % used.
12. Visual bugs: the clipped welcome avatar in the Test tab, the truncated hex field on Appearance, lowercase "Markdown", and the breadcrumb stuck on "Overview" for team tabs.
13. Replace the native `mm/dd/yyyy` inputs on the audit log and analytics with `date-picker` (range).

---

## 5. bitop-ui components

**Where each one applies**

| Component | Use in Grounded | Pages |
|---|---|---|
| `data-table` (sort, text filter, selection, paging, `toolbar`, `rowActions`) | every list and sub-list | w09, w11, w14, w15, w19, w22, w08, w20-share keys, w21 |
| `sheet` (new to Grounded in pages; 1 use today) | document detail, audit entry, API or widget key create and edit, domain request detail, crawl run errors, New data source step 2 | w11, w14, w08, w22, w20-share, w21, w10, d01 |
| `drawer` (new) | the Test chat on narrow screens in the agent builder; a mobile filters panel | w20 |
| `resizable` (new) | the agent **Build** split: config on the left, live Test on the right | w20 |
| `accordion` (new) | the agent Build sections; source and KB Settings (General / Crawling / Danger zone) | w20-configure, w12, w18 |
| `toggle-group` (new) | quick filters (status, type, audience), date presets, embed position, the analytics section switch | w02, w03, w11, w14, w20-analytics, w20-share |
| `button-group` (new) | Sync now plus its "…" menu, Chat plus Publish as a joined pair | w10, w20 header |
| `date-picker` / `calendar` (new) | audit and analytics date ranges | w08, w20-analytics |
| `hover-card` (new) | "Used by N agents", KB source lists, agent info in chat and directory, concept explanations in list headers | w09, w15, w16, w02, w23 |
| `scroll-area` (new) | chunk previews in the document sheet, the chat conversation list, the preview pane | w11 sheet, w23 |
| `item` (new) | recent activity, needs-attention rows, teams on Home, KB checklist in the agent config, conversation rows | w01, w05, w20 |
| `query-state` (new) | a uniform loading, error and empty state on every tab, replacing ad-hoc skeletons and alerts | all |
| `time` (new) | relative timestamps with an absolute tooltip in every table and list | all tables |
| `navigation-menu` (new) | only if the top bar gets a Team menu later; **not recommended** for the sidebar (keep `app-shell`) | — |
| `context-menu` (new) | right-click on table rows mirrors the "…" menu | w11, w14, w19, w22 |
| `slider` (new) | fusion weights, passages per search, temperature in Advanced | w18, w20 |
| `combobox` (1 use) | audit Action and Person filters, attach source to KB, team filter with many teams | w08, w17, w02 |
| `pagination` (1 use) | crawl history, audit (or `data-table` cursor mode) | w10, w08 |
| `model-selector` (new) | chat model pickers | w20, d02 |
| `save-bar` (3 uses) | one sticky bar per Settings form and per Build tab | w12, w18, w20 |
| `stat-card` whole-card link | team overview counts | w05 |
| `popover` | notification bell preview, Try it filters | top bar, w16 |
| `copy-field` / `code-block` | links and snippet on Share (existing) | w20-share |

**What Grounded needs that bitop-ui lacks** (add to bitop-ui first, per phase4 §10):

1. **Charts:** bar, line and sparkline. Grounded has a local `components/ui/bar-chart` that isn't in the registry. Upstream it and add a sparkline for stat-card trends.
2. **Diff viewer:** text and JSON before/after, for version compare (w20-versions) and audit before/after (w08). `commit` is a git-commit display, not a diff.
3. **Description list (key–value facts):** for the detail-page facts strip and the Website card (w10), the document sheet and key details. It's hand-built with CSS today.
4. **Faceted filter / filter bar for `data-table`:** multi-select facet chips with counts, a clear-all control and URL sync. `data-table` has only a single text filter and a `toolbar` slot.
5. **Bulk action bar:** appears when `data-table` rows are selected (delete, tag, re-fetch).
6. **Column visibility / density control for `data-table`:** narrow screens and power users on document tables.
7. **Onboarding checklist:** for "Getting started" (a stepper with done states). `task`/`queue` are AI-work oriented.
8. **Meter with thresholds:** `progress` with warning and critical tones at 80% and 100% for usage.
9. **Activity feed / timeline:** for recent changes and crawl history, if not built from `item` plus `time`.
