# Content health report (roadmap B8, #22)

A bounded, opt-in report that tells a team's editors where its knowledge looks neglected or broken, so they know **what to investigate**: pages not processed for a long time, links a crawl saw fail, the same file in two sources, documents no answer has cited, and documents that failed to parse. The decision is [ADR-0027](adr/0027-content-health-report.md); the runbook is [`operations/content-health.md`](operations/content-health.md).

It does not judge quality. Every signal is a *prompt to look*, with the evidence's limits written next to it. Nothing is changed, deleted, reclassified or re-crawled by the report, and no model is called.

## What it is not

- Not a live scan. Opening the page reads a stored snapshot; it never computes, fetches or probes anything.
- Not a link checker. It reports only failures **a crawl already observed** (below); it makes no request to any site.
- Not a quality score. There is no overall "health" number and nothing is shown as healthy when it could not be measured.
- Not a PII report. A hook is prepared for it (#37, [§ Extending](#extending-the-pii-report-37)); nothing is detected or invented now.

## Who can use it

| Who | Can |
|---|---|
| A team's **editors, admins and owners** (the existing content-management grant; the same people who see Gaps), signed in to the app | See the team's reports; make a report; cancel or delete one |
| **Members** | Nothing (404) |
| **API keys** of every kind, **publishable keys**, anonymous callers | Nothing (404); browser sessions only, like the gap report and evaluations |
| **Platform admins and auditors** | The platform switch only (Admin → Settings → Features). No team's report, count, document, title or URL. **A break-glass session does not open it** (it is not one of the `documents` scope's listed reads; ADR-0024) |
| People outside the team | 404, as for any team route |

The report covers **the team's own sources** only. Platform-shared sources are left out: their documents are not readable by team members through the source pages, so listing their titles, or telling a team that its file also exists in a shared source, would show more than the team can see today. The report says so.

An archived team can read its reports but not make, cancel or delete one (`409 team_archived`).

## Opt-in

1. **A platform admin switches the feature on** (Admin → Settings → Features; off by default; audited `platform.content_health`). While it is off, making a report is refused (`409 content_health_off`), the list says it is off, and every other report route answers 404. Existing reports stay stored and come back with the switch.
2. **Nothing runs by itself.** There is no schedule. A report exists only because an editor pressed *Make a report*; each one is audited (`content_health.generate`).

## The signals

All ages and windows are measured from the report's **as-of time** (`asOf`, the instant the report started, shown on every report). Thresholds are chosen per report and shown with it.

| Signal | Key | What is counted | Observed from | Does **not** mean |
|---|---|---|---|---|
| **Not processed in a long time** | `stale` | A `ready` document whose **last successful processing** finished at least `staleDays` before `asOf` (default 365; 30 to 3650). Exactly `staleDays` old counts. Listed oldest first. | `documents.processed_at`, set each time ingestion finishes (a new or changed file, a retry, a re-parse after a parser upgrade). For a web page the date a crawl last confirmed the page exists is shown too, when a crawl record is kept. | That the *content* is outdated. Grounded does not know when an author last edited a page: a page re-processed by a parser upgrade looks newer than its text, and an unchanged policy page looks old. A server's `Last-Modified` header is not used (servers send it unreliably). A document with no processing date is counted as "age unknown", never as stale or fresh. |
| **Links that failed in the last crawl** | `broken_link` | A URL a web source's **latest completed crawl** tried to fetch that **failed**: a 404 or 410 (`not_found`), another non-success status (`http_error`, with the status), or a network or redirect error (`network_error`, no error text kept). | The crawl's own record (`web_frontier`), which Grounded keeps for the latest completed crawl of each source only. | That the link is still broken (it was observed once, at the crawl's end time, and is **not** re-checked), nor which page links to it (the crawler does not record that). URLs the crawler skipped (robots.txt, host not allowed, blocked address, out of scope, download links) are not failures. A source never crawled, whose latest completed crawl was a single-page re-fetch (which discards the full crawl's record), or whose record is gone is **unknown**, shown as such and never as "no broken links". Upload sources have no links (not applicable). |
| **The same file in two sources** | `duplicate` | `ready` documents of **different sources of this team, inside the report's scope**, with the identical **raw SHA-256** (`documents.sha256`: the hash of the original bytes as uploaded or fetched). Groups are listed largest first; each group lists at most 10 documents and says its true size. | `documents.sha256`, computed by ingestion. | Near-duplicates. It is a **byte-identical** match only: the same text as a PDF and a DOCX, an HTML page with a changing timestamp or nonce, or a page with different navigation do not match. It is neither a parsed-text nor a normalised-text hash (those would need reading stored files or passages, which an unbounded report must not do; a later signal could add one). The hash is never shown. A document without a hash is counted, not compared. With a single source in scope the signal is not applicable. Shared sources and other teams are never compared. |
| **Not cited in the window** | `never_cited` | A `ready` document that existed throughout the **observation window** and appears in **no** answer's citations in it. | `message_events` (one content-free row per answer: team, time, channel and the cited document IDs; no question, answer, user or conversation), excluding draft test chats (`channel = test`). | That the document is useless. Answers that left no event are invisible: events of conversations a person deleted, and anything removed by the analytics-events retention period, are gone. The window starts at the later of `asOf − citationWindowDays` (default 90; 14 to 365) and the team's **oldest remaining answer event**, and only documents created before that start are judged; the report shows the effective start, how many answers it saw, and how many documents were too new to judge. With fewer than **50 answers** observed (or more than the scan bound) the signal is **unavailable** with that reason, not an empty or full list. A document in no knowledge base is marked so: it could never have been cited. |
| **Failed to parse or ingest** | `ingestion_failure` | A document that `failed`, or that needs OCR (`needs_ocr`: skipped as scanned, or a partly scanned PDF), or that has not finished ingesting after 24 hours (`pending`, `queued` or `processing`, not waiting for a daily limit). Each carries its error **code** and a reason class (`needs_ocr`, `ocr_error`, `damaged`, `other`, `not_finished`). | The document's stored status and error code; the same classes as Admin → Parsing & OCR. | The cause. Only the code is kept, never the parser's message (open the document for that). A document that parsed with warnings is not listed. |

Per source, the report also shows its **coverage**: the number of documents, whether its links were observed, unknown or not applicable, and when the crawl it used finished.

### What "unavailable" means

Each signal carries a `state`: `measured`, `not_applicable` (it cannot apply: no documents, one source for duplicates, no web source for links), or `unavailable` with a `reason` (`too_few_answers`, `no_answers`, `too_many_answers`, `no_crawl_record`, `timed_out`). The page shows these in words. A count of zero is shown only for a measured signal.

### Scope

A report covers **all of the team's sources**, or **one source**, or **one knowledge base's** sources, chosen when it is made and shown with it. A scope filter restricts every signal, including duplicates, which compare only inside the scope.

## Off the query path

- Report work runs in a River job on its own queue (`content_health`, one worker per process), never in a request and never in the answer path. A request only inserts a row and a job.
- The `contenthealth` package imports no retrieval, answer, model, gateway, crawler or HTTP-client package, and no query-path package imports it (an import test fails if either changes). It makes **no network call**.
- Opening the page runs **keyset-paged reads of stored rows** (page size at most 100) and nothing else. There is no refresh, no recompute and no "check now" on a link.
- Chat, retrieval, ingestion and crawling code is unchanged by this work.

## Bounds

| Bound | Value |
|---|---|
| Reports in progress per team | 1 (`409 content_health_active`) |
| Time between two reports of a team | 10 minutes after the previous one started (`409 content_health_wait`, `Retry-After`) |
| Reports kept per team | the latest 5; each for 30 days after it finished |
| Findings stored per signal | 1,000 (duplicates: 100 groups of at most 10 documents). The true count is stored and shown ("showing the first 1,000 of 4,210"). |
| Time per signal | 45 s (statement timeout), then that signal is `unavailable: timed_out` and the others continue |
| Time per report | 10 min (job timeout); a report whose worker died is marked failed after 15 min |
| Answer events read for "not cited" | at most 1,000,000 in the window, else unavailable |
| Workers | the queue runs one report at a time per worker process |

The queries use the existing per-source indexes (`documents (source_id, sha256)`, `documents (source_id, status)`, `message_events (agent_id, created_at)`); no new index on a large table is added. A report **can be cancelled**: a queued one is cancelled at once, a running one stops at its next step (it checks between signals and before each write) and stores nothing more.

## What is stored

The snapshot holds **IDs, enums, counts and times only**, plus the one URL a link failure is about. It does not copy a document's title, file name, text, passage, a parser message or a hash. Titles and names are read **live** when a page of findings is read, through the current team and source rows.

| Table | Holds |
|---|---|
| `content_health_settings` | The platform switch (singleton, `enabled` false, revision) |
| `content_health_reports` | One report: team, scope (source or knowledge base, both optional), thresholds, `as_of`, status, timestamps, expiry, a coarse error code, and per-signal results (state, reason, found, truncated, counts) |
| `content_health_sources` | One row per source in the scope: document counts and link state |
| `content_health_findings` | One row per finding: signal, source, document (nullable), a link URL (broken links only), group number and size (duplicates), a code, a number, times, a knowledge-base flag |

**Deletion and leaks.** Findings and coverage rows reference documents and sources with `ON DELETE CASCADE`, so deleting a document or source removes its findings at that moment, and deleting a team removes its reports. Reading re-joins the live document and source of **this team**, so a row whose document moved or no longer exists is not returned. A report's stored per-signal counts are only numbers; it shows both the count at generation and the number still listed. A finding whose document changed after the report shows "changed since this report" (`updated_at > as_of`). No report holds anything from a conversation: "not cited" stores document IDs of the team's own documents that were *absent* from the events, and no event, user, agent, conversation or question.

**Classification.** Source classification does not narrow what an editor of the team may read, so it does not filter the report. It matters in two ways, both stated: conversation and analytics retention follow the classification (a shorter period leaves fewer events, so the not-cited window shrinks and the report says so), and nothing in a report is shown to anyone who could not already read the source. The audit entry for a report carries IDs and the thresholds, never a title, URL or count of cited documents (team audit logs are readable by platform staff).

## API (OpenAPI first)

| Operation | Who |
|---|---|
| `GET /v1/teams/{team}/content-health/reports` (reports, switch state, limits) | Editors, admins, owners |
| `POST /v1/teams/{team}/content-health/reports` (`staleDays`, `citationWindowDays`, `sourceId` or `knowledgeBaseId`) → 202 | Editors, admins, owners (active team) |
| `GET …/reports/{reportId}` (report and per-source coverage) | Editors, admins, owners |
| `GET …/reports/{reportId}/findings?signal=&cursor=&limit=` | Editors, admins, owners |
| `POST …/reports/{reportId}/cancel`, `DELETE …/reports/{reportId}` | Editors, admins, owners (active team) |
| `GET`, `PUT /v1/admin/settings/content-health` (`If-Match`) | Platform admins and auditors read; admins write |

Every route authorizes again from the database on each request (role, team status, the switch, the report's team). A finding links to the source's page in the app; opening it applies that page's own authorization. The report has no action that changes content.

## Interface

**Team → Content health** (sidebar, beside Gaps; editors, admins, owners). It opens with what the report is and is not, the report-making form (scope, the two thresholds with their meaning), the current or latest report with its as-of time, a card per signal (state, found, limits, "what this does not mean"), the findings of the chosen signal in a table that stacks on a phone, with *Load more*, and the per-source coverage. A running report shows its status with a Cancel button and refreshes itself every few seconds until it ends. Everything is reachable by keyboard, each table has a caption, state is never conveyed by colour alone, and a status change is announced politely.

## Extending: the PII report (#37)

`internal/contenthealth` defines a `Signal` (name, how to collect, a typed `Result`) and a registry. The five signals above register in it. The PII report can register a sixth without a schema change: findings have a free-text `signal`, a `code` and a number. **Not done now:** no scanning, classification, pattern, or PII finding exists, no `pii` signal is in the registry or the API enum, and a test fails if one appears before its own decision. A future signal must keep the rule of this report: a finding is an ID and an enum (a class of pattern), **never the text that matched**.

## Compatibility

Migration 00058 only **creates** tables (`content_health_*`) and a queue name; it alters no existing table and adds no constraint to one. The previous release neither reads nor writes them, and its workers do not take the new queue, so a rolling update or a rollback is safe; the feature is off until an admin turns it on after the rollout. Destructive changes would ship a release later (ADR-0013). Down: drops the tables.

## Limitations (also in the runbook)

- "Not processed in a long time" is last processing, not last edit; "not cited" is bounded by what the analytics events kept; broken links are one observation of one crawl, with no referring page; duplicates are byte-identical files only.
- Not measured: near-duplicates, parse warnings, links inside uploaded documents, links on pages of shared sources, link health of pages behind a crawl's depth or page limit (the source's coverage notes a truncated crawl).
- Tested with fake models and fixtures only. Nothing here measures the quality of a real knowledge base or of answers.

## Tests

Unit: the boundary of `staleDays` (one second either side), the effective not-cited window and its minimum, link classification, duplicate scoping, the import rules, and the signal registry. Database integration: each signal against seeded rows (unknown vs zero), duplicates across two teams and with a shared source, deleting a document or source or team, retention (an expired report is gone; a deleted conversation lowers the observed answers), cancellation of a queued and a running report, the bounds (caps, one active, cooldown), the platform switch, and that a chat answer, a crawl and an ingest are unchanged. Authorization: the matrix classifies every operation (owner, admin, editor, member, key, platform staff, break-glass); a dedicated test shows team A's titles and URLs reach nobody else. Web: vitest with axe, keyboard and phone-width cases; a scoped browser run of the page.
