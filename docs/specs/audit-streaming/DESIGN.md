# Audit streaming to a SIEM (E5, second part; #36)

Status: accepted for v0.9.0. The owner's decision is option A in [v0.9.0.md](../../v0.9.0.md#audit-export-and-siem-streaming):
optional near-real-time streaming to syslog (RFC 5424 over TLS) or an HTTPS endpoint (which Splunk's HTTP Event Collector
and Elastic accept), approved by a platform admin, carrying the audit log's facts and never content, with no
vendor-specific integration. The choices the decision left open are below with their reasons; they were recommended on
2026-11-05 and accepted with "follow your recommendations". The signed daily export ([signed-daily-audit-export.md](../../signed-daily-audit-export.md))
stays the complete, verifiable record; streaming is the live feed.

## What it does

A platform admin adds up to five **streaming destinations** in **Admin → Logs → Streaming**. Each sends every new audit
entry, in commit order, within seconds:

| Kind | Transport | Format |
|---|---|---|
| **HTTPS** | `POST` to an `https://` URL, batches of at most 500 entries or 1 MiB | **Splunk HEC** (`{"time", "host", "source", "sourcetype", "event"}` objects concatenated, for `/services/collector/event`) or **NDJSON** (one JSON object per line: Elastic Agent's HTTP endpoint input, Logstash's `http` input, Vector, Fluent Bit, a custom collector) |
| **Syslog** | TCP + TLS (RFC 5425), octet-counting framing | RFC 5424, one message per entry, the entry as JSON in MSG |

An optional **authorization header value** (Splunk's `Splunk <token>`, Elastic's `ApiKey <key>`, any `Bearer …`) is
stored encrypted (`internal/secrets`, rotated by `grounded rotate-keys`), sent as `Authorization`, and never shown again
(the page says whether one is set). Syslog may name a **CA certificate** (PEM) for a private SIEM; there are no client
certificates in this version.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Missing nothing, in order | Each audit entry records the transaction that wrote it (`audit_log.txid`, a `xid8` set by an insert trigger). A destination's cursor is `(txid, id)`; it sends entries whose transaction is older than every transaction still running (`txid < pg_snapshot_xmin(pg_current_snapshot())`), ordered by `(txid, id)`. | An audit ID does not commit in ID order (the signed export documents this), so "after the last ID sent" would skip an entry whose transaction committed late. Transaction IDs below the snapshot's xmin are all finished, so nothing can appear behind the cursor. |
| Where a stream starts | When a destination is turned on for the first time: new entries only, opening with the entry that records the switch-on (`platform.audit_stream_enable`). | History is the signed daily export's job; a backfill would flood a SIEM and has no end-to-end check. |
| Delivery | At least once. The cursor moves after a 2xx (HTTPS) or after the batch is written and flushed (syslog, which has no acknowledgement). A retry may repeat entries; each carries its `id` for deduplication. | Exactly-once delivery isn't possible over these protocols; at-least-once with an ID is what SIEMs expect. |
| What is sent | The audit facts: `id`, `occurredAt`, `actorKind`, `actorUserId`, `actorEmail` (current), `apiKeyId`, `teamId`, `teamSlug`, `action`, `targetType`, `targetId` (UUIDs only, as the export), `requestId`, `clientIp`, plus `source: "grounded"` and the instance name. **Not** before/after states, metadata, labels or any document or conversation text. | A SIEM needs who, from where, did what to which object and when; before/after and metadata are arbitrary JSON that may carry configuration text (agent instructions, URLs). The export made the same cut; a reviewed allowlist can add fields later. Email is included because a SIEM correlates people by it; it is read at send time. |
| Who may configure it | Signed-in platform admins (never an API key or OAuth), and only while **Audit streaming** is on in Admin → Settings → Features (off by default). Auditors read the destinations (never the header value). Every change is audited. | Same model as webhooks: a platform switch, then an admin's explicit destinations. |
| Which addresses | Any public or private address; never loopback, link-local or cloud metadata addresses. The address is resolved and checked at each connection (no DNS rebinding), no redirects, no environment proxy. | A SIEM is often on the internal network, and only platform admins set this; loopback and metadata addresses are never a SIEM. |
| Failures | Exponential backoff from 5 s to 5 min; the destination shows **Failing** with the last error class (`connect`, `tls`, `timeout`, `http_4xx`, `http_5xx`) and its lag, never the response body. Failing for more than 15 minutes puts it under Needs attention on the admin Overview. A destination never stops by itself. | A short outage resumes where it stopped; a long one is visible. |
| Retention | Streaming does not hold back retention. If a destination falls behind past the retention period, those entries are gone and the page says how far behind it is. | Holding audit retention hostage to a SIEM outage would be a surprise; the signed export protects what it covers. |
| No feedback loop | Deliveries are not audited per batch; only configuration changes and tests are. | Otherwise every batch would create an entry to stream. |
| Bounds | At most 5 destinations, 500 entries or 1 MiB per batch, 10 s per HTTPS request and per syslog connection attempt, a 5 s poll. | One slow SIEM can't hold a worker. |

## Storage

Migration 00066 (expand only):

- `audit_log.txid xid8` (nullable, no default: a metadata-only change), set by a `BEFORE INSERT` trigger to
  `pg_current_xact_id()`; a partial index on `(txid, id) WHERE txid IS NOT NULL`, built `CONCURRENTLY` (a goose
  `NO TRANSACTION` migration) so a large log is not locked. Entries written before the upgrade have no `txid` and are
  never streamed (a stream starts at its first switch-on anyway).
- `audit_stream_settings` (singleton: `enabled`, revision).
- `audit_stream_destinations`: id, name, kind (`https`, `syslog`), url or host and port, format (`splunk_hec`, `ndjson`,
  `rfc5424`), encrypted header value (`bytea`, registered for key rotation), CA PEM, `enabled`, cursor (`cursor_txid`,
  `cursor_id`), `last_sent_at`, `last_error_class`, `failing_since`, `next_attempt_at`, `sent_total`, revision.

The previous release ignores the column (the trigger fills it for every insert, theirs included) and the tables; a
rollback stops streaming.

## API

`GET`/`PUT /v1/admin/audit-stream/settings` (If-Match), `GET`/`POST /v1/admin/audit-stream/destinations`,
`GET`/`PATCH`/`DELETE /v1/admin/audit-stream/destinations/{id}` (If-Match), `POST …/{id}/test` (sends one test entry, not
stored in the audit log, and reports the outcome class). Signed-in platform admins write; auditors read. All in the
authorization matrix.

## UI

Admin → Logs gets pill tabs: **Audit · Access · Signed exports · Streaming** (signed exports move out from under the audit
list). Streaming: the switch's state with a link to Settings → Features, then the destinations (name, kind, state, lag,
last delivery, last error class) with Add, Test, Edit, turn on/off and Delete.

## Not in this version

Client certificates for syslog, UDP or plain-TCP syslog (unencrypted), per-destination filters, a backfill, and
vendor-specific APIs. External S3 destinations for the signed daily export are a separate change (#36 stays open for it).

## Tests

Ordering under concurrent transactions (a late-committing entry with a lower ID is still sent, after the cursor's
earlier ones, and nothing is sent twice in the normal path); a cursor never passes an uncommitted transaction; the
projection (no before/after, metadata or non-UUID targets); HTTPS formats against a test server (Splunk HEC and NDJSON,
the header sent, 4xx/5xx/timeouts classified and retried with backoff); syslog over TLS with octet framing and a custom
CA; address checks; the feature switch and limits; audit entries; the header value encrypted and registered for key
rotation; the authorization matrix; web with axe.
