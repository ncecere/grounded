# Content health reports: runbook

What it is: [`../content-health.md`](../content-health.md) (design) and [ADR-0027](../adr/0027-content-health-report.md). A team's editors, admins and owners ask for a report of places in their knowledge worth investigating. It is **off by default** and **never runs by itself**.

## Turning it on

1. **Admin → Settings → Features → Content health reports** (platform admins; auditors read it). Audited as `platform.content_health`.
2. Tell the teams' editors where it is: **Team → Content health**.

Off again: no report can be made (`409 content_health_off`); a report waiting to start ends as failed (`disabled`); a report being made stops at its next signal boundary, and is checked once more before it is stored, so the next collection step does not start and successful storage is ordered against the switch; the current step may finish its remaining queries before that boundary (it is not instantaneous SQL cancellation); teams are told reports are off. Stored reports are kept and come back with the switch; they still expire 30 days after they ended. While off, a team's editors, admins and owners can still **cancel** a report being made and **delete** kept ones: the page lists the kept reports as stubs (no findings, no counts) for that, and nobody else can do either (members, keys, platform staff, outsiders get 404). Reading a report stays closed. To remove every kept copy at once, an operator can switch the feature off and have teams delete their reports, or let them expire (30 days); there is no platform-side way to read or remove one, by design.

## What runs, and what it costs

- One River job per report on the **`content_health`** queue (one worker per process; set nothing). It reads the team's own documents, sources, the latest completed crawl's record, agents' publish times and knowledge-base attachments, and the content-free answer events (`message_events`), with read-only queries, and then writes its own tables. No code on its path makes a network request or calls a model, so there is no model cost and no fetch to approve. (The package's own imports are checked by a test; the transitive import graph is not claimed to be free of `net/http`, and a test shows zero requests and zero model calls for a whole report, as evidence.)
- Bounds (constants, not settings): one report in progress per team; 10 minutes between the start of two reports; 1,000 findings per signal; 45 s per signal (a context deadline of a read-only, repeatable-read transaction: the driver cancels the running statement on the server; it is **not** a server `statement_timeout`) and 10 min of report work plus at most 10 s failure-state cleanup; at most 1,000,000 retained non-test events admitted (team-wide, including refusals/errors; preflight counts one extra to detect overflow, before eligibility filtering); at most 5,000 agents per team for that signal; at most 1,000 sources per report; the latest 5 reports per team, each 30 days after it ended. An hourly `content_health.prune` job removes expired reports and ends any report that never started (60 min) or whose worker died (15 min) as failed (`timed_out`).
- A signal can execute several database queries. Counts and grouping can visit many documents despite the stored-findings cap; that cap is not a document-scan quota. The source/event admission limits and context deadlines bound the work, not a promise of one query per signal or fixed physical database I/O. If a report takes too long, that signal is `unavailable: timed_out` and the others still arrive. Scoping the report to one source or knowledge base narrows the documents each signal reads, but **not the answer events the citation-evidence signal reads, which are the team's**: for `too_many_answers` ask for a **shorter citation window** (a narrower scope does not help).
- Successful storage honors the report deadline. A failure tries to persist its terminal state within 10 s, even after work cancellation; if a database lock or outage prevents that update, a warning is logged and the existing hourly stuck-report cleanup can recover it later. The event cap bounds matching events, not physical database rows visited; query work still has its context deadline.
- Metric: `grounded_content_health_reports_total{status}` ([`monitoring.md`](monitoring.md)).

## Who can see what

Editors, admins and owners of the team, signed in to the app. **Nobody else**: members, API keys, OAuth clients, platform admins and auditors (they see only the switch), break-glass sessions (a report is not one of the `documents` scope's reads), other teams. Shared platform sources are not included, and nothing is compared across teams. A finding links to the source's own page, which authorizes again.

## Reading a report (what to tell a team)

| Signal | Read it as | Do not read it as |
|---|---|---|
| Not processed in a long time | Grounded last finished processing these documents long ago | They are outdated. Grounded does not know when a page was edited. A web page marked *recently confirmed by a crawl* was seen again by a crawl within the threshold. |
| Links that failed | The latest completed crawl saw these addresses fail | They are broken now, or which page links to them. Nothing was re-checked. *Unknown* means no usable crawl record (never crawled, a single-page re-fetch ran last, the record is gone, or reading it timed out). Addresses are stored without credentials, query or fragment, but a path can still be sensitive. They are hidden once the source was changed or a newer completed crawl exists. |
| Same file in two sources | Identical bytes (raw SHA-256) in two of the team's sources, still true when it is opened | Near-duplicates, or the same text in another format. Numbers are in groups. |
| No retained citation evidence | The kept answer records show no citation of them in a team-wide window, among documents of sources a published agent reaches | That they are never cited, unused, outdated or poor, or that they had a fair chance to be cited. The window starts at the team's first kept answer, not when a document became reachable; answers that were not kept (or aged out of the analytics period) are invisible. Under 50 answers that could have cited something (team-wide, and per source since it became reachable) the signal does not judge. |
| Failed to parse or ingest | Failed, needs OCR, or not finished after a day | The cause: open the document |

## Deleting data

- A person can delete a report any time, also while the feature is off (**Delete report**, audited `content_health.delete`). Deleting a document, a source, a knowledge base chosen as a report's scope, or a team removes the findings (or the report) at once; nothing needs purging. A source taken out of a report's knowledge base, or changed or crawled again, is hidden from the report on the next read.
- **A user's deleting conversations does not delete analytics events.** `message_events.message_id` is `ON DELETE SET NULL`: the conversation and its messages go, the event (time, flags, cited document IDs) stays, until the **analytics-events period** (Administration → Retention; one platform-wide setting, not the classification level's conversation retention) removes it. So the citation-evidence signal sees the same answers after conversations are deleted, and fewer only after that period expires them. A report already made holds no conversation data.

## Upgrading and rolling back

Migration 00058 only creates `content_health_*` tables (ADR-0013). The previous release neither reads nor writes them and its workers do not take the `content_health` queue, so a rolling update, or a rollback with the switch on, is safe: reports stay queued until a new worker runs. `down` drops the tables. **Merge order:** the migration directory is applied in order and the runner does not accept a migration numbered below one already applied, so 00058 must be merged after 00056 and 00057.

## Not done, on purpose

No PII detection (#37: the signal registry is its hook), no near-duplicate or parsed-text matching, no link probing, no automatic or scheduled report, no deleting or reclassifying from a report, no API-key access, no cross-team or shared-source comparison.
