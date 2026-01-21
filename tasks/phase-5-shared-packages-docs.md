# Phase 5: Shared Packages and Documentation

## Objectives
- Reduce duplicated types and enums across apps.
- Document architecture and ownership boundaries.
- Create a stable foundation for future features.

## Scope
- Shared DTOs, enums, and errors across API, workers, and web.
- Documentation updates under `docs/`.
- Minor cleanup of unused helpers where safe.

## Out of Scope
- Behavior changes to APIs or workers.
- Dependency upgrades unrelated to refactor work.
- Schema or migration changes.

## Decision
- Use `packages/shared` as the single home for cross-app DTOs, enums, and errors.
- Organize shared types by domain within `packages/shared/src/types/`.

## Task List
- [ ] Audit shared types across API, workers, and web for duplication.
- [ ] Create submodules in `packages/shared/src/types/` (api, workers, queue, widget, analytics, admin).
- [ ] Define export boundaries and deprecation strategy for moved types.
- [ ] Add export maps/tsconfig path aliases to prevent deep imports.
- [ ] Move shared DTOs/enums/errors into the shared package.
- [ ] Update imports gradually and keep backward-compatible barrels where needed.
- [ ] Define a deprecation timeline and removal criteria for old type locations.
- [ ] Add an adoption plan for web API types to avoid churn with Phase 4.
- [ ] Remove duplicates in `apps/web/src/lib/api/types.ts` once shared types are adopted.
- [ ] Add architecture notes in `docs/refactor/architecture.md`.
- [ ] Add module ownership guidelines in `docs/refactor/ownership.md`.
- [ ] Add `docs/refactor/shared-packages.md` with export conventions.
- [ ] Remove dead code or unused helpers where verified.

## Deliverables
- Shared package with stable exports for common types.
- Architecture and ownership documentation.
- Reduced duplication across apps.
- Shared package conventions doc in `docs/refactor/shared-packages.md`.
- Deprecation and adoption plan for legacy type locations.

## Validation and Exit Criteria
- [ ] `bun run typecheck` passes across the monorepo.
- [ ] Targeted app tests still pass.
- [ ] Docs reviewed and approved.
