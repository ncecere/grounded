# Content health report (roadmap B8, #22)

A bounded, opt-in report that tells a team's editors where its knowledge looks neglected or broken, so they know **what to investigate**: pages not processed for a long time, links a crawl saw fail, the same file in two sources, documents with **no retained citation evidence**, and documents that failed to parse. The decision is [ADR-0027](adr/0027-content-health-report.md); the runbook is [`operations/content-health.md`](operations/content-health.md).

It does not judge quality. Every signal is a *prompt to look*, with the evidence's limits written next to it. Nothing is changed, deleted, reclassified or re-crawled by the report, and no model is called.

## What it is not

- Not a live scan. Opening the page reads a stored snapshot; it never computes, fetches or probes anything.
- Not a link checker. It reports only failures **a crawl already observed** (below); it makes no request to any site.
- Not a quality score. There is no overall "health" number and nothing is shown as healthy when it could not be measured.
- Not a PII report. A hook is prepared for it (#37, [§ Extending](#extending-the-pii-report-37)); nothing is detected or invented now.

## Who can use it

| Who | Can |
|---|---|
| A team's **editors, admins and owners** (the existing content-management grant; the same people who see Gaps), signed in to the app | See the team's reports; make a report; cancel or delete one (cancel and delete also while the platform switch is off) |
| **Members** | Nothing (404) |
| **API keys** of every kind, **publishable keys**, anonymous callers | Nothing (404); browser sessions only, like the gap report and evaluations |
| **Platform admins and auditors** | The platform switch only (Admin → Settings → Features). No team's report, count, document, title or URL. **A break-glass session does not open it** (it is not one of the `documents` scope's listed reads; ADR-0024) |
| People outside the team | 404, as for any team route |

The report covers **the team's own sources** only. Platform-shared sources are left out: their documents are not readable by team members through the source pages, so listing their titles, or telling a team that its file also exists in a shared source, would show more than the team can see today. The report says so.

An archived team can read its reports but not make, cancel or delete one (`409 team_archived`).

## Opt-in

1. **A platform admin switches the feature on** (Admin → Settings → Features; off by default; audited `platform.content_health`). While it is off:
   - making a report is refused (`409 content_health_off`); opening a report, its findings or its coverage answers 404; a report being made stops at its next signal boundary (and again before it is stored) and ends as failed (`disabled`), and nothing more is scanned;
   - the list says it is off and shows the team's kept reports as **stubs** (when made, status, expiry, scope and thresholds; **no** signal, count or finding), and **cancel and delete still work** for the same people as always (editors, admins, owners of an active team, in the app). Members, keys of every kind, OAuth clients, platform staff (with or without break-glass) and outsiders get 404 for those too. This is so that switching the feature off can never strand a copy nobody may remove. An archived team stays read-only (`409 team_archived`) and its reports expire on their own;
   - kept reports stay stored, and come back, findings and all, with the switch.
2. **Nothing runs by itself.** There is no schedule. A report exists only because an editor pressed *Make a report*; each one is audited (`content_health.generate`).

## The signals

All ages and windows are measured from the report's **as-of time** (`asOf`, the instant the report started, shown on every report). Thresholds are chosen per report and shown with it.

| Signal | Key | What is counted | Observed from | Does **not** mean |
|---|---|---|---|---|
| **Not processed in a long time** | `stale` | A `ready` document whose **last successful processing** finished at least `staleDays` before `asOf` (default 365; 30 to 3650). Exactly `staleDays` old counts. Listed oldest first. | `documents.processed_at`, set each time ingestion finishes (a new or changed file, a retry, a re-parse after a parser upgrade). For a web page the date a crawl last confirmed the page exists is shown too, when a crawl record is kept. | That the *content* is outdated. Grounded does not know when an author last edited a page: a page re-processed by a parser upgrade looks newer than its text, and an unchanged policy page looks old. A server's `Last-Modified` header is not used (servers send it unreliably). **A web page a crawl saw again within the threshold is still listed, but flagged "Recently confirmed by a crawl" and counted (`recentlyConfirmed`)**: old by processing date, not necessarily neglected. A document with no processing date is counted as "age unknown", never as stale or fresh. |
| **Links that failed in the last crawl** | `broken_link` | A URL a web source's **latest completed crawl** tried to fetch that **failed**: a 404 or 410 (`not_found`), another non-success status (`http_error`, with the status), or a network or redirect error (`network_error`, no error text kept). | The crawl's own record (`web_frontier`), which Grounded keeps for the latest completed crawl of each source only. | That the link is still broken (it was observed once, at the crawl's end time, and is **not** re-checked), nor which page links to it (the crawler does not record that). URLs the crawler skipped (robots.txt, host not allowed, blocked address, out of scope, download links) are not failures. A source never crawled, whose latest completed crawl was a single-page re-fetch (which discards the full crawl's record), or whose record is gone is **unknown**, shown as such and never as "no broken links". Upload sources have no links (not applicable). **The address is stored without credentials, query and fragment** (userinfo, `?…` and `#…` are cut before storage, and each address is kept once); an address that cannot be made safe that way is counted (`addressesNotKept`), not stored. **Its path can still be sensitive** (an identifier, a name): treat the list like the source itself. It is shown only to the team's editors, and only while the observation holds: see "Findings are checked again on every read". |
| **The same file in two sources** | `duplicate` | `ready` documents of **different sources of this team, inside the report's scope**, with the identical **raw SHA-256** (`documents.sha256`: the hash of the original bytes as uploaded or fetched). Groups are listed largest first; each group lists at most 10 documents and says its true size when the report was made. | `documents.sha256`, computed by ingestion. | Near-duplicates. It is a **byte-identical** match only: the same text as a PDF and a DOCX, an HTML page with a changing timestamp or nonce, or a page with different navigation do not match. It is neither a parsed-text nor a normalised-text hash (those would need reading stored files or passages, which an unbounded report must not do; a later signal could add one). The hash is never shown. A document without a hash is counted, not compared. With a single source in scope the signal is not applicable. Shared sources and other teams are never compared. **The unit is the group**: found and listed are both groups, and a group is shown on a read only while at least two of its remaining members, in different sources of the report, still have the same bytes (a lone survivor, a member whose file changed, or one that moved is not shown as a duplicate). Pages hold whole groups. |
| **No retained citation evidence** (key `never_cited`) | `never_cited` | A `ready` document of a source that an **active, published agent of the team reaches through a knowledge base**, that existed when its source became reachable, and that **no retained answer event cites** in the **team-wide observation window**. | `message_events` (one content-free row per answer: team, time, channel, outcome flags and the cited document IDs; no question, answer, user or conversation), excluding draft test chats (`channel = test`), and the agents' publish times and knowledge-base attachments. | **That the document is never cited, unused, outdated or poor, and that it had a fair chance of being cited.** Grounded does not record which documents a question could have reached; the report only leaves out what it can show was not reachable or too new, and says how much. The window is **team-wide**: it starts at the later of `asOf − citationWindowDays` (default 90; 14 to 365) and the team's **first retained answer event**, which is when events begin, not when any document became reachable. Answers that left no event (no event was kept, or analytics retention removed it) are invisible; deleting a conversation does **not** remove its event. See below. |
| **Failed to parse or ingest** | `ingestion_failure` | A document that `failed`, or that needs OCR (`needs_ocr`: skipped as scanned, or a partly scanned PDF), or that has not finished ingesting after 24 hours (`pending`, `queued` or `processing`, not waiting for a daily limit). Each carries its error **code** and a reason class (`needs_ocr`, `ocr_error`, `damaged`, `other`, `not_finished`). | The document's stored status and error code; the same classes as Admin → Parsing & OCR. | The cause. Only the code is kept, never the parser's message (open the document for that). A document that parsed with warnings is not listed. |

### How "no retained citation evidence" is decided

It is not a score and not a claim about quality or fair exposure. Per source of the scope:

1. **Reachable?** An active, undeleted agent of the team whose *published* version searches a knowledge base that holds the source. A source in no knowledge base, or only in knowledge bases of unpublished, disabled, deleted or older versions, is **not served**: its documents are counted (`notServed`) and not listed. (The knowledge-base level is all that is known: per-document or tag filters in an agent's configuration are not considered.)
2. **Since when?** The later of the source's attachment to the knowledge base (`kb_sources.created_at`) and the agent's publish time of that version, **rounded up to the next UTC day**. This is a bound that can be later than the truth (earlier versions of the agent, or an earlier attachment of a source that was detached and re-attached, are not recorded and are not used), never earlier. No timestamp is invented: with none, the source is not judged. Shown per source as "reachable since".
3. **Enough answers since?** At least **50** kept answers *that could have cited something* by agents that reach the source, after that time. Counted: real answers (not draft test chats) with no error, not refused, with context, with at least one retrieved passage, and not blocked by moderation. Refusals, errors and the rest do **not** count toward any minimum. Fewer: the source is **not judged** (`fewAnswers`), so a team whose traffic is concentrated in one agent does not judge a quiet agent's sources against it.
4. **Existed then?** Only documents created no later than that time are judged; later ones are `tooNew`.
5. The team-wide total of such answers in the window must also reach 50 (`too_few_answers` or `no_answers` otherwise). Separately, **all retained non-test events in the window, including refusals, errors and answers without context**, count toward the scan bound: more than 1,000,000 makes the signal `unavailable: too_many_answers` before any exposure or citation read. The preflight counts one extra event to detect overflow; this is a bound on matching events, not on physical database rows visited. If no source can be judged it is `unavailable: no_exposure`, never a measured zero. The team's agents whose events are read are a fixed-order list bounded at **5,000**: more makes the signal `unavailable: too_many_agents`, never a silently partial answer.

A document that appears in any retained **non-test** event's citations in the whole window, whichever team agent or production channel, is *cited* and not listed—even if that event is an error or otherwise cannot count toward the minimum. Draft test-chat citations remain excluded. Each finding shows how many kept answers could have cited its source.

Per source, the report also shows its **coverage**, as of the report: the number of documents, whether its links were observed, unknown or not applicable, when the crawl it used finished, whether its addresses are still shown, and what the citation-evidence signal could say about it (judged, not served, too few answers, since when).

### What "unavailable" means

Each signal carries a `state`: `measured`, `not_applicable` (it cannot apply: no documents, one source for duplicates, no web source for links), or `unavailable` with a `reason` (`too_few_answers`, `no_answers`, `too_many_answers`, `too_many_agents`, `no_exposure`, `no_crawl_record`, `timed_out`). A signal that timed out leaves no half-written coverage behind: a source whose links it was reading is shown as unknown (`signal_timed_out`), never as observed. The page shows these in words. A count of zero is shown only for a measured signal.

### Scope

A report covers **all of the team's sources**, or **one source**, or **one knowledge base's** sources, chosen when it is made and shown with it. A scope filter restricts which documents every signal judges, including duplicates, which compare only inside the scope. It does **not** narrow the answer events read for citation evidence, which are the team's (a narrower scope does not lessen that work or its caps); only a shorter citation window does. Scope is also checked again on every read (see below).

## Off the query path

- Report work runs in a River job on its own queue (`content_health`, one worker per process), never in a request and never in the answer path. A request only inserts a row and a job.
- The `contenthealth` package's own files import no retrieval, answer, model, gateway, crawler or HTTP-client package (`net/url` is used only to parse an address), and no query-path package imports it (an import test fails if either changes). That test covers **direct imports only**: the package uses `teams`, which reaches `net/http` through `webhooks`, so the import graph alone does not prove the absence of calls. What is claimed is narrower: **no code on the report's path (a signal, the worker, the store) makes a network call or calls a model**; a signal receives an environment that holds a database handle and no client. As evidence, not proof, a test makes a whole report with the default HTTP transport replaced by one that counts and refuses, and the model connection pointing at a counting server, and asserts zero requests to both. A package with its own HTTP client would not be seen by that test.
- Each signal uses a **read-only, repeatable-read database transaction**. Its preflight and subsequent queries see the same snapshot, so an event committed later cannot bypass its cap; a signal cannot write through its database environment. These transactions last no longer than the signal's context budget.
- Opening the page runs **keyset-paged reads of stored rows** (page size at most 100) and nothing else. There is no refresh, no recompute and no "check now" on a link.
- Chat, retrieval, ingestion and crawling code is unchanged by this work.

## Bounds

| Bound | Value |
|---|---|
| Reports in progress per team | 1 (`409 content_health_active`) |
| Time between two reports of a team | 10 minutes after the previous one started (`409 content_health_wait`, `Retry-After`) |
| Reports kept per team | the latest 5; each for 30 days after it finished |
| Findings stored per signal | 1,000 (duplicates: 100 groups of at most 10 documents). The true count is stored and shown ("showing the first 1,000 of 4,210"). |
| Time per signal | 45 s **context deadline** of the report's own queries (not a server `statement_timeout`: the driver cancels the running statement on the server when it passes; a test with a real `pg_sleep` shows the backend stops), then that signal is `unavailable: timed_out`, its coverage is dropped, and the others continue |
| Time per report | 10 min of work (enforced by the service and worker), plus at most 10 s best-effort failure finalization; a stuck running report becomes eligible for the hourly cleanup after 15 min |
| Event window admitted for citation evidence | at most 1,000,000 retained non-test events, **including ineligible answers**, **team-wide** (a narrower scope does not reduce it; only a shorter window does), else unavailable; the preflight reads at most one extra matching event to detect overflow; at most 5,000 agents, else unavailable |
| Workers | the queue runs one report at a time per worker process |

The queries use the existing per-source indexes (`documents (source_id, sha256)`, `documents (source_id, status)`, `message_events (agent_id, created_at)`); no new index on a large table is added. A report **can be cancelled**: a queued one is cancelled at once, a running one stops at its next step (it checks between signals, and the platform switch too) and stores nothing more.

**Storing is safe against concurrent changes.** The signals are collected minutes before they are stored. The store claims the report's end (a cancel or delete waits for it), re-reads the switch, locks the sources and documents it is about to reference and skips any that were deleted, moved or left the scope meanwhile, adjusting the counts (`Found` falls by what vanished; `counts.vanished` says how many; a duplicate group that no longer spans two sources is dropped). A deletion therefore does not leave it running because of a foreign-key race. Successful storage keeps the report's cancellation/deadline context; an expired report cannot start a successful store. A store that fails returns the error and attempts to end the report as **failed** (`timed_out` for a deadline, `internal` otherwise), using a separate **10-second cleanup budget**, not an unbounded uncancellable context. If a database outage or lock prevents even that update, the failure is logged and the hourly stuck-report cleanup can recover it later; no terminal-state guarantee is made while the database cannot write.

## What is stored

The snapshot holds **IDs, enums, counts and times only**, plus the one URL a link failure is about. It does not copy a document's title, file name, text, passage, a parser message or a hash. Titles and names are read **live** when a page of findings is read, through the current team and source rows.

| Table | Holds |
|---|---|
| `content_health_settings` | The platform switch (singleton, `enabled` false, revision) |
| `content_health_reports` | One report: team, scope (source or knowledge base, both optional), thresholds, `as_of`, status, timestamps, expiry, a coarse error code, and per-signal results (state, reason, found, truncated, counts) |
| `content_health_pacing` | When a team last asked for a report (one row, so deleting a report does not reset the pause) |
| `content_health_sources` | One row per source in the scope: document counts, link state (with the crawl read and the source's revision and classification at the time), and the citation-evidence state, the time it became reachable and the answers since |
| `content_health_findings` | One row per finding: signal, source, document (nullable), a link URL without credentials, query or fragment (broken links only), group number and size at the time (duplicates), a code, a number (for citation evidence, the kept answers that could have cited its source), times |

**Deletion and leaks.** Findings and coverage rows reference documents and sources with `ON DELETE CASCADE`, so deleting a document or source removes its findings at that moment, and deleting a team removes its reports. No report holds anything from a conversation: "no retained citation evidence" stores document IDs of the team's own documents that were *absent* from the events, and no event, user, agent, conversation or question.

**Findings are checked again on every read.** A snapshot is one moment; every page of findings and every coverage list is joined to the team's rows as they are *now*, and a finding is returned only while it still holds:

- its source and document exist and belong to this team (a stored row can never join across teams);
- its source is **still in the report's scope**: the source for a source-scoped report, a source still in the knowledge base for a knowledge-base-scoped one (a source taken out of the knowledge base disappears from every signal and from the coverage, and returns if put back);
- for a **broken link**: its source's revision and classification are still what they were when the crawl was read (a retargeted, renamed or reclassified source is not what the crawl observed), and **no newer completed crawl** (including a single-page re-fetch, which discards the record) has replaced that observation. A newer failed or running crawl does not. The coverage says why the addresses are hidden (`linkRefs`: `source_changed` or `crawl_changed`);
- for a **duplicate**: at least two of its members, in different sources of the report, still have the same bytes.

The per-signal numbers are **as of the report**: `found` is what the report found when it was made, in the signal's unit (groups for duplicates); `listed` is what still holds now, in the same unit; the page says so ("still listed now"). The counts on the cards (`judged`, `ready`, ...) and the per-source document counts are not recomputed: they describe the moment of the report, whose as-of time is shown, and are not a statement about the present. Nothing is shown as healthy because findings later disappeared. Responses are `no-store`, so a browser or proxy does not keep a copy of a hidden scope.

**Retention and classification.** Source classification does not narrow what an editor of the team may read, so it does not filter the report, apart from the broken-link rule above (a classification change hides a link's address). Reports themselves are kept 30 days after they end (the latest 5 per team) whatever the classification. What the citation-evidence signal can see is what the **analytics events** keep, and that is governed as follows:

- `message_events.message_id` is `ON DELETE SET NULL`: **deleting a conversation (a user's delete after its grace period, or the classification level's conversation retention) deletes its messages but not its analytics event**, which keeps its time, its flags and the document IDs it cited. So a deleted conversation does not make a document look uncited, and does not lower the number of answers seen.
- Events are removed only by the **analytics-events period** (Administration → Retention, `RETENTION_ANALYTICS_EVENTS_DAYS`), a single platform-wide setting, kept by default; it is **not** the classification level's conversation retention. A shorter period leaves fewer events, so the window starts later and the signal can become unavailable; the report shows its effective start and how many answers it saw.
- A legal hold on an event's conversation, user, agent or team keeps its event too.

The audit entry for a report carries IDs and the thresholds, never a title, URL or count of cited documents (team audit logs are readable by platform staff).

## API (OpenAPI first)

| Operation | Who |
|---|---|
| `GET /v1/teams/{team}/content-health/reports` (reports, switch state, limits; stubs only while off) | Editors, admins, owners |
| `POST /v1/teams/{team}/content-health/reports` (`staleDays`, `citationWindowDays`, `sourceId` or `knowledgeBaseId`) → 202 | Editors, admins, owners (active team) |
| `GET …/reports/{reportId}` (report and per-source coverage) | Editors, admins, owners |
| `GET …/reports/{reportId}/findings?signal=&cursor=&limit=` | Editors, admins, owners |
| `POST …/reports/{reportId}/cancel`, `DELETE …/reports/{reportId}` | Editors, admins, owners (active team); also while the platform switch is off |
| `GET`, `PUT /v1/admin/settings/content-health` (`If-Match`) | Platform admins and auditors read; admins write |

Every route authorizes again from the database on each request (role, team status, the switch where it applies, the report's team, and for findings and coverage the live scope). A finding links to the source's page in the app; opening it applies that page's own authorization. The report has no action that changes content.

## Interface

**Team → Content health** (sidebar, beside Gaps; editors, admins, owners). It opens with what the report is and is not, the report-making form (scope, the two thresholds with their meaning), the current or latest report with its as-of time, a card per signal (state, found, limits, "what this does not mean"), the findings of the chosen signal in a table that stacks on a phone, with *Load more*, and the per-source coverage. A running report shows its status with a Cancel button and refreshes itself every few seconds until it ends. Everything is reachable by keyboard, each table has a caption, state is never conveyed by colour alone, and a status change is announced politely.

## Extending: the PII report (#37)

`internal/contenthealth` defines a `Signal` (name, how to collect, a typed `Result`) and a registry. The five signals above register in it. The PII report can register a sixth without a schema change: findings have a free-text `signal`, a `code` and a number. **Not done now:** no scanning, classification, pattern, or PII finding exists, no `pii` signal is in the registry or the API enum, and a test fails if one appears before its own decision. A future signal must keep the rule of this report: a finding is an ID and an enum (a class of pattern), **never the text that matched**.

## Compatibility

Migration 00058 only **creates** tables (`content_health_*`); it alters no existing table. Its foreign keys point from the new tables to existing ones, and the report job and its hourly prune job use the new `content_health` queue, which the previous release's workers do not take. The previous release neither reads nor writes them, and its workers do not take the new queue, so a rolling update or a rollback is safe; the feature is off until an admin turns it on after the rollout. Destructive changes would ship a release later (ADR-0013). Down: drops the tables.

## Limitations (also in the runbook)

- "Not processed in a long time" is last processing, not last edit; "no retained citation evidence" is bounded by what the analytics events kept, is team-wide, and does not establish that a document could have been cited (exposure is known only at the knowledge-base level, from the current attachment and publish times); broken links are one observation of one crawl, with no referring page, and their path may be sensitive; duplicates are byte-identical files only.
- The numbers on the cards and the per-source counts are as of the report and can disagree with the findings still listed; the difference is shown, not corrected.
- An archived team's reports cannot be cancelled or deleted by the team (read-only) and expire on their own.
- Not measured: near-duplicates, parse warnings, links inside uploaded documents, links on pages of shared sources, link health of pages behind a crawl's depth or page limit (the source's coverage notes a truncated crawl).
- Tested with fake models and fixtures only. Nothing here measures the quality of a real knowledge base or of answers.

## Tests

Unit: the boundary of `staleDays` (one second either side), threshold bounds, link classification, the import rules (no network or query-path package, nothing on the query path imports it), the signal registry (no PII signal) and that the migration only creates. Database integration: each signal against seeded rows (unknown vs zero), duplicates across two teams and with a shared source, read-time duplicate groups (deleting or changing one member, paging by whole groups, caps in groups), citation evidence (late attachment, new publication, concentrated traffic, the minimum counting only answers that could cite, agent and scan caps, scope), deleting a document or source or team and a source or document deleted between collecting and storing, stored addresses without credentials and their hiding on retarget, reclassification, knowledge-base detachment and newer crawl, report retention, **actual conversation deletion and analytics retention through the retention runner**, cancellation of a queued and a running report, the platform switch at the signal and store boundaries, cancel and delete while off for the same people only, a signal timeout (including a real `pg_sleep` being cancelled on the server and coverage not left observed), no HTTP request and no model call during a report, the bounds (caps, one active, cooldown), and that a chat answer, a crawl and an ingest are unchanged. Authorization: the matrix classifies every operation (owner, admin, editor, member, key, platform staff, break-glass); a dedicated test shows team A's titles and URLs reach nobody else. Main-thread review regressions additionally cover ineligible events exceeding the scan cap, retained citations before the first eligible answer, per-signal snapshot consistency and rejected writes, successful-store refusal after an expired deadline, and bounded failure-state persistence under a real row lock. Web: vitest with axe, keyboard and phone-width cases; a scoped browser run of the page.
