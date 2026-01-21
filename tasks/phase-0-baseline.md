# Phase 0: Baseline and Inventory

## Objectives
- Build a shared understanding of current architecture, flows, and hotspots.
- Capture constraints and expectations before moving code.
- Define the validation baseline for later phases.

## Scope
- API, ingestion worker, scraper worker, and web app entrypoints.
- RAG ingestion pipeline flow and data stores.
- Existing tests, smoke checks, and build commands.

## Out of Scope
- Code changes or refactors.
- API behavior changes.
- Database schema or migration updates.

## Dependencies
- None (information gathering only).

## Task List
- [ ] Document runtime entrypoints and startup sequence per app.
- [ ] Document environment variables and settings precedence per app (including dynamic settings fetch).
- [ ] Map the ingestion pipeline flow with owning modules and queues.
- [ ] Map queue names to job payloads and owning processors.
- [ ] Capture contract baselines for API responses, SSE events, and queue payloads.
- [ ] Capture observability keys (log fields, error codes, metrics) by app.
- [ ] Inventory API routes and their owning files.
- [ ] Inventory web pages and navigation flows.
- [ ] Identify the largest files and repeated patterns in each app.
- [ ] Capture cross-cutting helpers (auth, audit, RLS, logging, settings).
- [ ] Map tenant boundary/RLS enforcement touchpoints.
- [ ] Inventory shared packages and their consumers (shared, queue, logger, db).
- [ ] Record current environment/config dependencies for startup.
- [ ] Record external service dependencies (AI providers, vector store, storage).
- [ ] Record baseline throughput and performance metrics for ingestion and scraper queues.
- [ ] Build a critical workflow checklist with expected outputs (auth, chat SSE, ingestion, scrape).
- [ ] List existing tests and smoke checks used today.
- [ ] Build a test/smoke matrix by app and workflow.
- [ ] Define refactor constraints (no API response changes, no schema changes).
- [ ] Note phase dependencies and potential blockers.
- [ ] Create a baseline inventory note in `docs/refactor/baseline.md`.
- [ ] Create `docs/refactor/dependencies.md` with package and service dependencies.
- [ ] Create `docs/refactor/test-matrix.md` with validation expectations.
- [ ] Create `docs/refactor/migration-log.md` to track file moves and decisions.

## Deliverables
- Baseline inventory note in `docs/refactor/baseline.md` (includes config, contracts, observability).
- List of hotspots and repeated patterns by app.
- Agreed refactor constraints and validation baseline.
- Dependency map in `docs/refactor/dependencies.md`.
- Test/smoke matrix in `docs/refactor/test-matrix.md`.
- Baseline performance/throughput snapshot for ingestion and scraper queues.
- Migration log template in `docs/refactor/migration-log.md`.

## Validation and Exit Criteria
- [ ] Baseline note reviewed and agreed.
- [ ] Phase dependencies confirmed.
- [ ] Constraints accepted by stakeholders.
- [ ] Contract and observability baselines reviewed.
