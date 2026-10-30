# Content health reports: runbook

What it is: [`../content-health.md`](../content-health.md) (design) and [ADR-0027](../adr/0027-content-health-report.md). A team's editors, admins and owners ask for a report of places in their knowledge worth investigating. It is **off by default** and **never runs by itself**.

## Turning it on

1. **Admin → Settings → Features → Content health reports** (platform admins; auditors read it). Audited as `platform.content_health`.
2. Tell the teams' editors where it is: **Team → Content health**.

Off again: no report can be made (`409 content_health_off`), a report waiting to start ends as failed (`disabled`), and teams are told reports are off. Stored reports are kept, hidden, and come back with the switch; they still expire 30 days after they ended.

## What runs, and what it costs

- One River job per report on the **`content_health`** queue (one worker per process; set nothing). It reads the team's own documents, sources, the latest completed crawl's record and the content-free answer events (`message_events`), with read-only queries. It makes **no network request** and **calls no model**: there is no model cost and no fetch to approve.
- Bounds (constants, not settings): one report in progress per team; 10 minutes between the start of two reports; 1,000 findings per signal; 45 s per signal and 10 min per report; at most 1,000,000 answer events read; at most 1,000 sources per report; the latest 5 reports per team, each 30 days after it ended. An hourly `content_health.prune` job removes expired reports and ends any report that never started (60 min) or whose worker died (15 min) as failed (`timed_out`).
- A heavy team costs one database read per signal for the report's scope, bounded by its document limit. If a report takes too long, that signal is `unavailable: timed_out` and the others still arrive. Ask the team to scope the report to one source or knowledge base.
- Metric: `grounded_content_health_reports_total{status}` ([`monitoring.md`](monitoring.md)).

## Who can see what

Editors, admins and owners of the team, signed in to the app. **Nobody else**: members, API keys, OAuth clients, platform admins and auditors (they see only the switch), break-glass sessions (a report is not one of the `documents` scope's reads), other teams. Shared platform sources are not included, and nothing is compared across teams. A finding links to the source's own page, which authorizes again.

## Reading a report (what to tell a team)

| Signal | Read it as | Do not read it as |
|---|---|---|
| Not processed in a long time | Grounded last finished processing these documents long ago | They are outdated. Grounded does not know when a page was edited. |
| Links that failed | The latest completed crawl saw these addresses fail | They are broken now, or which page links to them. Nothing was re-checked. *Unknown* means no usable crawl record (never crawled, a single-page re-fetch ran last, the record is gone). |
| Same file in two sources | Identical bytes (raw SHA-256) in two of the team's sources | Near-duplicates, or the same text in another format |
| Not cited | No answer still kept cited them since observation began | They are useless. Deleted conversations and aged-out analytics are invisible; under 50 answers the signal is unavailable. |
| Failed to parse or ingest | Failed, needs OCR, or not finished after a day | The cause: open the document |

## Deleting data

- A person can delete a report any time (**Delete report**, audited `content_health.delete`). Deleting a document, a source, a knowledge base chosen as a report's scope, or a team removes the findings (or the report) at once; nothing needs purging.
- A user's deleting their conversations removes the analytics events the not-cited signal reads; it does not touch a report already made (which holds no conversation data), and the next report simply sees fewer answers.

## Upgrading and rolling back

Migration 00058 only creates `content_health_*` tables (ADR-0013). The previous release neither reads nor writes them and its workers do not take the `content_health` queue, so a rolling update, or a rollback with the switch on, is safe: reports stay queued until a new worker runs. `down` drops the tables. **Merge order:** the migration directory is applied in order and the runner does not accept a migration numbered below one already applied, so 00058 must be merged after 00056 and 00057.

## Not done, on purpose

No PII detection (#37: the signal registry is its hook), no near-duplicate or parsed-text matching, no link probing, no automatic or scheduled report, no deleting or reclassifying from a report, no API-key access, no cross-team or shared-source comparison.
