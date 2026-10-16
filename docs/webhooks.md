# Webhooks

Webhooks tell another system when something happens in Grounded: Grounded sends an HTTPS `POST` with a small JSON event, **signed** so the receiver can tell it came from Grounded, and **retried** when the receiver is down.

Design: [`specs/v0.6.0/DESIGN.md`](specs/v0.6.0/DESIGN.md) §5 (roadmap F3). Code: `internal/webhooks`.

## Who sets them up

- **Platform admins** turn webhooks on (**Admin → Settings → Features → Webhooks**; off by default) and **approve destinations** (**Admin → Webhooks**): host patterns such as `hooks.example.edu` or `*.example.edu` (the host and every subdomain). A webhook can only be sent to an approved host. Withdrawing a destination stops what is sent there at once.
- **Team admins and owners** create webhooks for their team (**Team settings → Webhooks**). Editors and members don't see them.
- **Platform admins** also create **platform webhooks** (**Admin → Webhooks**) for platform events.

Everything is audited (the team's audit log for team webhooks, the platform's for the rest). Turning webhooks off stops recording and sending; what exists is kept.

## Where they are sent

- `https` only, on port **443**, to a **host name** an approved destination covers (not an IP address).
- The address is checked **when you save it and again before every delivery**. Grounded never sends to private, loopback, link-local or cloud metadata addresses, whatever the name resolves to; it connects to the address it checked, follows **no redirects** (a `3xx` is a failure) and reads at most 4 KB of your answer.

## Events

A webhook subscribes to at least one. A team webhook receives its team's events only; a platform webhook the platform's. `GET /v1/webhook-events` lists them.

| Event | Scope | When | `data` |
|---|---|---|---|
| `source.synced` | team | A web source finished syncing | `sourceId`, `sourceName`, `crawlId`, `pagesFetched`, `pagesChanged`, `pagesUnchanged`, `pagesFailed`, `documentsDeleted`, `truncated` |
| `source.sync_failed` | team | A web source's sync failed | `sourceId`, `sourceName`, `crawlId`, `error` (a short reason) |
| `agent.published` | team | An agent was published | `agentId`, `agentName`, `agentSlug`, `version`, `audience` |
| `feedback.submitted` | team | Someone rated an answer (taking a rating back is not an event) | `agentId`, `messageId`, `rating` (`up` or `down`), `reason` (when given) |
| `team.created` | platform | A team was created | `teamId`, `slug`, `name`, `maxClassification` |
| `team_request.created` | platform | Someone asked for a team | `requestId`, `name`, `classification` |
| `webhook.test` | either | You asked for a test event | `message` |

Events carry **IDs and summaries, never transcripts or document text**: a rating has no question, answer, comment or person; a team request has no purpose. A receiver that needs more fetches it through the API with a key, so classification and permissions still apply.

Every delivery's body is:

```json
{
  "id": "0b3e0c1e-6b0d-4f0a-9d63-5a3c8f6f2f11",
  "type": "agent.published",
  "createdAt": "2026-10-16T10:15:00Z",
  "team": { "id": "…", "slug": "registrar", "name": "Registrar" },
  "data": { "agentId": "…", "agentName": "Parking help", "agentSlug": "parking-help", "version": 3, "audience": "team" }
}
```

`team` is absent on platform events. **`id` is the event's ID: the same for every delivery of it, and for a redelivery**, so receivers de-duplicate on it. Delivery is **at least once and not ordered**: use `id` and `createdAt`.

## Headers

| Header | |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `Grounded-Webhooks/1` |
| `Grounded-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |
| `Grounded-Event` | the event type |
| `Grounded-Delivery` | this delivery's ID (a retry has the same one) |
| `Grounded-Webhook` | the webhook's ID |

## Checking the signature

Each webhook has a secret, `whsec_…`, **shown once**, when the webhook is made and when you rotate it. Grounded keeps it encrypted (it must sign with it); it is never in the list, the audit log or an event.

`v1` is the hex HMAC-SHA256, keyed with the secret, of the string `<t>.<raw request body>`. Check it over the **raw body bytes** (not a re-serialised copy) with a constant-time comparison, and refuse a `t` more than **five minutes** from your clock (replay protection).

```python
import hmac, hashlib, time

def verify(secret: str, header: str, body: bytes, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t, sig = parts.get("t", ""), parts.get("v1", "")
    if not t.isdigit() or abs(time.time() - int(t)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), t.encode() + b"." + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)
```

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, header, body /* Buffer */, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const t = parts.t ?? "";
  if (!/^\d+$/.test(t) || Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");
  const got = Buffer.from(parts.v1 ?? "", "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
```

Go receivers can use `webhooks.Verify` from `internal/webhooks`, which the tests use.

**Rotating** a secret takes effect at once (there is no overlap window): a receiver that needs one accepts both secrets while you change it.

## Retries, pausing and the delivery log

- Any `2xx` is **delivered**. Anything else, or no answer within 10 seconds, is a failure and is retried: **8 attempts** in all, after 15 s, 1 min, 5 min, 30 min, 2 h, 6 h and 12 h (about a day).
- `410 Gone` ends the delivery at once and **pauses** the webhook (`gone`).
- After **5 deliveries in a row** gave up, the webhook is **paused** (`failing`) and its team's admins and owners (platform admins for a platform webhook) are notified. One success resets the count. Turning a webhook back on is a deliberate edit.
- Each webhook keeps its deliveries for **14 days**: event type, status, attempts, the receiver's last HTTP status and a short error (never your answer). **Send test event** sends a `webhook.test` whatever the webhook subscribes to; **Redeliver** sends a delivery's event again (same ID and body, a new delivery).

## API

OpenAPI tag `webhooks`: `GET`/`POST /v1/teams/{team}/webhooks`, `GET`/`PATCH`/`DELETE …/{webhookId}` (`If-Match`), `POST …/{webhookId}/rotate-secret`, `…/test`, `GET …/deliveries`, `POST …/deliveries/{deliveryId}/redeliver`; the same under `/v1/admin/webhooks`; `GET /v1/webhook-events`, `GET /v1/webhook-destinations`, `POST`/`DELETE /v1/admin/webhook-destinations`, `GET`/`PUT /v1/admin/settings/webhooks`. People signing in only: API keys cannot manage webhooks.
