# Grounded UI redesign: final verification (2026-09-27)

Status: FINAL

- Build: `main` @ 3897e93, isolated copy on http://localhost:8110 (DB `ragd_final`, blobs `/tmp/ragd-final-blobs`). Dev server :8080 and DB `ragd` untouched.
- Personas: admin (platform admin), auditor (dev persona `auditor`, platform auditor), alex (owner of registrar + qa-team), blair (editor), casey (added as **member** of registrar in the copy), signed out.
- Artifacts: screenshots `/tmp/ui-final/<area-page>-<persona>-{1440,1280}.png` (1440 = full page, 1280 = viewport), flow shots `flow-*.png`, contact sheets `sheets/s00..s29.png`, raw per-page data `results.jsonl` (title/h1/breadcrumb/active nav/overflow/axe/console), network sweep `netsweep.txt`, running notes `issues-log.md`.

## Summary

| | |
|---|---|
| Page captures | 117 persona/page combinations x 2 widths (234 screenshots) + ~25 flow shots + 1024 Test drawer |
| axe (wcag2a, 2aa, 21a, 21aa) | **0 violations** on all 117 pages and on the 1024 Test drawer. Only "incomplete" items (color-contrast on the aria-hidden kbd glyph, aria-hidden-focus on base-ui focus guards) |
| Console errors / page errors | **0** (console capture verified with a probe) |
| Failed requests | 4, all expected or minor: 2 x 404 for deliberate not-found URLs; 2 x 403 when a member opens /admin (see issue M4) |
| Server log | no ERROR/WARN lines during the session |
| Old URLs | all 9 redirect correctly (/teams/x?tab=members, ?tab=usage, /teams/x/domains, /teams/x/api-keys, agent ?tab=configure, ?tab=test (opens Test), /admin/audit, /admin/access-log, /admin/crawling) |
| Real gateway chat turns used | 1 (public /a/registrar, signed out). Test chats used the FAKE model (QA Helper + a new throwaway agent) |

Headline: the plan is essentially implemented. **Partial:** D8, Q4, Q5, Q14, W3, W6, A6 (known), A9 (known), F-23, P-05, P-11. **Missing:** none outright. One **major** regression at 1280 (Data sources list scrolls the whole page sideways; Last sync/Status/row menu off-screen) and one visible naming bug (breadcrumb "Page not found" on every short-link chat page).

## Plan items

Legend: Done / Partial / Missing / Done (code) = present in code or commit and consistent with the UI, but not exercised end-to-end here.

### Decisions
| ID | Status | Note | Evidence |
|---|---|---|---|
| D1 | Done | Stable team section (last-used team), Discover agents, Conversations page (search, agent, date presets), recents at bottom, Team settings pill tabs Members · Usage & limits · API keys · Crawl domains · Audit log · General; domain requests and keys out of primary nav | ws-home-alex, ws-conversations-alex, team-settings-*-alex |
| D2 | Done | Build split view (accordion with one-line summaries + resizable live Test), drawer at 1024 (`?test=open`, Esc closes, focus returns to "Test"), Audience in Share, tabs Build · Appearance · Share · Versions · Analytics. Known leftover: Test welcome avatar scrolls out on load | agent-build-alex-1280, agent-test-drawer-alex-1024, flow-agent-test-chat-alex-1440 |
| D3 | Done | Source/KB/agent: header with one primary action + "…", facts line, pill tabs with Settings last, stat cards only in Overview, Settings sections ending in Danger zone | source-web-settings-alex-1440, kb-settings-alex-1440 |
| D4 | Done | Documents, API/widget keys, domain requests, audit entries, models, connections, profiles open in `?record=` sheets; Back closes the sheet and keeps filters. Rows themselves aren't clickable (menu > View details only), see m2 | flow-record-sheet-model-admin-1440, flow-document-sheet-alex-1440, flow-logs-entry-sheet-admin-1440 |
| D5 | Done | ListPage everywhere: sortable, facet toggle-groups with counts, Columns menu, chips + Clear all, relative dates, Rows x–y of n; filters in URL survive reload (`/admin/models?kind=chat`, documents `?status=ready`) | admin-models-admin, flow-document-sheet-alex |
| D6 | Done | Admin Overview landing; groups People · Content · Models · Policy · Monitoring; Logs = Audit · Access; Crawl domains (Requests first); SystemOne under Models; "Read-only" shell badge for auditor | admin-overview-admin, admin-overview-auditor |
| D7 | Done | Team limits in 4 groups with Usage column (admin team Limits tab); team Usage & limits meters; Public access links to Limits › Public agents | admin-team-limits-admin, team-settings-usage-alex, admin-public-access-admin |
| D8 | Partial | Terms are right (Discover agents, Crawl domains, Passages, Signed-in users, Danger zone, Enabled/Disabled vs Live/Not published). Misses: breadcrumb "Home › Page not found" on short-link chat pages (M2); Crawl domains tab content headed "Domain requests"; `/admin` for non-admins h1 "Administration" vs crumb "Overview"; document.title is always "Open RAG System" | ws-chat-registrar-alex-1280 |


### Quick wins
| ID | Status | Note | Evidence |
|---|---|---|---|
| Q1 | Done | Audit API returns live labels for publishable keys ("Widget demo", "QA widget demo") and moderation policies ("Public moderation policy"); none show "(deleted)" | API check, admin-logs-audit-admin |
| Q2 | Done | Role select opens "Make Dev User a platform admin?" stating what the role can do; Cancel reverts the value (focus goes to body, see m10) | flow-q2-role-confirm-admin-1440 |
| Q3 | Done | Admin Agents fits at 1280, no mid-word wraps, kill-switch icon button on every row + row menu; auditor sees no kill switch | admin-agents-admin-1280, admin-agents-auditor-1280 |
| Q4 | Partial | 1-line titles, URL path only, "Kind · Size", row menu with View/Edit tags/Delete. But the upload source Documents table is 1108 px in a 976 px card at 1280: Updated and the row "…" are off-screen (m1) | source-upload-documents-alex-1280 |
| Q5 | Partial | Publish disabled with "No changes since version 4"; no second Publish in Versions; editors get a disabled Publish with the reason; "Draft saved" correct; email footer honest (SMTP is configured). **Not done:** "Mark all as read" still shown on an empty inbox (m3) | agent-build-blair-1280, ws-notifications-admin-1440 |
| Q6 | Done | "Hide sign-ins" on by default on Logs and user Activity (`?signins=show` when off); Activity has no Who column | admin-logs-audit-admin, admin-user-alex-admin |
| Q7 | Done | Crawl domains opens on Requests, "Pending review" by default; pending count as a sidebar badge (0 pending today, so not visible) | admin-crawl-requests-admin |
| Q8 | Done | Audience tabs at the top, Providers is a tab, threshold inputs only for categories not Off (Team tab: 0 inputs; Public: all Block with %) | admin-moderation-*-admin |
| Q9 | Done | Public access: no duplicate limits table, links to Limits › Public agents | admin-public-access-admin |
| Q10 | Done | Team overview: Agents stat, whole-card links, no "Chunks indexed", Add member moved to Members | team-overview-alex, team-settings-members-alex |
| Q11 | Done | Display names in Agents lists and New agent ("GPT-OSS 120B (gateway)") | agents-list-alex, flow-new-agent-alex |
| Q12 | Done | Suspend in the user "More actions" menu (disabled for self with a reason); Archive team in a Danger zone | admin-team-settings-admin |
| Q13 | Done | Preset toggle-group + Custom date-picker range; `?range=7d` in the URL (agent analytics, admin analytics, logs, team audit) | flow-q13-date-custom-alex-1440 |
| Q14 | Partial | Breadcrumb follows team tabs; "MARKDOWN" is now "Markdown". Still open (known): Test/preview welcome avatar scrolled out on load; hex field width not re-checked | agent-build-alex-1280 |

### Workspace
| ID | Status | Note | Evidence |
|---|---|---|---|
| W1 | Done | Per D1; Conversations page with search, agent filter, date presets, grouped by day | ws-conversations-alex |
| W2 | Done | Per D2; accordion summaries (Model, Knowledge, Answering, Safety, SystemOne checks, Advanced) | agent-build-alex-1440 |
| W3 | Partial | Facts line, Sync now / Upload files primary, "…" menu, Upload sheet, document sheet (metadata, passages, tags, delete), Settings General / Crawling / Classification / Danger zone with one save bar. **Missing:** re-fetch action in the document sheet (m8) | flow-document-sheet-alex-1440, source-web-settings-alex-1440 |
| W4 | Done | Stat cards only in Overview; Try it = one query row + Filters popover; "Attach source" button; slider for passages per search; fusion weights with "Use the default" | kb-*-alex |
| W5 | Done | 4 linked stats incl. Agents, Needs attention (QA Team: failed document), compact recent changes, Getting started checklist on the empty Advising team | qa-team-overview-alex, team-overview-advising-blair-1280 |
| W6 | Partial | KBs with Used by, agents with Audience + unpublished-changes dot (in code), API keys list. Sources list has Used by + Last sync, but at 1280 Last sync/Status/menu are off-screen (M1) | sources-list-alex-1280 |
| W7 | Done | 5-stat KPI strip, Usage · Quality · Moderation · Content, satisfaction "From 1 rating: too few to rely on" | agent-analytics-alex |
| W8 | Done | Audience → Links (short first, all three shown) → Widget (keys table, snippet and preview side by side); key creation in a `?record=new` sheet | agent-share-alex-1440 |
| W9 | Done | New data source: type step then a sheet with Name, Classification, Profile first. New agent: KBs second; lands on Build with `?test=open` | flow-new-source-step2-alex-1440, flow-new-agent-landing-alex-1440 |
| W10 | Done | Meters sorted by share used, warning tone at 80 % (meter.tsx), rate limits in a disclosure, public group only with a public agent | team-settings-usage-alex |
| W11 | Done | Icon-only app sidebar on chat pages, conversations grouped by day, agent info hover-card (code) | ws-chat-registrar-alex-1280 |
| W12 | Done | One header bar (instance, agent, Sign in) | public-registrar-anon |
| W13 | Done | Member overview = agents to chat with + KBs to query; Usage & limits and Audit log hidden (URL ?tab=usage falls back to Members); read-only notes; no edit/delete in any row menu; no failed requests | team-overview-casey, team-settings-usage-casey |

### Admin
| ID | Status | Note | Evidence |
|---|---|---|---|
| A1 | Done | Setup checklist, Needs attention (failed documents in QA Team), Platform at a glance, Recent changes. Known leftover: doesn't flag models failing tests | admin-overview-admin |
| A2 | Done | Groups People · Content · Models · Policy · Monitoring; account menu pinned at 800 px height | admin-*-1280 |
| A3 | Done | Audit and Access tabs, filter bars (action, target type, person / agent, person, channel, date), entries in a sheet with before/after diff, Export CSV | flow-logs-entry-sheet-admin-1440 |
| A4 | Done | Overview tab (counts, usage vs limits, pending requests), Limits with Usage column, Archive in Danger zone, "Assign owner" picker | admin-team-*-admin |
| A5 | Done | Record sheets (details, Test, Used by, Edit, Delete disabled when in use), row menus, Used by column; "Add as model" in the connection sheet (code) | flow-record-sheet-model-admin-1440 |
| A6 | Partial (known) | Used by column + sheet, not a tab | admin-shared-sources-admin |
| A7 | Done | Users: role/status facets, Teams count, relative sign-in. Teams: Agents, Sources, Storage | admin-users-admin, admin-teams-admin |
| A8 | Done | Rank, widest audience, retention (signed-in + anonymous), source types, API /retrieve, models allowed, teams approved | admin-classifications-admin |
| A9 | Partial (known) | Pill tabs Overview · Breakdown · Models & tokens · Top agents & teams; range in URL. No team/audience filters | admin-analytics-*-admin |
| A10 | Done | SystemOne model at top, one card per feature with switch and latency note | admin-systemone-admin |

### Functional issues
| ID | Status | Note |
|---|---|---|
| F-01 | Done | Public chat (SystemOne moderation, buffered, fail-closed) answered a transcript question normally (flow-public-chat-anon-1440) |
| F-02 | Done | Same turn not blocked; uncalibrated floor 95 % shown in Moderation |
| F-03 | Done | = Q2 |
| F-04 | Done (code) | Keep mine / Use theirs with diff-viewer (8bc304e, 245e79c); not exercised |
| F-05 | Done | Emptied KB name: "Enter a name." under the field, aria-invalid + describedby (flow-f05-field-error-alex-1280) |
| F-06 | Done | Tag typed without Enter became a chip and was applied (flow-upload-sheet-after-alex-1440) |
| F-07 | Done | /a/registrar/registrar-assistant serves the public page signed out (public-team-address-anon) |
| F-08 | Done | "example.edu will be saved as https://example.edu" (flow-f08-widget-origin-alex-1440) |
| F-09 | Done (code) | Origin check endpoint (77a40ff); not exercised |
| F-10 | Done (code) | Errors render as alerts without rating/copy (thread.tsx, panel.tsx); not triggered |
| F-12 | Done | Breadcrumb follows team settings and detail tabs |
| F-13 | Done (code) | "Mark these as read" when filtered by type |
| F-14 | Done (code) | Preview text explains the crawl may fetch a different set (source settings) |
| F-15 | Done | Publish dialog: "Members of this team will chat with this configuration." |
| F-16 | Done (code) | "This team is archived" alerts |
| F-17 | Done | "Leave without saving?" on admin Limits (flow-unsaved-guard-limits-admin-1440) |
| F-18 | Done (code) | 22ce61d |
| F-19 | Done (code) | 2ff11e2 / 6b95b98 |
| F-21 | Done (code) | "Resume" when paused, drop zone disabled (3a8980d, tests in c9625d6) |
| F-22 | Done | /a/qahelper switches the sidebar to QA Team |
| F-23 | Partial | "Turn off public agents?" confirmation exists, but doesn't name the affected agents (flow-f23-public-switch-confirm-admin-1440) |
| F-24 | Done | = W13 |
| F-25 | Done (code) | Key create dialog has agent restriction and responsible contact (agentIds, contact) |
| F-26 | Done | Save bar: "Not saved: fix the highlighted field" |
| P-01 | Done | ⌘K finds agents ("registrar assis"), sources ("student pol"), KBs ("registrar help"). Shared sources aren't indexed (fine) |
| P-02 | Done (code) | "Checking public safety…" (fdb4665) |
| P-03 | Done | Editor: Publish disabled with reason; public audience marked not available |
| P-04 | Done | Self-suspend disabled with a reason; sole owner has no role select, "The only owner…" |
| P-05 | Partial | Unknown team/route/admin user/admin team get the not-found template; unknown agent/source/KB id shows an inline red "Couldn't load this agent" with no h1 (m5) |
| P-06 | Done (code) | Friendly document error messages (e8a3f4d) |
| P-07 | Done (code) | 3ba1aaf |
| P-08 | Done | No-team Home: "To build your own, join a team", avatar "DU" (ws-home-user-noteam-1280) |
| P-09 | Done (code) | 6f8681c |
| P-10 | Not verified | Model test banner after delete not exercised |
| P-11 | Partial | Toasts moved to bottom centre but still cover content (e.g. "Agent created" over the Advanced accordion row) |
| P-12 | Done | Detach from a KB used by an agent asks "Detach Registrar website?" |
| P-13 | Done (code) | Image-only chunks skipped (4c71158) |
| P-14 | Done | Widget preview composer 0 / 2,000 |
| P-15 | Done (code) | 35ed31e |
| P-16 | Done (code) | Pending-requests badge beside Crawl domains in the admin sidebar |
| P-17 | Not verified | Create-team slug error not exercised |
| P-18 | Done (code) | with F-19 |
| P-19 | Not verified | Conflict banner persistence not exercised |
| P-20 | Done (code) | "Saved" per row (c08711c) |
| P-21 | Done | "No ceiling" placeholders on Limits |

## New issues (ranked)

### Major
- **M1. Data sources list overflows the page at 1280.** Owner and member, `/teams/registrar/sources` at 1280x800: the table is 1285 px inside a 976 px card, and the document itself scrolls 225 px sideways (`scrollWidth 1505`), leaving a blank strip. Last sync, Status and the row "…" menu are only reachable by horizontal scrolling. Shots: `sources-list-alex-1280.png`, `issue-sources-list-hscroll-alex-1280.png` (after scrolling), `sources-list-casey-1280.png`.
- **M2. Every short-link chat page's breadcrumb says "Page not found".** Signed in, open `/a/registrar` or `/a/qahelper` (the Share tab's recommended link): the chat works but the breadcrumb reads "Home › Page not found". Shots: `ws-chat-registrar-alex-1280.png`, `ws-chat-qahelper-alex-1280.png`, `flow-w11-chat-hover-alex-1440.png`.

### Minor
- m1. Upload source Documents table at 1280: 1108 px in a 976 px card, the page scrolls 48 px, and Updated and the row "…" are cut off (Q4). `source-upload-documents-alex-1280.png`. The web source Pages table is also slightly too wide (1001 > 976).
- m2. Record sheets open only through "…" › View details. Clicking a row or its name does nothing (models, logs, keys, documents). `record-sheet.tsx` documents `onRowClick`, but no page uses it.
- m3. Notifications: primary "Mark all as read" on an empty inbox (Q5). Admin › `/notifications`. `ws-notifications-admin-1440.png`
- m4. Member at `/admin`: sees the full admin sidebar around "The admin portal is for platform admins and auditors.", and the shell fires `GET /v1/admin/attention` and `/v1/admin/models` (both 403). The h1 is "Administration" but the breadcrumb says "Overview". `admin-casey-1280.png`, `netsweep.txt`
- m5. Unknown agent id (`/teams/x/agents/<bad id>`): an inline red alert, no h1, and the breadcrumb says "Agent". This isn't the not-found template the team, route and admin pages use (P-05). `ws-notfound-agent-alex-1280.png`
- m6. The public-agents off confirmation doesn't list the agents that go offline (F-23). `flow-f23-public-switch-confirm-admin-1440.png`
- m7. Dirty sheets have no guard: type a name in New data source, press Esc, and it's gone. Pages have "Leave without saving?", sheets don't.
- m8. The document sheet has no Re-fetch / Re-index action (W3 listed it). `flow-document-sheet-alex-1440.png`
- m9. Moderation Team / Signed-in tabs with Provider = None still show the answer mode, Fail closed, block threshold, notice and the whole category table, which have no effect. `admin-moderation-team-admin-1440.png`
- m10. After cancelling the platform-role dialog (click or Esc), focus lands on `<body>`, not the Platform role select.

### Polish
- `document.title` is "Open RAG System" on every page. Tabs and history can't be told apart.
- The 404 breadcrumb repeats itself: "Home › Page not found › Page not found".
- Admin team Settings help text leaks "(DESIGN §4)".
- Classifications at 1280 break "Anonymou s: 24 hours" mid-word.
- Cells wrap to 3 lines: Analytics › Top agents at 1280 (team names) and agent Versions (model name).
- Auditor Overview shows the setup checklist's primary "Review models".
- The Team settings › Crawl domains tab content is headed "Domain requests".
- "Go home" on admin not-found pages goes to the workspace Home.
- The audit sheet URL is JSON-quoted (`?record=%22405%22`), and its diff shows the raw `chatModelId` UUID.
- KB Try it: the Filters popover clips its tag help at 900 px height.
- The widget preview repeats "nothing is stored" in two stacked header lines.
- The Notifications Type filter isn't in the URL.
- Row menus say "Delete" in some lists and "Delete…" in others.
- Document sheet passage previews show raw Markdown (`**2019**`, `[...](...)`).
- `/favicon.ico` returns the SPA HTML.
- Signed-out public pages make an expected but noisy `GET /v1/me` 401.

### Known leftovers (confirmed, not re-hunted)
- A9 filters are missing.
- A6 is a column + sheet.
- Overview doesn't flag failing models.
- The Test panel welcome avatar scrolls out on load (seen at 1280 and 1440).
- "MARKDOWN" casing is **fixed**.

## What's left
1. Fix M1 (sources table width at 1280: hide Classification/Type or make Used by compact, and stop the document-level overflow) and m1 (documents table).
2. Fix M2 (chat-by-short-name route breadcrumb).
3. Q5: hide or disable "Mark all as read" when there's nothing unread.
4. F-23: list the affected public agents in the confirmation.
5. Not-found template for bad agent/source/KB ids (P-05). Gate the admin shell for non-staff (m4).
6. W3: re-fetch in the document sheet. Row click opens the record sheet (m2). Unsaved guard on form sheets (m7).
7. Known: A9 filters, A6 tab, Overview flagging failing models, Test avatar scroll.
8. Not verified here: F-04, F-09, P-10, P-17, P-19 (need staged conflicts, a cross-origin widget host, model deletion, or team creation).
