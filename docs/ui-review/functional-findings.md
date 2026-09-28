# Grounded: end-to-end functional QA (browser)

**Date:** 2026-09-26 (local), app at http://localhost:8080. Personas: Dev Platform Admin, Dev Platform Auditor, Alex (owner), Blair (editor), Casey (member → no team), Dev User, plus an anonymous session. Tool: agent-browser, one named session per persona.
**Screenshots:** `/tmp/ia-review/qa/f###-*.png`. Downloads: `/tmp/ia-review/qa/dl/`.
**Real AI gateway usage:** 3 chat turns on "Registrar assistant". Public-policy moderation also made classifier calls: 3 publish probes, 1 admin test box, and the moderation of each public QA Helper/widget message.

## Summary by area

| Area | Result | Notes |
|---|---|---|
| Auth & shell (sign in/out, deep link after sign-in, portal switch, team switcher, ⌘K, sidebar collapse, bell/inbox/settings) | Pass, with issues | F-12 breadcrumb, F-13 mark-all, F-22 switcher context, P-01 palette search |
| Teams & members (create, duplicate slug, add existing and new email → invite in Mailpit, role change, last-owner guard, remove, leave, archive/unarchive, limits override, approved classification) | Pass, with issues | F-05 silent validation, F-16 archived-team message, F-17 no unsaved guard |
| Data sources: upload (MD/TXT/PDF/DOCX, empty and corrupt rejected, broken PDF failed then retried, replace by name, tags, delete, search/filter, pause/resume, classification up/down with reason) | Pass, with issues | F-06 pending tags lost, F-21 paused dropzone, P-06 raw parser error |
| Data sources: web (preview/map, crawl 5 pages, list mode, single page, disallowed host, sync, cancel, stale-page removal, schedule, delete) | Pass, with issues | F-14 preview ≠ crawl set, P-07 duplicated "Cancelled" |
| Domain requests (request, validation, approve/deny/revoke with note, requester notification + email, allowlist effect) | Pass | P-15 already-pending hint, P-16 admin gets no signal |
| Knowledge bases (create, top-k validation, attach team + shared, profile mismatch "Why?", fusion weights save/revert/validation, Try-it filters/top-k, detach, delete, `kb_in_use`) | Pass | P-12 no confirm on detach |
| Agents (create, every config section, autosave, 2-session conflict, appearance and contrast, starters, draft test, publish team/public, versions/revert, share, analytics, disable/enable, delete, publish validation) | Pass, with issues | F-04 conflict loses edit, F-15 publish copy, F-18 moderation override, F-26 status text |
| Chat (streaming, stop, citations → source card, web-link citation, reasoning, feedback + reason, copy, rename, export MD/JSON, delete, starters, new conversation, 800 px sheet, keyboard only) | Pass, with issues | F-10 error-message affordances |
| Public & widget (public publish, short name + validation, anonymous page, axe 0 violations, widget open/ask/Esc, bad origin, disabled agent, directory for Casey, public switch off/on) | Issues | F-01, F-02, F-07, F-08, F-09, F-23 |
| API keys (personal/service, scopes by role, KB restriction, secret shown once, `/retrieve`, OpenAI-compatible stream and non-stream, cross-team denied, revoke) | Pass, with issues | F-27 missing agent restriction and service-key contact |
| Admin (users, teams, connections test, models add/test/disable/delete, profiles, shared sources + impact preview, allowlist, classifications, agents kill switch + short names, moderation test, public access, limits, analytics + CSV, access log, audit filters) | Pass, with issues | F-03 role grant, F-23 public switch, P-04 self-suspend |
| Auditor | Pass | All controls disabled or absent; API mutation returns 403 `forbidden` |
| Member / editor role behaviour | Pass, with issues | F-24 members see usage, P-03 editor can reach publish-to-public |
| Console / network | Pass | No console errors or page errors on any workspace or admin page; the only 4xx were intended (401 before sign-in, 409 duplicate slug, 400 reserved short name) |

**Counts:** 0 blocker · 4 major · 20 minor · 21 polish (45 issues).

---

## Issues

### F-01 · Major · Moderation / public agents: the gateway classifier times out and fails closed
- **Steps:**
  1. As Alex, set QA Helper's audience to Public and click Publish. It failed twice.
  2. Separately, chat with Registrar assistant (a public agent), or with QA Helper while it was public.
- **Expected:** The public safety check completes. If the provider is down, the error clearly says the safety check is unavailable.
- **Actual:**
  - Publish failed twice, about 10 s each time, with "The moderation provider did not answer a test request: proxy unavailable: timed out". The third attempt succeeded in 5 s.
  - Chat answers were withheld after 10–18 s with "The assistant can't answer right now. Please try again later."
  - Server log: `moderation check failed stage=output|input err="proxy unavailable: timed out" failClosed=true`. `MODERATION_TIMEOUT` is 10 s.
  - The same classifier answered the admin test box in 892 ms, so it is intermittent. The model's answer tokens are wasted and the message misleads.
- **Screenshots:** f091-publish-public-result.png, f125 (gateway answer), f155-web-citation.png
- **Fix:**
  - Retry once, or raise the timeout for chat-as-classifier providers.
  - Show a specific message, for example "Safety check unavailable. Try again."
  - Consider caching a recent successful readiness probe for publishing.

### F-02 · Major · Moderation: benign registrar question blocked
- **Steps:** Ask Registrar assistant "List every step to drop a class after the deadline, in detail."
- **Expected:** The question is answered.
- **Actual:**
  - "This message can't be answered because it may break the usage policy." (input blocked in 955 ms).
  - Admin → Analytics → Moderation by category shows 1 Illicit activity block today. It also shows 7 Violence question blocks over the two days, which are probably also false positives.
  - The public policy blocks every category at 50 % with an uncalibrated chat-as-classifier ("Not calibrated").
- **Screenshots:** f127-stopped.png, f148-admin-analytics.png
- **Fix:** Raise thresholds or flag instead of block for the uncalibrated provider. Add a test set of benign domain questions. Show the category to admins in the access or analytics drill-down.

### F-03 · Major · Admin users: platform role changes apply immediately from a dropdown
- **Steps:** Admin → Users → Dev User → change "Platform role" from None to Platform admin.
- **Expected:** A confirmation, because this grants full platform administration.
- **Actual:** The role is applied immediately, with only a toast. One mis-selection on the dropdown escalates privileges. Reverted to None afterwards.
- **Screenshot:** f130-grant-admin.png
- **Fix:** Show a confirm dialog when granting admin or auditor, naming the user and the powers granted.

### F-04 · Major · Agent editor: an autosave conflict discards the user's edit
- **Steps:**
  1. Open QA Helper as Alex and as Blair.
  2. Blair edits Instructions and it autosaves.
  3. Alex then edits Instructions.
- **Expected:** Alex is warned and can keep or merge his text.
- **Actual:** The banner says "This agent was changed somewhere else. We loaded the latest version. Your most recent edit wasn't saved; make it again". Alex's typed text is gone. Instructions can be 20,000 characters.
- **Screenshot:** f072-conflict.png
- **Fix:** Keep the rejected local value and offer "Copy my version" or "Overwrite", or show a diff.

### F-05 · Minor · Forms: several fields show only a red border, with no message
- **Where:**
  - Create team, empty submit (f003).
  - Add member with "not-an-email" (f013).
  - API key with a past expiry date (f117).
  - Team Limits "Custom value" set to `-5`, `abc` or `0`: the save bar silently disappears (f009).
- **Expected:** An inline message, as the domain-request, fusion-weight and temperature fields already show.
- **Actual:** Forms use `noValidate` and set `aria-invalid`, but give no text. Screen readers and users don't learn what's wrong.
- **Fix:** Pass constraint-validation messages into the Field `error`.

### F-06 · Minor · Upload: typed-but-uncommitted tags are silently dropped
- **Steps:**
  1. On the source overview, type "handbook, qa" in "Tags for these files" without pressing Enter.
  2. Add files without blurring the input. This was reproduced by setting files programmatically. Drag-and-drop from the OS behaves the same, because focus doesn't move.
- **Expected:** The tags are applied.
- **Actual:** The files were uploaded with `tags: []` (API confirmed). TagInput only commits pending text on Enter, comma or blur.
- **Screenshot:** f029-documents.png
- **Fix:** In `upload.tsx`, commit the TagInput's pending text before `uploadFiles`, or keep the pending text in the parent state.

### F-07 · Minor · Share tab: "Team address" of a public agent asks anonymous visitors to sign in
- **Steps:** Publish QA Helper to Public with no short name, then open `http://localhost:8080/a/qa-team/qa-helper` signed out.
- **Expected:** The public chat page, or the Share tab marks which link works without signing in.
- **Actual:** The sign-in page. Only `/a/id/<id>` and the short name `/a/qahelper` show the public page. The Share tab lists "Team address" first.
- **Screenshot:** f104-public-page.png
- **Fix:** Serve the public page for team URLs of public agents, or label the links "for signed-in people" and "public link".

### F-08 · Minor · Widget keys: an origin without a scheme becomes `https://`
- **Steps:** Create a widget key with origin `localhost:8095`.
- **Expected:** The dialog asks for a scheme, or keeps `http` for localhost.
- **Actual:** It is stored as `https://localhost:8095` with no notice, so the widget demo on `http://localhost:8095` would be refused. Fixed by editing.
- **Screenshot:** f099-key-invalid.png
- **Fix:** Require a scheme, or show the normalised origin as a chip before saving.

### F-09 · Minor · Widget on a disallowed origin shows a broken panel
- **Steps:** Open the widget demo at `http://127.0.0.1:8095` (not in allowed origins) and click the launcher.
- **Expected:** No launcher, or a friendly "This site isn't allowed" message.
- **Actual:** The launcher renders, and the panel shows Chrome's "localhost refused to connect" error.
- **Screenshot:** f103-widget-bad-origin.png
- **Fix:** In `widget.js`, check the origin against the key before rendering the launcher.

### F-10 · Minor · Chat errors are presented like answers
- **Steps:** Trigger a withheld or blocked answer (F-01 or F-02).
- **Expected:** An error style without rating buttons, and the live region announces the error.
- **Actual:** "Copy answer", "Good answer" and "Bad answer" are shown on the error text. The polite live region says "Answer ready".
- **Screenshots:** f125 (gateway answer), f127-stopped.png

### F-12 · Minor · Breadcrumb doesn't follow team tabs
- **Steps:** Team page → Members or "Usage & limits".
- **Expected:** The breadcrumb reads "QA Team › Members".
- **Actual:** It reads "QA Team › Overview", even though the URL is `?tab=members`.
- **Screenshots:** f020-after-revoke.png, f163-member-usage.png

### F-13 · Minor · Notifications: "Mark all as read" only marks the filtered type
- **Steps:** Inbox → Unread → Type "Domain request decided" → Mark all as read.
- **Expected:** Either all notifications are marked, or the button says "Mark these as read".
- **Actual:** Only that type was marked. The bell still showed 2 unread (API confirmed).

### F-14 · Minor · Crawl preview doesn't match what the crawl fetches
- **Steps:** New web source, crawl `https://registrar.example.edu/`, depth 1, 5 pages, sitemaps off, then Preview pages.
- **Expected:** The crawl fetches the previewed pages.
- **Actual:**
  - The preview listed `/`, `/forms`, `/registration/audit`, `/registration/drop-add` and `/registration/employee-education`.
  - The crawl fetched `/`, `/courses/class-times`, `/courses/aleks` and two PDFs.
  - The preview implies "the pages the crawl would find".
- **Screenshots:** f041-crawl-preview.png, f045-pages.png

### F-15 · Minor · Publish dialog copy ignores the audience
- **Steps:** Set the audience to Public, then click Publish.
- **Actual:** The dialog says "Team members will chat with this configuration."
- **Screenshot:** f089-publish-public.png
- **Fix:** Name the audience ("Anyone, without signing in, …").

### F-16 · Minor · Archived team: the agent editor gives the owner the wrong reason
- **Steps:** Admin archives QA Team. Alex (owner) opens QA Helper.
- **Actual:** "Only editors, admins and owners can configure agents." The sources page correctly says "This team is archived".
- **Screenshot:** f133-archived-agent.png

### F-17 · Minor · No unsaved-changes guard on Limits and team limits
- **Steps:** Admin → Limits → change a default → click "Users" in the sidebar.
- **Actual:** The edit is discarded silently, even though a sticky "Discard / Save limits" bar was shown.

### F-18 · Minor · Agent moderation override has no effect on the Team audience and doesn't say so
- **Steps:** Team-audience agent → Moderation → Stricter category rules → Violence questions: Block.
- **Actual:** The rule saves ("1 category tightened"), but the platform Team policy's provider is "None", so nothing checks it. No warning is shown.
- **Screenshot:** f158-agent-moderation.png

### F-19 · Minor · Classification-raise dialog gives the wrong reason
- **Steps:** Raise QA uploads to Sensitive while a public agent uses it.
- **Actual:**
  - The dialog body says "those agents need a chat model approved for the level". It also starts a sentence with a lowercase "those".
  - The table correctly says "Its audience (public) isn't allowed for Sensitive data".
  - The field help mentions only the chat model.
- **Screenshot:** f144-raise-with-public-agent.png

### F-21 · Minor · Paused upload source still offers the drop zone
- **Steps:** Settings → Pause source → Overview → upload a file.
- **Actual:**
  - The drop zone is active. After the upload you get "This source is paused. Resume it to upload files."
  - The button to fix it is labelled "Activate source", not "Resume".
- **Screenshots:** f037-paused-overview.png, f038-upload-while-paused.png

### F-22 · Minor · Team switcher doesn't follow the chat page's team
- **Steps:** Signed in (default team Registrar), open `/a/qa-team/qa-helper`.
- **Actual:** The switcher shows the Registrar team while chatting with a QA Team agent.
- **Screenshot:** f085-chat-800.png

### F-23 · Minor · Public switch turns off every public agent with one click
- **Steps:** Admin → Public access → click the "Allow public agents" switch.
- **Actual:** It turns off immediately, with only a toast. Public pages then show "Public chat is turned off". It was turned back on.
- **Screenshots:** f160-public-off-confirm.png, f161-public-off-page.png

### F-24 · Minor · Members can see "Usage & limits"
DESIGN §3.5 gives members no access to team usage (editors are read-only). Casey, as a member, sees the full usage tab.
- **Screenshot:** f163-member-usage.png

### F-25 · Minor · API keys: no agent restriction, and service keys have no responsible contact
DESIGN §3.3 says keys can be restricted to KBs or agents, and team service keys have a named responsible contact. The dialog only offers KB restriction, and the list has no contact column.
- **Screenshot:** f114-owner-apikey.png

### F-26 · Minor · Stale "Draft saved" and summary while a field is invalid
- **Steps:** Set Temperature to 5.
- **Actual:**
  - The field shows "Enter a number from 0 to 2", but the header still says "Draft saved", although the value isn't saved.
  - Similarly, the KB fusion summary shows "-3 keyword" before validation.
- **Screenshots:** f070-temp-invalid.png, f067-fusion-invalid.png

### Polish

| ID | Area | Observation | Screenshot |
|---|---|---|---|
| P-01 | ⌘K palette | "Search or jump to…" finds only pages, teams and actions, not agents, KBs or sources by name ("registrar assistant" → No results). | f023 |
| P-02 | Publish to public | Takes about 5 s (a synchronous moderation probe) with only a spinner. Add "Checking public safety…" text. | f090 |
| P-03 | Editor role | An editor can open Publish with a Public draft audience and is refused only after submitting. Disable the button or warn up front. | f154 |
| P-04 | Self-management | The admin can open "Suspend" on themselves (the last admin), and a sole owner can click "Leave team". Both are refused by the server, but the controls could be disabled with a reason. | f018, f019 |
| P-05 | Unknown team URL | `/teams/not-a-team` renders a placeholder "Team" workspace and sidebar with an inline error instead of a not-found page. | f168 |
| P-06 | Documents | The failed-document reason exposes raw parser text: "document is damaged…: 3: incorrect format". | f029 |
| P-07 | Crawl history | The status shows "Cancelled Cancelled" (badge plus note). | f047 |
| P-08 | Home, no team | "Chat with agents your teams have published" for a user with no team. "Request a new team" has no link, because TEAM_REQUEST_URL is unset. The avatar reads "NY". | f164, f001 |
| P-09 | Versions | Reverting to the live version shows "Test it, then publish to make it live" although the draft equals live. | — |
| P-10 | Models | The test-result banner stays after the model is deleted. | — |
| P-11 | Toasts | Bottom-right toasts cover the "Activate source" and "Delete source" buttons for about 5 s. | f037 |
| P-12 | KB sources | Detaching a source from a KB used by a live agent has no confirmation. Invite revoke also has none. | — |
| P-13 | Web ingest | Main-content extraction produced a chunk that is only image alt text, "[Image: Front side of <campus building>]", which was then cited. | f157 |
| P-14 | Widget preview | The preview composer shows a 0/8,000 limit, while the real public limit is 2,000. | f097 |
| P-15 | Domain requests | The "isn't on the allowlist" alert offers "Request this domain" even when a request is already pending. | f051 |
| P-16 | Domain requests | Admins get no notification or badge for new pending requests. | — |
| P-17 | Create team | The duplicate-slug error is form-level, not on the Slug field. The slug help text uses an odd example, "/a/registrar/advising". | f005 |
| P-18 | Source settings | The "Raising it is blocked…" help lists only the model reason (see F-19). | f144 |
| P-19 | Conflict banner | The "changed somewhere else" banner persists across tabs after the next successful save. | f075 |
| P-20 | Notification settings | Toggles save silently. A small "Saved" status would help. | f055 |
| P-21 | Team limits | Custom limits accept any value (Agents = 100,000) when no ceiling is set. That is correct, but consider showing "no ceiling". | f010 |

Totals: 4 major (F-01…F-04), 20 minor (F-05…F-26; IDs F-11 and F-20 are unused), 21 polish (P-01…P-21).

---

## What worked well
- **Dev sign-in, deep links and permissions:** dev sign-in, deep-link return after sign-in, a clean sign-out, and a clear suspended-account message. Permission enforcement is consistent: members get explanatory info banners, the auditor sees disabled controls, and the API returns 403.
- **Teams:** the last-owner guard on role change and leave, invite emails with expiry, and role-change emails.
- **Sources:**
  - Upload validation rejects empty files and files whose extension lies. Replace-by-name keeps the version. Retry, tags, and search with status filter work.
  - Lowering a classification requires a reason of at least 10 characters.
  - Deleting a source is blocked, with the KB named. `kb_in_use` names the agent.
  - The shared-source impact preview lists the affected KBs and agents.
- **Web sources and domains:**
  - The allowlist error has a "Request this domain" action, and approve, deny and revoke take effect immediately.
  - Stale-page removal in list mode works, as do cancel crawl, schedule and next-sync display.
  - Domain-request notifications arrive in the app and by email.
- **Agent editor:** autosave, the accent contrast checker, starters with a live preview, "Unpublished changes", version view and revert, a publish checklist with deep links, and kill-switch reasons shown to the team.
- **Chat:**
  - SSE streaming, Stop (with the partial answer kept and focus returned), `[n]` citations that focus the source card, and web citations with external links.
  - Reasoning disclosure, feedback reasons, Markdown and JSON export, rename, and delete with a retention note.
  - The 800 px conversation sheet, and a logical keyboard Tab order ending at the composer, with Enter to send and Shift+Enter for a newline.
- **Public, widget and API:** the public page (axe: 0 violations), a disabled-agent message, the short-name validation and reserved list, and widget Esc to close. The OpenAI-compatible endpoint (stream and non-stream, with citations) works, and cross-team agents are denied.
- **Admin:**
  - Limits has a sticky save bar with Discard and per-tab error aggregation, and the audit log has good filters and JSON details.
  - The access log explains why it's empty, analytics CSV works, and connection and model tests are fast.
- **Console:** no console errors on any page.

**Harness note (not an app bug):** uploading from `/tmp/...` through agent-browser caused an XHR network error, which the UI reported as "The upload failed. Check your connection and try again." Uploading the same files via `/private/tmp/...` worked.

---

## Test data created (for cleanup)
- **Team:**
  - **QA Team** (`qa-team`, approved Sensitive, owner Alex, Blair editor). Team limit override: Agents = 10.
  - Casey joined then left. Dev User was added then removed. The invite for `qa.invitee@example.org` was revoked.
- **Sources:**
  - **QA uploads** (`aaa4207b-fefe-4b79-b098-c6ad0d710666`): upload source, 5 documents, one of them a failed `broken.pdf`.
  - **QA registrar crawl** (`10ed4d6f-6da3-4375-ae04-a659b00ac266`): web source in list mode with 2 registrar.example.edu pages. The schedule is set back to Manual.
  - "QA single page" was deleted.
- **Shared source:** **QA shared uploads** (`fa0d2994-c84b-4dab-9025-faf2db59a5c9`), fake profile, attached to QA KB.
- **KB:** **QA KB** (`3b1d5787-2854-4036-bf38-a4738d10cc83`), with QA uploads, QA registrar crawl, Academic calendar (shared) and QA shared uploads. "QA KB mismatch" was deleted.
- **Agent:**
  - **QA Helper** (`b0d98d2e-2577-4045-b342-956980af78ef`), fake model, v3 live with a Team audience. v2 was Public.
  - Short name **`qahelper`** (assigned by the admin).
  - Its widget key "QA widget demo" was revoked. "QA Throwaway" was deleted (soft).
- **API keys:** "QA personal key" and "QA service key" were created and both revoked.
- **Domain requests (QA Team):** `docs.example.org` (approved, then revoked) and `*.example.com` (denied).
- **Admin objects:** model "QA fake chat (delete me)" was created and deleted. Allowlist pattern `qa-test.example.net` was added and removed.
- **Conversations:**
  - Alex has QA Helper conversations "QA cafeteria chat", "line one" and "What are the class meeting times?", plus one deleted.
  - Alex also has a Registrar assistant conversation "How do I request an official transcript?" with 3 turns.
  - There is an anonymous widget/public conversation.
- **Dev User:** role changed to auditor, then admin, then back to None. Suspended and reactivated.
- **Temporary state changes, all restored:**
  - QA Team approved classification went Sensitive → Open → Sensitive.
  - QA Team was archived, then unarchived.
  - QA Helper was disabled by the team, then enabled. It was disabled by the platform, then enabled.
- **Local files:** `/tmp/qa-files/` (test documents and revoked key text). The widget demo process was stopped.

**Platform state:**
- **Public access:** the "Allow public agents" switch is **ON**. I turned it off and on again to test it, and verified it after a reload.
- **Limits:** the Knowledge bases default went 50 → 51 → **50** (verified after reload). The KB ceiling change was discarded.
- **Moderation:** policies were not modified; only the test box was used.
- **Existing objects:** Registrar assistant, Records helper, the registrar KB and source, and the gateway connection and models were not changed.
