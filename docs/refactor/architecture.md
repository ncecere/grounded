# Refactor Architecture Notes

This note captures the refactor-era module boundaries for Grounded. It
complements `docs/development/architecture.md` by focusing on the new layout,
layering, and contract touchpoints introduced during the refactor plan.

## Module Boundaries

### API (`apps/api`)
- App assembly lives in `apps/api/src/app.ts` with shared startup in
  `apps/api/src/startup/index.ts` and the route mount map in
  `apps/api/src/routes/index.ts`.
- Domain modules live under `apps/api/src/modules/*` with the standard layers:
  `routes.ts`, `schema.ts`, `service.ts`, `repo.ts`, and `types.ts`.
- Cross-cutting helpers (auth, audit, logging, RLS, settings) remain centralized
  and are imported by modules rather than duplicated.

### Ingestion Worker (`apps/ingestion-worker`)
- The entry point wires `jobs/` and `queues/` through their respective index
  registries to avoid ad-hoc processor wiring.
- Stage management is split into `stage/` modules (config, progress,
  transitions, cleanup, priority) while reusable logic lives in `services/`.
- Bootstrap concerns (settings refresh, vector store initialization, shutdown)
  are isolated in `bootstrap/` helpers.

### Scraper Worker (`apps/scraper-worker`)
- Fetch orchestration is split into `fetch/` strategies and a selection helper
  to preserve the existing decision rules.
- Browser lifecycle is centralized in `browser/` with a shared pool helper.
- Job orchestration runs through `jobs/index.ts`, while shared helpers live in
  `services/` (fairness slots, content validation, error utilities).

### Web App (`apps/web`)
- Navigation is driven by the page registry in
  `apps/web/src/app/page-registry.ts`.
- Auth/session and tenant state live in providers (`AuthProvider`,
  `TenantProvider`, `AppStateProvider`) consumed by `App.tsx` and the sidebar.

### Shared Packages (`packages/shared`)
- Shared DTOs, enums, and errors live in `packages/shared/src/types/*` and are
  exported through `packages/shared/src/types/index.ts` for compatibility.
- Export maps and path aliases prevent deep imports outside the package.

## Contract Touchpoints

- API module map: `docs/refactor/api-modules.md`
- Ingestion job contracts: `docs/refactor/ingestion-jobs.md`
- Scraper fetch contracts: `docs/refactor/scraper-fetch.md`
- Web navigation registry and access gates: `docs/refactor/web-navigation.md`
- Baseline behavior/observability: `docs/refactor/baseline.md`

## Refactor Constraints

- No API response, SSE event, or queue payload changes.
- No database schema or migration changes.
- No behavioral changes to ingestion or scraper pipelines.

## Related Ownership and Migration Docs

- Ownership guidelines: `docs/refactor/ownership.md`
- Shared package conventions: `docs/refactor/shared-packages.md`
- Migration log: `docs/refactor/migration-log.md`
