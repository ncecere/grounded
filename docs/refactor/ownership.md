# Module Ownership Guidelines

## Purpose
- Clarify who is responsible for each major module during the refactor.
- Define expectations for changes that cross module boundaries.
- Provide escalation paths for review, approval, and support.

## Ownership Principles
- Each module has a primary owner accountable for runtime behavior and contracts.
- Secondary owners provide backup coverage for reviews and on-call escalation.
- Changes that affect shared contracts require sign-off from all impacted owners.
- Ownership includes docs, tests, and migration notes tied to the module.

## Module Ownership Map

| Module | Scope | Primary Owner | Secondary Owner | Notes |
| --- | --- | --- | --- | --- |
| `apps/api` | Routes, domain modules, auth, widget hosting | Unassigned | Unassigned | See `docs/refactor/api-modules.md` for module map. |
| `apps/ingestion-worker` | Ingestion jobs, stage orchestration, embeddings | Unassigned | Unassigned | References `docs/refactor/ingestion-jobs.md`. |
| `apps/scraper-worker` | Page fetch jobs, fetch strategies, browser pool | Unassigned | Unassigned | References `docs/refactor/scraper-fetch.md`. |
| `apps/web` | Admin UI, navigation registry, providers | Unassigned | Unassigned | References `docs/refactor/web-navigation.md`. |
| `packages/shared` | Shared DTOs, errors, settings, contracts | Unassigned | Unassigned | Follow shared export rules in `docs/refactor/shared-packages.md`. |
| `packages/queue` | BullMQ wrappers, fairness scheduling helpers | Unassigned | Unassigned | Coordinate with worker owners. |
| `packages/db` | Drizzle schema, RLS helpers, migrations | Unassigned | Unassigned | Coordinate with API + worker owners. |

## Change Coordination Rules
- For contract changes (DTOs, SSE, queue payloads), update the owning module doc and
  record the change in `docs/refactor/migration-log.md`.
- For cross-module refactors, open a checklist in the PR describing impacted modules
  and required reviewers.
- For shared package changes, include at least one API owner and one worker owner in
  review, and run the shared export map tests.

## Escalation Paths
- Day-to-day ownership questions: module primary owner.
- Cross-module disagreements: module owners + refactor lead.
- Production risk or contract disputes: refactor lead + engineering manager.

## Ownership Updates
- Update this document whenever modules are added or re-scoped.
- Capture ownership changes in `docs/refactor/migration-log.md`.
- Mark ownership changes in `tasks.yml` to keep the refactor plan aligned.

## Related Docs
- Architecture map: `docs/refactor/architecture.md`
- API module map: `docs/refactor/api-modules.md`
- Shared package conventions: `docs/refactor/shared-packages.md`
- Migration log: `docs/refactor/migration-log.md`
