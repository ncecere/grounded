# Audit streaming to a SIEM

Grounded can send every new audit entry to your SIEM within seconds, in the order the entries were committed. The design and
its reasons are in [specs/audit-streaming/DESIGN.md](../specs/audit-streaming/DESIGN.md); the signed daily export
([signed-daily-audit-export.md](../signed-daily-audit-export.md)) stays the complete, verifiable record.

## What is sent

Per entry: `id` (deduplicate on it: delivery is at least once), `occurredAt`, `actorKind`, `actorUserId`, `actorEmail`,
`apiKeyId`, `teamId`, `teamSlug`, `action`, `targetType`, `targetId` (UUIDs only), `requestId`, `clientIp`, `source:
"grounded"` and the instance name. Never before/after values, metadata, labels, or any document or conversation text.
A stream starts with the entry that turned it on; earlier history is in the signed exports.

## Set it up

1. **Admin → Settings → Features → Audit streaming**: turn it on (a signed-in platform admin; audited).
2. **Admin → Logs → Streaming → Add destination** (at most 5):
   - **HTTPS, Splunk HEC**: URL `https://<splunk>:8088/services/collector/event`, authorization header `Splunk <HEC token>`.
     Events arrive with `sourcetype=grounded:audit`.
   - **HTTPS, NDJSON**: one JSON object per line, for Elastic Agent's *HTTP Endpoint* input, Logstash's `http` input, Vector
     or Fluent Bit. Elastic API keys go in the header as `ApiKey <base64 id:key>`.
   - **Syslog over TLS**: `host:port` (usually 6514), RFC 5424 messages with RFC 5425 octet-counting framing, facility
     `log audit` (13), severity informational; `APP-NAME` is `grounded`, `MSGID` the action, `MSG` the entry as JSON. Add
     the CA certificate if the server's certificate isn't from a public authority.
   The header value is stored encrypted (rotated by `grounded rotate-keys`) and never shown again.
3. **Test** sends one test entry (`action: audit_stream.test`; it isn't stored in the audit log). Then **Turn on**.

Private addresses are allowed (a SIEM is usually internal); loopback, link-local and cloud metadata addresses are refused,
the address is checked at every connection, redirects aren't followed and no proxy is used. Allow egress from the API and
worker pods to the SIEM in your network policies.

## When it fails

A failed delivery is retried with backoff from 5 seconds to 5 minutes, from where it stopped. The destination shows
**Failing**, the error class (connect, tls, timeout, http_4xx, …) and how far behind it is; after 15 minutes it is listed under
**Needs attention** on the admin Overview. It never stops by itself. Turning streaming or a destination off pauses it where
it is. Streaming doesn't hold back audit retention: a destination that falls behind further than the retention period loses
those entries (the signed export still has them, from its coverage start).

## Upgrade note

Migration 00066 adds `audit_log.txid` with an insert trigger and builds an index **concurrently** (the migration runs outside a
transaction), so a large audit log stays writable during the upgrade. If that migration is interrupted, run it again: every
statement is idempotent.
