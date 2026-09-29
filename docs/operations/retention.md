# Retention and legal holds

Grounded deletes data only when a retention period says so, and never what a legal hold covers (DESIGN.md §8, ADR-0010). This page covers the defaults, how to set periods, how the job runs, and the legal hold procedure.

> **Records management first.** Transcripts, logs and audit entries can be records, for example under public records law. Confirm every period with your records management and legal counsel before you set it, and write the agreed periods in your [deployment profile](../deployments/README.md). Until you set a period, Grounded keeps the data.

## What is kept, and for how long

| Data | Default | Where to set it | Notes |
|---|---|---|---|
| Signed-in conversations (with messages) | **Keep** until the user deletes them | Per classification level: **Administration → Classifications**, "Conversation retention" | Counted from the last message. |
| Anonymous conversations (public page, widget) | **24 hours** | Per classification level: "Anonymous retention" | The one period on by default (DESIGN.md §7.5). |
| Conversations users deleted | **Keep** (hidden from the user at once) | Retention: *Conversations users deleted* (grace period, 0 = next run) | See "User deletes" below. |
| Access log | **Keep** | Retention: *Access log* | |
| Analytics events (per-answer metadata) | **Keep** | Retention: *Analytics events* | Dashboards show only what's kept. |
| Usage ledger | **Keep** | Retention: *Usage ledger* (at least 7 days) | Rolled up per day before deletion; see below. |
| Audit log | **Keep** | Retention: *Audit log* (at least 30 days) | Legal hold entries are never deleted. |
| Files of deleted documents and sources | **Keep** | Retention: *Files of deleted documents* (0 = next run) | See below. |
| Expired or revoked invites | **Keep** | Retention: *Expired invites* | Accepted invites are kept. |
| Anonymous sessions | Removed at expiry (`ANON_SESSION_TTL`) | Not configurable | They hold no content; their conversations follow their own period. |
| Evaluation runs and their results | **180 days** (`RETENTION_EVALUATION_RUNS_DAYS`) | Retention: *Evaluation runs* | The one kind deleted by default (owner decision): runs hold only test questions and the agent's test answers, so legal holds don't apply ([`evaluations.md`](evaluations.md)). |
| Browser sessions | Removed at expiry (`SESSION_TTL`) | Not configurable | An hourly job, as before. |

Everything except the last two and anonymous conversations is kept until a period is set.

### Setting periods

Each period in the Retention table has an **environment default** and an optional **platform setting**:

- **Environment defaults** come from `RETENTION_*_DAYS` (see `.env.example`). Empty or `keep` keeps the data. They suit installs managed as code, where the agreed periods live in the deployment's configuration.
- **Administration → Retention → Periods** overrides each kind with *Default* (use the environment value), *Keep*, or *Delete after N days*. Changes are audited as `retention.settings_update` with before and after values. Saving a period that deletes more (a shorter period, or a period where there was none) asks for confirmation first.
- **Conversation periods** are set per classification level, on Classifications, and shown read-only on the Retention page.

`RETENTION_BATCH_SIZE` (default 500 rows per transaction) and `RETENTION_MAX_BATCHES` (default 100 per kind per run) bound each run.

### Check before you change: the dry run

**Retention → Dry run** shows what a run would delete now, per kind, with a breakdown per team, classification level, audience (signed-in or anonymous, channel) and reason (past its period, deleted and past its grace, expired), and how much legal holds keep. It runs in a read-only transaction: viewing it deletes and writes nothing. Platform admins and auditors can see it.

The dry run and the job use the same query per kind, so a run deletes exactly what the dry run shows (plus anything that became due in between).

## How the job runs

- A River job on the workers, every 10 minutes (`retention.run`), and on demand with **Retention → Runs → Run now** (platform admins; audited as `retention.run_request`).
- Only one run at a time, across all workers (a Postgres advisory lock). A requested run waits for a run in progress.
- Each kind is deleted in bounded batches, one transaction per batch. A backlog larger than one run's bound continues at the next run. Runs are idempotent: running again deletes nothing more until something else becomes due.
- A failing kind (for example, object storage unreachable) is recorded and retried at the next run; the other kinds still run.
- **Records:** each run is listed with its counts per kind (Retention → Runs; kept 90 days, and 7 days for scheduled runs that deleted nothing). A run that deleted something, and every requested run, writes a system audit entry `retention.purge` with the counts. No content, IDs or names are recorded.
- **Metrics** (worker `/metrics`): `grounded_retention_deleted_total{kind}`, `grounded_retention_held{kind}` (rows past their period kept by holds, at the last run), `grounded_retention_errors_total{kind}`, `grounded_retention_last_success_timestamp_seconds{kind}` and `grounded_retention_run_duration_seconds`. Alert when the last success of a configured kind is more than an hour old.

### What each kind deletes

- **Conversations** are deleted with their messages. Analytics events keep their metadata and lose only the link to the message.
- **User deletes.** A user who deletes a conversation no longer sees it, at once. The stored copy is removed after the *Conversations users deleted* grace period, or earlier if its level's retention passes. The delete dialog tells users that records rules may keep it longer. It never says whether a hold exists.
- **Usage ledger.** Before events are deleted, they're added to daily totals (`usage_daily`: UTC day, kind, team, agent, model and channel; no user or key). Analytics token totals read both, so they stay the same; for ranges older than the ledger's period they're accurate to the UTC day. Daily limits read only today's events, so the minimum period is 7 days.
- **Audit log.** Deletion goes through the audit log's append-only trigger, which allows it only inside the retention transaction (the `ragd.audit_purge` setting from migration 00001, kept under the project's old name). Entries about legal holds (`legal_hold.*`) are never deleted.
- **Deleted documents and sources.** When an editor deletes a document or a source, or a crawl finds a page gone, its database rows (passages and vectors included) are deleted at once, so search stops using it immediately. Its stored files (original and parsed text) are recorded in `deleted_files` and removed from object storage by the *Files of deleted documents* period. Earlier versions of a document replaced by a new upload or a re-crawl are removed when replaced, as before.

## Legal holds

A legal hold stops every retention deletion of what it covers until it's released. Holds never expire.

| A hold on | Keeps |
|---|---|
| **A user** | Their conversations (including deleted ones), their access log and usage entries, audit entries they made or that are about them, analytics events of their conversations |
| **A team** | Conversations with the team's agents, its access log, analytics, usage and audit entries, its deleted documents' files, its expired invites |
| **An agent** | Its conversations, access log, analytics, usage and audit entries |
| **A conversation** | That conversation and its analytics events |

A hold can be limited to a **date range** of the data (first and last day, UTC): a conversation is covered if its activity overlaps the range; a log entry or event if it falls within it; deleted files if the content existed during it.

- **Who:** platform admins place and release holds; platform auditors see them. Team members and team admins never do: hold audit entries have no team, so they don't appear in team audit logs, and nobody is notified.
- **When it applies:** from the next retention batch (seconds). A hold doesn't restore anything already deleted.
- **Held conversations a user deletes** disappear for the user as usual. Admins see them in the hold's details ("N deleted by their users, kept by this hold") and in the dry run as held.
- **What a hold doesn't do:** it doesn't stop users or editors from deleting things (users' conversations are kept anyway; see above), and it doesn't keep document passages and vectors, only the documents' stored files. It doesn't give anyone access to the content: transcripts stay readable only by their user (ADR-0010).

### Procedure

1. Get the request in writing from your legal counsel or records officer: what to preserve (people, teams, agents, conversations) and the dates.
2. In **Admin → Retention → Legal holds**, choose **Place a hold** for each scope: a user's email or ID, a team (picked from the list), an agent as `team-slug/agent-slug` or its ID, or a conversation ID. Give the reason (the matter or request reference) and, if the request names dates, the date range. The hold is audited as `legal_hold.create` with who placed it and when.
3. Check **Retention → Dry run**: what the hold keeps shows under "Kept by legal holds".
4. If the request needs data to be produced, export it through the normal channels (users export their own conversations). Holds preserve; they don't grant access.
5. When counsel confirms the matter is closed, **Release hold** with the reason. It's audited as `legal_hold.release`. What the hold kept is deleted at the next run if its period has passed, so check the dry run first if that matters.

Holds and their audit entries stay listed (Legal holds, **Status: Released**) for good. The old address `/admin/legal-holds` (a page of its own until v0.2.1) opens this tab.

## API

Platform admins and auditors (writes need a platform admin with a browser session):

- `GET /v1/admin/retention`, `PUT /v1/admin/retention` (If-Match): periods per kind, and the per-level conversation periods.
- `GET /v1/admin/retention/report`: the dry run.
- `GET /v1/admin/retention/runs`, `POST /v1/admin/retention/runs` (`{"kinds": [...]}`, empty for all): runs and Run now.
- `GET /v1/admin/legal-holds?status=active|released|all`, `POST /v1/admin/legal-holds`, `GET /v1/admin/legal-holds/{id}`, `POST /v1/admin/legal-holds/{id}/release`.

See `api/openapi.yaml` for the schemas.
