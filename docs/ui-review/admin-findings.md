# Grounded platform admin UI: IA and page review

Reviewed 2026-09-26. Screenshots `a01`–`a24` and `d03`–`d04` in `/tmp/ia-review/`, captured at a 1280 × 577 CSS px viewport with full-page captures for the tall pages. Source: `web/src/pages/admin/**`, `components/layout/nav.tsx`, `lib/tabs.ts`, `router.tsx`. Product context: DESIGN §3, §4, §5.3–5.4, §8, §10, §11, §13, phase4-publishing §10, ADR-0019 and ADR-0020. Component names refer to the bitop-ui registry on `main` (115 items). This is a review only; no code was changed.

Priority: H/M/L = admin impact. Effort: S (< ½ day), M (1–3 days), L (> 3 days or needs API work).

---

## 1. Top 10 problems, ranked by admin impact

1. **There is no admin landing page, so items that need action go unseen.** `/admin` redirects to Users (`router.tsx:201`). Pending domain requests, agents disabled by the platform, failing or disabled models, the global public-agent switch, and a public audience with no moderation provider are each visible only on their own page. An admin has to visit 5 pages to learn whether anything needs attention. **Fix:** add an Overview page with an attention queue (see §2). H / M.
2. **The Admin → Agents table overflows, which hides the kill switch** (`a16`). The capture is 1344 px wide in a 1280 px window. The Updated column is clipped. The **Disable** (kill switch) and **Short name** actions are off-screen to the right. Agent names and slugs wrap one character per line ("registr / ar- / assistan / t"). The page's most safety-critical action can't be seen without scrolling sideways. **Fix:** use a `data-table` with fewer columns and a row-actions menu, and open the record in a `sheet`. H / S–M.
3. **Limits appear in 3 places with 3 different presentations.** Admin → Limits has 4 pill tabs of default/ceiling inputs (`a22`, `a23`). Public access repeats the public limits as a read-only table (`a19`). Team → Limits is a single flat table of **21 rows and about 2,100 px** (`a08`) with no grouping and no current usage. An admin setting a team override can't see how close the team is to the limit. **Fix:** use one grouping everywhere, with an `accordion` or the same 4 groups; add usage bars (`progress`); remove the copy on Public access. H / M.
4. **The Moderation page is 2,200 px tall and the tabs sit in the wrong place** (`a17`, `a18`). The Providers table is above the audience tabs. The pill tabs (Team / Authenticated / Public) start mid-page, so it's unclear what they switch. Each audience has 8 categories × 2 stages = 16 select-plus-number pairs, and the thresholds show greyed "50" values even when the action is Off. The Test box sits below everything and applies to no particular tab. **Fix:** see page 17; the pattern is audience tabs first, an `accordion` for categories, a `slider` for thresholds, and the test box in a `sheet`. H / M.
5. **The logs are mostly sign-in noise, and their filters are inconsistent** (`a04`, `a21`, `a24`). Over 60% of audit rows are `auth.login` / `auth.logout`, and each Target cell repeats the actor's own name ("Alex Dev / User"). The user Activity tab repeats the user's name and email in a "Who" column on every row (`a04`). The Audit log puts its filters inside the card and picks people with a combobox. The Access log puts filters above the card and uses **two** controls for one user ("Find a user" text plus a "User" select), which wraps to 2 rows (`a21`). Both use native `mm/dd/yyyy` inputs, and "Show" expands details inline. **Fix:** one log template, sign-ins hidden by default, and entries opened in a `sheet`. H / M.
6. **A platform role changes immediately from a select, with no confirmation** (`a02`, `user.tsx:136`). Choosing "Platform admin" in the dropdown saves at once. This is the most powerful grant in the product, and it is one mis-click away with no confirm and no reason field. The Access card also repeats Status, which the header badge already shows. **Fix:** stage the change and confirm it in an `AlertDialog` that says what the role can do. H / S.
7. **Catalog pages have no record view, and row actions are flat text buttons** (`a09`–`a11`, `d03`, `d04`). Connections, Models and Embedding profiles show "Test / Edit / Delete" (and "Make default / Retire / Delete") as equal-weight ghost text, so destructive actions sit next to harmless ones. Editing happens in centred dialogs that scroll inside a 577 px viewport. In `d03` the Description field is cut off and 12 fields share two columns. Test results for models appear as page alerts, away from the row. **Fix:** a `sheet` per record (details, test and edit in one place) and a row `menu` with Delete last in danger tone. M / M.
8. **The sidebar has a grab-bag "Oversight" group, and it sits below the fold.** Oversight has 7 unrelated items: analytics, agents, moderation, public access, access log, limits, audit (`nav.tsx`). In every 577 px capture the sidebar stops at Classifications, and the "Platform admin / All teams and settings" context block takes up a row of height. SystemOne (ADR-0020) will add a 16th item. **Fix:** regroup by admin intent (see §2). M / S.
9. **Team and user detail pages lack an overview and use heavy destructive buttons** (`a02`, `a06`–`a08`). Team → Details is a lone form. It has no counts (sources, KBs, agents), no usage, and no links to the team's agents (`/admin/agents?team=` already exists), domain requests or audit entries. **Archive** and **Suspend** are solid red and are the only header action, so they are the most prominent control on the page. **Fix:** add an Overview tab, and move destructive actions into a `menu` or a "Danger zone" at the end of the Details tab. M / M.
10. **Read-only access for auditors is explained on only 4 pages.** Info alerts appear on Agents, Limits, Crawling and Public access. On other pages, controls disappear (Add buttons) or render disabled (Moderation selects, the platform-role select), with no explanation, so the page looks broken. **Fix:** show a shell-level "Read-only" badge in the top bar, and render values as text rather than disabled inputs for auditors. M / S.

Also worth fixing (not in the top 10):
- The shared source detail doesn't show **which teams and KBs use the source** (`a13`). DESIGN §4 rule 6 promises admins an impact preview across all teams.
- Classifications doesn't show the per-level settings DESIGN §4 lists: conversation retention, anonymous retention, allowed source types, and direct `/retrieve`. Public access even points to "each classification level's anonymous retention" (`a19`), which admins can't see anywhere.

---

## 2. Proposed admin IA

Principles:
- Group pages by the admin's intent: *who*, *what exists*, *AI supply*, *rules*, *what happened*.
- Put the most-visited page first in each group.
- Merge pages only when they share a template and an audience.
- Use pill tabs inside a page, never across unrelated objects.

The sidebar stays a vertical list in the `app-shell`. `navigation-menu` is for top-bar mega-menus and isn't a good fit for a 16-item admin rail. Use `scroll-area` for the rail so the account menu stays pinned at short heights.

```
Admin
├─ Overview            NEW landing (/admin). Attention queue, platform health, setup checklist, recent admin changes.
│
├─ PEOPLE
│  ├─ Users            Everyone who has signed in; role, status, suspend. Tabs: Access · Teams · Activity.
│  └─ Teams            Create, archive, classification ceiling. Tabs: Overview (new) · Members · Limits · Details.
│
├─ CONTENT
│  ├─ Agents           Every team's agents (metadata only), kill switch, short names. Row opens a sheet.
│  └─ Shared sources   Platform-owned sources teams can attach. Detail tabs: Overview · Pages · Used by (new) · Settings.
│
├─ MODELS
│  ├─ Models           Chat, embedding, moderation and SystemOne catalog; row opens a sheet (details · test · edit).
│  ├─ Connections      OpenAI-compatible proxies; row opens a sheet (test result with model IDs).
│  ├─ Embedding profiles  Chunking and vector settings; default; retire; (Phase 5) migrations.
│  └─ SystemOne        ADR-0020 feature switches (passage judging, citation checks …). Shown only once a SystemOne model exists.
│
├─ POLICY
│  ├─ Classifications  Levels: model ceiling, widest audience, retention, allowed source types.
│  ├─ Crawl domains    (renamed from Crawling) Tabs: Requests (n pending) · Allowlist.
│  ├─ Moderation       Tabs: Team · Authenticated · Public · Providers.
│  ├─ Public access    Global public-agent switch, CAPTCHA, anonymous sessions (public limits link to Limits).
│  └─ Limits           Defaults and ceilings. Tabs: Team resources · Ingestion · Queries & chat · Public agents.
│
└─ MONITORING
   ├─ Analytics        Platform aggregates (answers, quality, speed, moderation, tokens).
   └─ Logs             MERGED. Tabs: Audit log · Access log (redirect /admin/audit and /admin/access-log).
   (Phase 5 slots: Break-glass, Legal holds, Retention under POLICY; Maintenance under MONITORING)
```

This gives 16 items in 5 groups plus Overview, down from 15 items in 4 groups plus SystemOne. Every group has 2 to 5 items.

### Merge and split verdicts
| Candidate | Verdict | Why |
|---|---|---|
| Connections + Models + Embedding profiles + SystemOne | **Keep as sibling pages** under MODELS, and add cross-links. | They are separate objects, each with its own primary action. Tabs would put the action in the tab body and hide the 3rd and 4th pages. Cross-links: Connection "Models" count → `Models?connection=`; a model's sheet lists the profiles and moderation policies that use it. |
| SystemOne | **Own page, hidden until a `systemone` model exists** (ADR-0020: "with no SystemOne model configured, the switches are hidden"). | For discoverability, the Models kind filter and the Add model dialog explain the kind. The Overview setup checklist can mention it. |
| Moderation + Public access + Limits | **Don't merge.** Remove the duplicate public limits from Public access and link to Limits › Public agents instead. | Moderation covers all 3 audiences, not only public ones. Limits covers every team. Public access shrinks to 3 short cards and belongs next to Moderation under POLICY. |
| Crawling + Shared sources | **Keep apart** (policy vs content). Rename Crawling → **Crawl domains** so it matches the team-side "Domain requests". | They have different tasks. Cross-link from a shared web source's settings to the allowlist. |
| Access log + Audit log + Analytics | **Merge the two logs** into Logs with pill tabs; **keep Analytics separate**. | Both logs use the same template (filters, time-ordered table, auditors as the main readers). Analytics is aggregate charts. |
| Admin Limits vs Team → Limits tab | Keep both, but use **one grouping and one component**. | Team → Limits reuses the 4 groups as an `accordion`, with an Effective column and a Usage column. |

### Overview page (new; `/admin` renders it instead of redirecting)
- **Needs attention** (`item` rows linking to the filtered page; hidden when empty):
  - N pending domain requests
  - N agents disabled by the platform
  - models that are disabled but still used by a published agent
  - connections whose last test failed
  - "Public audience has no moderation provider" (the warning currently shows only inside Moderation › Public)
  - the public-agent switch when it's off
- **Platform at a glance** (`stat-card`, 4 per row, whole-card links): active teams, users (7-day sign-ins), published agents by audience, answers over the last 7 days with a delta.
- **Setup checklist** for a fresh install only: connection → chat model → embedding model → default profile → classification descriptions → first team. This matches DESIGN §19 Phase 0 exit criteria and ADR-0018 open-source installs.
- **Recent admin changes**: the last 8 non-auth audit entries (`item` + `time` relative), with a link to Logs.

### Consistent templates
- **List page:**
  - `page-header`: title, **one-line** description, primary action on the right; longer policy text goes behind a "How this works" `popover` or `hover-card`.
  - Toolbar: search plus `toggle-group` or `combobox` filters plus a result count, in the `data-table` toolbar slot.
  - `data-table`: sortable, with row click opening a `sheet` (catalog objects) or navigating (Users, Teams, Shared sources).
  - Row actions in a `menu` (⋯) with destructive items last in danger tone; `context-menu` offers the same items on right-click.
  - `pagination` or load-more for server lists.
  - `query-state` for loading, error and empty.
- **Detail page:**
  - Header: name, status badges, one secondary line, 1 primary action, other actions in a ⋯ `menu`. Destructive actions never go in the header as solid buttons.
  - Pill tabs with **Overview first**.
  - Cards; a definition list for facts.
- **Settings page:** cards per concern, an `accordion` for long homogeneous lists, a sticky `save-bar` (already used), and `number-input` with units.
- **Read-only:**
  - One shell badge ("Read-only · Platform auditor") next to the breadcrumbs, replacing the per-page alerts.
  - Forms render values as text for auditors.
  - Action buttons are hidden; never shown disabled without an explanation.
- **Timestamps:** `time` with relative display ("12 min ago") and the absolute time in a tooltip, in logs and tables.

### Naming (make the sidebar, page title and breadcrumb agree)
| Today | Proposed |
|---|---|
| Nav "Connections" / title "Model connections" | "Connections" in both (the group label already says Models) |
| Nav "Classifications" / title "Classification levels" | "Classifications" in both |
| Nav "Crawling" (sections "Crawl allowlist", "Domain requests") | "Crawl domains" (tabs "Requests", "Allowlist") |
| Models column "Max classification" / dialog "Most sensitive data allowed" | "Max classification" in both, with the hint "Most sensitive data it may process" |
| Audience "Authenticated" (Agents, Analytics) vs "Any signed-in user" (Classifications) vs "All authenticated" (URL) | "Signed-in users" everywhere (short form in tables) |
| Status "Enabled" (models, connections) vs "Active" (profiles, users, teams, sources) | Objects that can be switched: "Enabled / Disabled". Lifecycle states: "Active / Retired / Archived / Suspended". |
| Group "Oversight" | Split into "Policy" and "Monitoring" |

---

## 3. Page-by-page findings

### 0. Shell and sidebar (all pages)
- **Keep:** the Workspace/Admin mode switch, breadcrumbs, and the ⌘K palette (`adminKeywords` is a nice touch).
- **Change:**
  - At 577 px tall the rail cuts off after Classifications. Wrap the nav in a `scroll-area` so the account menu stays pinned, and shrink the "Platform admin / All teams and settings" block to the mode switch plus the role badge. M / S.
  - Regroup as in §2 and add the Overview item. H / S.
  - Add the read-only badge to the top bar for auditors. M / S.

### 1. Users list, `a01`
- Purpose: find a person, check their role and status, then suspend or promote them.
- **Keep:** it is clean, and the name + email cell works.
- **Change:**
  - Add `toggle-group` filters for Role (All / Admins / Auditors / None) and Status (Active / Suspended), plus a result count. Admins need to find "all platform admins" quickly for access reviews. H / S.
  - Add a **Teams** count column; show Last sign-in as relative `time`. M / S.
  - Move to a `data-table` sortable by name and last sign-in; keep load-more. M / S.
  - Put the search in the table toolbar rather than as a labelled field above it; this saves about 50 px. L / S.

### 2. User › Access, `a02`
- **Change:**
  - **Confirm platform-role changes** in an `AlertDialog` that names the capabilities and whether to notify the user (see top issue 6). H / S.
  - Remove the duplicated "Status Active" line, which the header badge already shows. Keep Created and Last sign-in as a definition list. L / S.
  - Replace the solid red **Suspend** in the header with a secondary button, or put it in a ⋯ menu with a danger item. The confirm dialog already exists. M / S.
  - Add read-only context: "Last active platform admin; can't be demoted" when it applies (DESIGN §3.4). M / S.

### 3. User › Teams, `a03`
- **Keep.**
- **Change:**
  - Add a Joined column and the team's classification.
  - Link each role to the admin team's Members tab.
  - Add an empty state that explains how to add the user to a team (owners do it; admins can only assign owners). L / S.

### 4. User › Activity, `a04` (3,785 px)
- **Change:**
  - Drop the **Who** column; it is always this user.
  - Hide the Target when it is the user themself (auth events).
  - Add a "Hide sign-ins" `toggle` that is **on by default**.
  - Add an action-group filter.
  - Use relative `time`.
  - Open "Show" details in a `sheet`.
  - Together these cut the table about 3×. H / S.
- Consider a small "Sign-ins" summary line ("Last sign-in 5 min ago · 14 sign-ins in 7 days") instead of rows. M / S.

### 5. Teams list, `a05`
- **Keep:** the search and the Status select.
- **Change:**
  - Add Agents, Sources and Storage-used columns. Admins look for the teams that are large or near their limits. M / M (needs counts from the API).
  - Replace the Status select with a `toggle-group` (All / Active / Archived). L / S.
  - Use a `data-table` sortable by members and storage. M / S.
  - Keep "Create team" as the primary action.

### 6. Team › Details, `a06`
- **Change:**
  - Add a new **Overview** tab first:
    - `stat-card`s for sources, KBs, agents (link to `/admin/agents?team=`) and members
    - usage vs effective limits for storage, documents, chat tokens today (`progress`)
    - pending domain requests from this team
    - the last 5 audit entries
  - This turns the team page into the "what's going on with this team" answer. H / M.
  - Details becomes a settings tab. Put Archive in a **Danger zone** card at the bottom with an explanation, and remove the solid red header button. Header actions become a ⋯ `menu` with "View as team overview" and Archive. M / S.
  - Show the effect of lowering "Approved classification" before saving (sources above the new ceiling), as DESIGN §4 rule 6 says. M / M.

### 7. Team › Members, `a07`
- **Keep:** the read-only list, which is right given team autonomy (DESIGN §3.5).
- **Change:**
  - Replace the free-text "Assign an owner" with a `combobox` of existing users that also accepts an email invite. The current empty input gives no hint of what to type. M / S.
  - Put that control in the card header as an "Assign owner" button that opens a small `popover` or dialog, so the table ends cleanly. L / S.
  - Show pending invites, if any. L / M.

### 8. Team › Limits, `a08` (2,151 px)
- **Change:**
  - Group the 21 rows into the same 4 groups as Admin → Limits, using an `accordion` (multiple open; Team resources open by default). Each header shows a summary such as "2 overrides". H / S.
  - Add a **Usage** column (current / effective, with `progress`) for the resource and daily limits. Without it, admins can't tell whether an override is needed. H / M (`GET /v1/teams/{team}/limits` already returns usage for members).
  - Highlight overridden rows and add a "Show overrides only" `toggle`. M / S.
  - Shorten the card description, and turn the "Limits page" link into a secondary button in the card header. L / S.

### 9. Connections, `a09`, `d04`
- **Keep:** the table is compact and the key is shown as a hint.
- **Change:**
  - Replace the row text buttons with a **Test** button plus a ⋯ `menu` (Edit, Disable, Delete in danger tone). M / S.
  - Clicking a row opens a `sheet` with:
    - details (URL, timeout, requests-per-minute limit)
    - the last test result with the upstream model IDs returned by `/models`, plus "Add as model" shortcuts (DESIGN §10: "helps the admin fill in forms")
    - the models on this connection
  - Replace the Add and Edit dialogs with the same sheet in edit mode; at 577 px the dialog already scrolls (`d04`). M / M.
  - Make the Models count a link to `Models?connection=…`. L / S.

### 10. Models, `a10`, `d03`
- **Keep:** the Kind filter, and the badges for kind and classification.
- **Change:**
  - Replace the Kind select with a `toggle-group` (All · Chat · Embedding · Moderation · SystemOne) and add a Connection filter plus search. M / S.
  - Use a row `menu` (Test, Edit, Disable, Delete). Show test results **in the row's sheet**, not as a page-level alert. M / S.
  - Lay out the Add/Edit form in a `sheet` with sections:
    - Source: connection, upstream ID, key
    - Identity: display name, description
    - Policy: max classification, enabled
    - Capabilities: fields that depend on kind; hide chat fields for embedding models
    - Compatibility flags (`disclosure`)
  - `d03` shows 12 fields in 2 cramped columns with Description clipped. M / M.
  - Show "Used by": the agents, profiles and moderation policies that use the model, and warn before disabling one in use. M / M.
  - The Model cell's "`key → upstream`" line wraps into 3 lines. Show the key only, with the upstream ID in the sheet or a `hover-card`. L / S.

### 11. Embedding profiles, `a11`
- **Change:**
  - The data is confusing: the profile **named** "Nomic 768 (default)" is *not* the default, while "Nomic 768 (gateway)" carries the Default badge. Keep "(default)" out of names, and show the Default badge in the Status column. L / S (seed data + guidance).
  - The row actions (Make default / Retire / Delete) are uneven between rows, and Delete is flat. Use a ⋯ `menu`; show "Default" as a badge in the actions column. M / S.
  - Add a "Used by" count (sources and KBs), and disable Delete when the profile is in use. M / M.
  - Put immutable details (prefixes, chunker version, storage type) in a row `sheet`. The Phase 5 **migration** flow belongs there too. M / M.
  - The Vectors and Chunking cells wrap into 3 lines. Use a single line such as "768 · halfvec" and "512 tok / 64 overlap". L / S.

### 12. SystemOne (new, ADR-0020; being built now)
- **Recommend:**
  - A settings page with one card per feature: Passage judging, Moderation provider (link to Moderation), and "next / later" features shown as disabled items with a phase badge.
  - Each card has a `switch`, the SystemOne model it uses (`combobox`), tunables (candidate count, concurrency, timeout as `number-input`), and a latency or cost note from analytics.
  - A sticky `save-bar`.
- Show the nav item only when a `systemone` model exists; otherwise the Models page empty or kind hint links to it.
- Put agent-level overrides in the agent editor, not here. H / M.

### 13. Shared sources list, `a12`
- **Keep:** the columns suit a platform-owned object.
- **Change:**
  - Add a **Used by** column (teams and KBs). It is the key admin question before changing or deleting a shared source (DESIGN §4 rule 6, §5.4). H / M.
  - The Type cell mixes the type badge with the last sync time; move the sync time to its own column as relative `time`. L / S.
  - Drop the Chunks column from the list; it belongs on the detail page. L / S.

### 14. Shared source detail, `a13`
- **Keep:** Overview / Pages / Settings tabs, the stat cards and crawl history.
- **Change:**
  - Add a **Used by** tab: teams and KBs attached, with each one's classification ceiling. Before raising the classification, show the impact preview there. H / M.
  - The header has 2 badge rows (Open + Active next to the title, then Website / Embedding profile / Shared chips). Merge them into one `page-header` meta row. L / S.
  - Crawl history table: add relative `time`, and let failed runs open a `sheet` with errors. L / S.

### 15. Crawling → "Crawl domains", `a14`
- **Change:**
  - Split into pill tabs **Requests** (with a pending count, first) and **Allowlist**. Pending requests are the actionable queue, but today they sit below the allowlist. H / S.
  - Requests:
    - Default to a `toggle-group` set to "Pending", with All, Approved and Denied as the other options.
    - Put Approve and Deny as row buttons; open the full request (reason, requester, history) in a `sheet`.
    - The Status cell currently packs decision, reviewer, time and note into 4 lines; move these to the sheet.
    - M / S.
  - Allowlist:
    - Give **Remove** a confirm dialog (it has one) and danger tone in a row `menu`.
    - Add a search box once the list grows.
    - Show "Added by" beside "Added".
    - L / S.
  - Cut the page description to one line. L / S.

### 16. Classifications, `a15`
- **Keep:** a small table with an edit dialog.
- **Change:**
  - Add the per-level settings DESIGN §4 defines: conversation retention, anonymous retention, allowed source types, and direct `/retrieve` for team keys. Show them as columns or in an edit `sheet`. Public access already refers to them (`a19`). M / L (API).
  - Show a **model count** per level ("3 models allowed") and a **team count** ("2 teams approved up to here") so the effect of a level is visible. M / M.
  - Rank is immutable; show it as a lock icon or plain text, not a number that looks editable. L / S.

### 17. Moderation, `a17`, `a18` (2,202 px)
- **Change:**
  - **Structure:**
    - Pill tabs at the top, directly under the header: **Team · Authenticated · Public · Providers**.
    - Providers moves from the top card to its own tab, with a "Used by" column and a link to Models.
    - Each audience tab opens with a one-line status summary ("Provider: Moderation classifier · Buffer · Fails closed · 8 categories blocking"), then the behaviour card, then the categories.
    - H / S.
  - **Categories:** use an `accordion` (one item per category; the header shows "Questions: Block ≥ 50% · Answers: Off"), or keep the table but:
    - replace each "select + number" pair with a `toggle-group` (Off / Flag / Block) and a `slider` (0–100%) that **only appears when the action isn't Off**
    - add a "Set all to…" bulk action per column
    - this removes 16 greyed "50" boxes when a policy is off (`a17`). H / M.
  - **Test box:** move it to a "Test" button in the page header that opens a `sheet`, pre-selecting the current tab's provider and showing the scores against the tab's thresholds (would block / flag). Today it sits at the very bottom and ignores the tab. M / S.
  - Label-only providers can't be tuned (ADR-0019); hide the sliders for them and say why. M / S.
  - Auditors see disabled selects. Render the policy as text for them. M / S.

### 18. Public access, `a19` (1,356 px)
- **Change:**
  - Remove the **Public limits** table, which duplicates Limits › Public agents. Replace it with a one-line summary and a "Change public limits" link. H / S.
  - Put the master switch in the page header (a `switch` with a status badge) or keep it as the first card, but make the **off** state loud with a warning `alert` when off. Surface the same state on Overview. M / S.
  - Collapse CAPTCHA and Anonymous sessions into one "Visitor safeguards" card with a definition list. These are read-only environment values: mark them "Set in server configuration" with a `hover-card` showing the variable names, rather than showing the env var names in the description. L / S.
  - Add "Public agents: N published" with a link to `Agents?audience=public`. M / S.

### 19. Agents, `a16`
- **Change:**
  - **Fix the overflow** (see top issue 2):
    - Drop Version and Updated from the default columns, or move them to the sheet.
    - Merge Audience and the short name into one cell.
    - Stop slugs from breaking mid-word (truncate with a tooltip).
    - Move Short name and Disable into a row `menu`, keeping **Disable** visible as a danger-tone icon button with a tooltip.
    - H / S.
  - Row click opens a `sheet` with:
    - metadata (team, model, classification, published version, updated)
    - short name
    - kill switch with reason
    - access-log entries for the agent (link to Logs › Access filtered by agent)
    - M / M.
  - Filters: add search by name, a `toggle-group` for Audience (Team / Signed-in / Public), and a `combobox` for Team (a native select won't scale past about 20 teams). M / S.
  - Status "Disabled by platform" rows should sort first and have a tinted row or icon. L / S.

### 20. Analytics, `a20` (2,691 px)
- **Keep:** the grouped stat rows (Usage / Quality / Speed / Moderation), the CSV export, and the aggregates-only promise.
- **Change:**
  - Put the range in the URL; it's `useState` today (`range-picker.tsx:12`), so it resets on reload and can't be shared. M / S.
  - Use a `toggle-group` of presets (7d / 30d / 90d / Custom), plus a range `date-picker` shown only for Custom. This replaces 3 fields. M / S.
  - Add Team and Audience filters (`combobox`, `toggle-group`) to answer "how is team X doing". M / M (API).
  - The page is long. Split it with pill tabs: **Overview** (the 14 stats + daily chart), **Breakdown** (audience, channel, moderation categories), **Models & tokens**, **Top agents & teams**. M / S.
  - Top agents: the team links wrap to 3 lines. Give the table the full width, or drop the Team column when a single team is selected. L / S.
  - The daily chart uses Grounded's `bar-chart`, which exists only on the bitop-ui branch `ragd-p4-analytics`. Merge it into bitop-ui main (see §5).

### 21. Access log, `a21`
- **Change:**
  - Merge into **Logs › Access log** with the same filter bar as the Audit log:
    - Agent `combobox`
    - Person `combobox`, replacing the "Find a user" text box *and* the "User" select
    - range `date-picker`
    - Channel `toggle-group`
  - One row of filters instead of the 2-row wrap. H / S.
  - Show the agent as its name with team/slug in a `hover-card`, and use relative `time`. L / S.
  - Add CSV export; auditors will want it. M / M.

### 22. Limits, `a22`, `a23`
- **Keep:** the 4 pill tabs (an owner decision, and they work), the sticky save-bar, and `number-input` with units.
- **Change:**
  - Shorten the 3-line page description to one line, with "How defaults and ceilings work" in a `popover`. L / S.
  - Add a column "Teams overriding" (count, linking to a filtered teams list) so admins can see the effect of a ceiling before lowering it. M / M.
  - "No ceiling" placeholder text in empty inputs reads like a value. Use an explicit `switch` or `checkbox` for "Ceiling" that reveals the input. L / S.
  - Make the Public agents tab the single place to edit public limits (see page 18).

### 23. Audit log, `a24` (4,201 px)
- **Keep:** readable actions with their machine names, linked targets and load-more.
- **Change:**
  - Merge into **Logs › Audit log**, and add a "Hide sign-ins" `toggle` that is **on by default**. It removes most of the rows in `a24`. H / S.
  - Add a Target type filter (DESIGN §13 promises it), and an action-group `combobox` with groups (Agents, Sources, Limits, Auth …). M / S.
  - Use a range `date-picker` and relative `time`.
  - "Show" opens a `sheet` with a before/after diff rather than expanding inline. M / M.
  - Drop the email line under Who when it's the only person in the result set. Otherwise keep one line with the email in a `hover-card`; this halves row height. L / S.
  - Add CSV export. M / M.

### 24. Dialogs, `d03`, `d04`
- Centred dialogs with more than 5 fields scroll at short viewport heights. Use `sheet` (side="right", size="lg") for create and edit on catalog objects. Keep `dialog` for 1–3 field actions and `AlertDialog` for confirmations. M / M.

---

## 4. Quick wins (each S effort, high value)

1. Confirm platform-role changes (`user.tsx`). H.
2. Agents table: row `menu`, fewer columns, no mid-word wrapping, so the kill switch is visible at 1280 px. H.
3. Crawl domains: Requests tab first with a pending count, defaulting to Pending. H.
4. Audit log and user Activity: "Hide sign-ins" on by default; drop the Who column on Activity. H.
5. Public access: remove the duplicated public limits table and link to Limits › Public agents. H.
6. Moderation: move the audience tabs to the top and Providers into a tab; show thresholds only when the action isn't Off. H.
7. Team → Limits: group the 21 rows into the 4 Limits groups (`accordion`). H.
8. Sidebar: regroup into People / Content / Models / Policy / Monitoring, put the nav in a `scroll-area`, and rename Crawling → Crawl domains. M.
9. Make the sidebar, page titles and status words agree (see Naming). M.
10. Replace the per-page auditor alerts with one top-bar "Read-only" badge. M.
11. Suspend and Archive: secondary or menu instead of a solid red header button. M.
12. Put the analytics range in the URL, and use preset `toggle-group` + `date-picker`. M.

---

## 5. bitop-ui component plan

**Available on main but not yet used in Grounded** (Grounded copies about 55 of the 115): `data-table`, `accordion`, `drawer`, `date-picker`/`calendar`, `toggle-group`/`toggle`, `button-group`, `slider`, `item`, `time`, `query-state`, `hover-card`, `context-menu`, `scroll-area`, `input-group`, `navigation-menu`. Grounded already has `sheet` but uses it only in chat, and it has `combobox`, `pagination`, `disclosure`, `number-input` and `save-bar`.

| Component | Where to use it in admin |
|---|---|
| `data-table` | Users, Teams, Agents, Models, Connections, Profiles, Shared sources, Crawl requests, both logs. Use sorting, the toolbar slot for filters, `rowActions`, and load-more or cursor paging. |
| `sheet` (right, lg) | Record detail and edit for models, connections, profiles, agents, domain requests, audit entries (diff), crawl runs, and the moderation test. |
| `drawer` | Same content as the sheet on narrow screens only (bottom). The sheet is the desktop default. |
| `accordion` | Team → Limits groups, moderation categories, model form capability sections. |
| `toggle-group` | Kind (Models), Role/Status (Users, Teams), Audience (Agents, Analytics), request status (Crawl), channel (Access log), analytics presets, moderation Off/Flag/Block. |
| `slider` | Moderation thresholds, with a value readout. |
| `date-picker` (range) + `calendar` | Audit, Access log and Analytics ranges, replacing native `mm/dd/yyyy` inputs. |
| `combobox` | Person (both logs), Team (Agents, Analytics), Assign owner, Agent (Access log), action group (Audit). |
| `menu` / `context-menu` | Row actions (⋯) with destructive items last in danger tone, and the header overflow on detail pages. |
| `item` | Overview attention queue and recent changes; user Teams tab; "Used by" lists. |
| `time` | All timestamps in lists and logs (relative, absolute in a tooltip). |
| `hover-card` | Agent/team preview in logs; env var names on Public access; upstream model ID in Models. |
| `stat-card`, `progress` | Overview; Team Overview usage vs limits; Team → Limits Usage column. |
| `query-state` | Replace Grounded's own `QueryView` gradually, for consistent loading, empty and error states. |
| `scroll-area` | Sidebar rail; wide tables inside sheets. |
| `navigation-menu` | **Not recommended** for the admin rail, which is a vertical sidebar. Only consider it if a horizontal admin top bar is ever wanted. |

**Missing from bitop-ui main (add there first, per phase4-publishing §10 "new ones added there first"):**
1. **`bar-chart`**: exists only on branch `ragd-p4-analytics` (`b61af90`). Merge it into main.
2. **Line/area chart or `sparkline`**: for Overview trends and stat-card mini-trends (answers per day, sign-ins).
3. **`data-table` column visibility**: `data-table.tsx` on main has sorting, selection, a filter, paging, load-more, row actions and a toolbar slot, but **no column visibility toggle**. Add a "Columns" `menu` with checkbox items and persisted state. It's needed for Agents and the logs at 1280 px.
4. **Description list / key-value list**: label/value pairs for detail sheets and pages (user Access facts, connection details, CAPTCHA/session values, shared source website card). Grounded hand-rolls these today.
5. **Diff viewer**: before/after for audit entries (DESIGN §13 stores before and after values). `code-block` or `schema-display` can't show a diff.
6. **Filter bar with active-filter chips and "Clear all"**: a small composite of `toggle-group`, `combobox` and `date-picker` in one row, so every list and log filters the same way. It could live as a `data-table` toolbar pattern.
7. **Meter / usage bar with a limit marker**: `progress` covers the basics. A variant with a threshold tick and "X of Y" text would fit usage vs effective limit and the ceiling.
