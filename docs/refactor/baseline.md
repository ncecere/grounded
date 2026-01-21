# Baseline Inventory Note

## Purpose
- Capture a single index of the Phase 0 baseline inventory.
- Provide quick links to supporting dependency and test matrix docs.
- Keep refactor scope aligned with documented contracts and constraints.

## Primary baseline source
- The detailed baseline inventory lives in `tasks/phase-0-baseline.md`.

## Inventory coverage

### Runtime Entrypoints and Startup Sequence
- Documents API, web app, ingestion worker, and scraper worker entrypoints and startup steps.

### Environment Variables and Settings Precedence
- Records required/optional env vars and settings precedence for each app/worker.

### Startup Environment/Config Dependencies
- Captures required runtime files, migration lookup rules, and optional startup dependencies.

### External Service Dependencies
- Lists Postgres, Redis, vector store, AI provider, email, and scraper integrations.

### Ingestion Pipeline Flow
- Maps discover -> embed stages, queues, and owning modules.

### Queue Names, Payloads, and Processors
- Summarizes queue job names, payload invariants, and processor ownership.

### Contract Baselines (API, SSE, Queue Payloads)
- Records API response shapes, SSE event names/ordering, and queue payload invariants.

### API Route Inventory
- Lists routes by method/path and owning files, including admin and internal routes.

### Web App Page Inventory and Navigation Flows
- Inventories workspace/admin pages, detail flows, and navigation rules.

### Largest Files and Repeated Patterns
- Notes the largest modules per app and repeated patterns for refactor focus.

### Cross-Cutting Helpers
- Documents auth, audit, RLS, logging, and settings helper locations.

### Shared Packages and Consumers
- Tracks shared packages with responsibilities and consuming apps/workers.

### Tenant Boundary and RLS Enforcement Touchpoints
- Records RLS policy sources, middleware touchpoints, and system-level access paths.

### Observability Baseline (Logs, Error Codes, Metrics)
- Captures logging schema, error taxonomy, and metric dimensions.

### Baseline Throughput and Performance Snapshot (Queues)
- Summarizes configured queue concurrency, rate limits, and fairness defaults.

### Critical Workflow Checklist
- Lists expected outputs for auth, chat SSE, ingestion, and scrape workflows.

### Existing Tests and Smoke Checks
- Enumerates automated checks and manual smoke workflows.

### Refactor Constraints
- Summarizes no-contract-change, no-schema-change, and observability parity rules.

### Phase Dependencies and Potential Blockers
- Records phase dependencies and blockers that could delay follow-on phases.

## Supporting docs
- Dependency map: `docs/refactor/dependencies.md`.
- Test/smoke matrix: `docs/refactor/test-matrix.md`.
