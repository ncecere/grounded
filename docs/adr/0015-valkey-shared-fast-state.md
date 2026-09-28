# ADR-0015: Valkey for shared fast state

- Status: Accepted
- Date: 2026-09-24

## Context

With 3 or more API replicas and 2 or more workers (ADR-0013), some state has to be shared across pods and checked on every request, with low latency:
- rate-limit buckets per IP, session, user, key and agent (DESIGN.md §7.5, §11)
- per-origin crawl pacing across workers (ADR-0008)
- short-lived caches

Keeping this in memory per pod breaks the limits as pods scale. Putting it in Postgres adds write load to the hot path of the database we depend on most (ADR-0003).

## Decision

- **Use Valkey from v1 for shared fast state:**
  - rate-limit token buckets
  - per-origin (per-site) crawl pacing
  - short-lived caches
- **Valkey is never the authority for durable data.** Budgets, the usage ledger, job state (River), crawl state, sessions and everything else durable stay in Postgres. If Valkey data is lost, the only effect is limits resetting and caches refilling.
- **Client:** `redis/go-redis/v9`.
- **Deployment:** HA. Whether that means a primary with replicas and Sentinel, an operator on the cluster, or a managed Redis/Valkey service from the hosting institution is **still to be decided** (DESIGN.md §18 item 3).

## Consequences

- Rate limits and crawl pacing stay correct as replicas scale.
- Postgres doesn't carry high-frequency counter writes.
- Because Valkey holds nothing durable, it needs no backups or DR restores.
- **Costs and risks:**
  - It is another stateful service to run, monitor and upgrade, and a 99.9% target applies to it too.
  - When Valkey is unavailable, authenticated traffic **fails open** and anonymous/public traffic **fails closed**. Sign-in also fails closed, because login state lives in Valkey. Daily and total caps are checked against Postgres (the usage ledger), so an outage never resets or bypasses them.
  - Crawl politeness depends on shared pacing. The design doesn't define crawler behaviour when Valkey is down. Pausing or slowing crawls is safer than crawling without pacing.
  - A failover or restart resets counters, which briefly allows bursts over the limit.
  - The line between a "limit" (Valkey) and a "budget" (Postgres), such as daily token caps for public agents, must be drawn carefully in code so durable caps aren't kept only in Valkey.

## Alternatives considered

- **Limits in Postgres only.** Rejected. It adds hot-path write load and contention on the system of record.
- **In-memory limits per pod.** Rejected. Limits would multiply with replica count and reset on every rollout.
- **Redis instead of Valkey.** Valkey was chosen. `go-redis` works with both, so an institution-managed Redis could be used if offered.
