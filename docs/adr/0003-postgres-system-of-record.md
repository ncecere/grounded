# ADR-0003: PostgreSQL as the system of record

- Status: Accepted
- Date: 2026-09-24

## Context

The platform holds relational, strongly consistent data: users, teams, policy, classification, sources, documents, KBs, agents, conversations, usage, audit and sessions. Ingestion is a multi-stage pipeline that needs durable, retryable jobs with fair scheduling (DESIGN.md §5.5). We want as few stateful systems as possible to operate and back up, given a 99.9% target (ADR-0013) and RPO/RTO commitments (ADR-0014).

## Decision

- **PostgreSQL 17 is the system of record.** It holds users, teams, policy, sources, crawl state (frontier and page status), documents, chunk text with metadata and a `tsvector` for lexical search, KBs, agents, conversations, usage, audit, sessions, notifications and the job queue.
- **River is the job queue, in the same database.** Every ingestion step (`source.sync`, `document.fetch`, `parse`, `chunk`, `embed`, `index`) and every crawl step is an idempotent River job. Retention and usage rollups run as jobs too. Jobs can be enqueued in the same transaction as the domain write that causes them.
- **Data access uses `pgx` and `sqlc`.** SQL is written by hand and compiled to typed Go. There is no ORM.
- **Migrations use `goose`.** They are embedded in the binary, run by `grounded migrate` under an advisory lock, and follow expand/contract (ADR-0013).
- **Vectors also live in Postgres in v1** via pgvector (ADR-0004). The `VectorStore` interface keeps them movable.
- **Valkey holds only disposable fast state** (ADR-0015). Budgets, usage and job state stay in Postgres.
- **HA:** CloudNativePG with 1 primary and 2 replicas and tested automatic failover, unless the hosting institution provides a managed service. That choice is still open (DESIGN.md §18 item 4).

## Consequences

- One transactional store makes the classification checks, revision preconditions (412/428) and audit records consistent with the changes they describe.
- Enqueueing a job in the same transaction as its write removes a class of lost-job and phantom-job bugs.
- One system covers the job queue and, in v1, the vectors, so there are fewer things to back up. Continuous WAL archiving gives a 15-minute RPO for all of it.
- **Costs and risks:**
  - Postgres carries OLTP, queue churn, full-text search and (in v1) HNSW vector search. At 10–50M chunks the load, vacuum and I/O are real risks. The Phase 1 benchmark (ADR-0004) is the check.
  - Queue tables churn heavily and need autovacuum tuning and monitoring.
  - Postgres is a single critical dependency. Its failover must be tested, not assumed.
  - `sqlc` means more hand-written SQL. Expand/contract means more migration steps per change.

## Alternatives considered

- **A separate message broker for jobs.** Rejected. It is another stateful system to run, and it loses transactional enqueue.
- **Valkey as a queue.** Rejected. Valkey is never the authority for durable data (ADR-0015).
- **An ORM.** Rejected in favour of explicit SQL checked at compile time with `sqlc`.
- **Other migration tools**, such as yoink's stop-the-world approach. Rejected. See ADR-0013.
