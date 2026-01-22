# Phase 4: Web App Structure

## Objectives
- Centralize navigation labels and page mapping.
- Reduce `App.tsx` state complexity.
- Split API types by domain for easier ownership.

## Scope
- `apps/web/src/App.tsx` and `apps/web/src/components/app-sidebar.tsx`.
- `apps/web/src/providers/` for shared app state.
- `apps/web/src/lib/api/types.ts` split by domain.

## Out of Scope
- Changing the navigation model or routing library.
- Visual redesigns.
- API behavior changes.

## Dependencies
- Phase 0 baseline inventory complete.

## Task List
- [ ] Create `apps/web/src/app/page-registry.ts` to define Page type, labels, and component mapping.
- [ ] Define page registry schema (label, group, component, auth gate, order).
- [ ] Update `apps/web/src/App.tsx` to use the page registry for routing and labels.
- [ ] Update `apps/web/src/components/app-sidebar.tsx` to use the registry for nav items.
- [ ] Add nav grouping metadata (workspace vs admin) in the page registry.
- [ ] Preserve existing navigation gating and admin/workspace segmentation.
- [ ] Add providers for auth/session state and tenant/selection state.
- [ ] Migrate state management out of `App.tsx` into providers.
- [ ] Document provider boundaries and responsibilities.
- [ ] Split API types into `apps/web/src/lib/api/types/*.ts` by domain.
- [ ] Align API type split with shared package adoption plan (Phase 5).
- [ ] Update type exports and imports throughout the web app.
- [ ] Add a barrel export for the new types structure.
- [ ] Create `docs/refactor/web-navigation.md` describing page registry usage.

## API Types Barrel Export
- Use `apps/web/src/lib/api/types/index.ts` as the shared entry point for web API types.
- Preferred import path: `@/lib/api/types` (for example: `import type { Source } from "@/lib/api/types"`).
- Domain modules remain the source of truth until Phase 5 shared package adoption.

## API Type Adoption Plan (Phase 4 -> Phase 5)
- Phase 4 keeps the domain split inside `apps/web/src/lib/api/types` to avoid churn while the shared package work is prepared.
- Phase 5 will introduce shared type submodules under `packages/shared/src/types` (see Phase 5 task list for `api`, `widget`, and `admin` domains).
- Adoption sequence:
  1. Create shared submodules and export maps in Phase 5 before moving any web types.
  2. Copy/move the domain modules from `apps/web/src/lib/api/types` into the shared package while keeping a compatibility barrel in the web app.
  3. Update web imports to the shared barrel only after shared type exports are stable and documented.
  4. Remove web-local duplicates once all consumers use the shared types and Phase 5 cleanup is complete.
- To avoid double moves, new web features should continue to add or adjust types in the Phase 4 location until Phase 5 shared submodules are available.
- Stakeholder review is required before step 3 to confirm sequencing and ownership for shared type modules.

## Deliverables
- Central page registry for labels and components.
- Providers for shared app state.
- Domain-based API type modules.
- Web navigation doc in `docs/refactor/web-navigation.md` (includes registry schema and gating).

## Validation and Exit Criteria
- [ ] `bun run --filter @grounded/web typecheck` passes.
- [ ] Manual smoke: login, switch tenants, navigate core pages.
- [ ] Navigation gating and admin/workspace segmentation unchanged.
