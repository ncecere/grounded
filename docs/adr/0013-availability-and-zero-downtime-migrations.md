# ADR-0013: Availability and zero-downtime migrations

- Status: Accepted
- Date: 2026-09-24

## Context

The platform serves 5,000 daily users and embedded public widgets, and is run by one team with 24/7 on-call. A 99.9% target allows about 43 minutes of downtime a month, which leaves no room for routine maintenance windows. yoink, whose patterns we otherwise follow, stops every process to run migrations. That is fine for yoink but not for this target.

## Decision

- **Target: 99.9% availability.** SLOs and error budgets cover availability and p95 latency of chat and retrieve, ingestion freshness, and error rate by dependency.
- **HA topology:**
  - `api`: at least 3 replicas, spread across nodes with anti-affinity, with PodDisruptionBudgets.
  - `worker`: at least 2 replicas. It can be split by queue later.
  - Postgres: CloudNativePG with 1 primary and 2 replicas and tested automatic failover, unless the hosting institution offers a managed service (ADR-0003).
  - Valkey: HA (ADR-0015). The deployment method is still open.
  - Tika is optional and not on the critical path: built-in parsers run in the worker.
- **Expand/contract migrations.** Each release's schema works with both the previous and the new code. Destructive steps (drops, renames, tighter constraints) ship at least one release later. This deliberately departs from yoink's stop-the-world migrations.
- Migrations are embedded in the binary and run by `migrate` under a Postgres advisory lock, so only one runner applies them.
- **Graceful shutdown.** On termination, a pod stops accepting new work, lets in-flight SSE chats finish, then exits. River jobs are idempotent and safe to interrupt and resume.
- **Maintenance mode** pauses new ingestion while queries keep working. It is used for embedding-profile migrations (ADR-0007) and risky changes.
- **Degraded operation.** If the gateway is down, chat and retrieval return `model_unavailable`, while admin and document management keep working (ADR-0005).
- **Dependency caveat.** Our SLO is bounded by dependencies we don't run: the model gateway, the institution's OIDC provider and the SMTP relay. Any institution-managed Postgres or Valkey is also outside our control.

## Consequences

- Releases can ship during working hours without an outage.
- Losing a node or pod doesn't take the service down.
- **Costs and risks:**
  - Expand/contract makes every breaking schema change take two or more releases, with backfills and compatibility code in between. This is slower and needs discipline in review.
  - Old and new code run at the same time during rollouts, so API and job payload changes must also be backward compatible.
  - Long SSE chats slow down rollouts. Termination grace periods must be sized for them.
  - The HA footprint (3 API pods, 3 Postgres instances, HA Valkey) costs more cluster resources than a minimal install.
  - We can't promise 99.9% if a dependency can't reach it. That has to be stated in the SLO.

## Alternatives considered

- **Stop-the-world migrations as in yoink.** Rejected. They cause planned downtime on every schema change.
- **Scheduled maintenance windows.** Rejected as routine practice. Maintenance mode pauses only ingestion.
- **Single-replica deployments.** Rejected. Node drains and failures would become outages.
