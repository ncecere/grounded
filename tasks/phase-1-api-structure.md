# Phase 1: API Structure and Domain Modules

## Objectives
- Reduce route file size and improve separation of concerns.
- Standardize the flow: route -> service -> repo.
- Isolate app assembly and startup work from handlers.

## Scope
- `apps/api/src/index.ts` split into app, routes, and startup.
- Domain modules for auth, tenants, knowledge bases, sources, agents, chat, widget, analytics, tools, uploads, test suites, admin, and internal routes.
- Shared helpers for audit logging, error handling, and RLS usage.

## Out of Scope
- Endpoint behavior changes or new endpoints.
- Database schema/migration changes.
- Queue or worker changes.

## Dependencies
- Phase 0 baseline inventory complete.

## Task List
- [ ] Define domain module boundaries and migration order.
- [ ] Define module boundary rules and allowed import directions.
- [ ] Define the module template for `apps/api/src/modules/<domain>` (routes.ts, schema.ts, service.ts, repo.ts, types.ts).
- [ ] Document required exports and where optional layers can be omitted.
- [ ] Create `apps/api/src/app.ts` to build the Hono app with middleware.
- [ ] Create `apps/api/src/routes/index.ts` to assemble v1 routes.
- [ ] Create `apps/api/src/startup/index.ts` for migrations, seeding, scheduler startup, and signal handlers.
- [ ] Document middleware order and route mount map (public/admin/internal).
- [ ] Add `apps/api/src/modules/index.ts` for stable module exports.
- [ ] Keep route mount paths unchanged and document any aliases.
- [ ] Move hosted chat page asset serving into a dedicated module.
- [ ] Extract validation schemas from route files into module schema files.
- [ ] Move DB queries into repo functions scoped by domain.
- [ ] Add service functions for business logic and transaction orchestration.
- [ ] Define service/repo transaction patterns and cross-module access rules.
- [ ] Normalize error usage (NotFoundError, ForbiddenError, QuotaExceededError).
- [ ] Preserve logging and error code parity for operational dashboards.
- [ ] Centralize audit logging helpers for reuse.
- [ ] Update route files to call services and import schemas.
- [ ] Add or update module-level tests for key routes (agents, sources, chat).
- [ ] Add SSE contract regression checks for chat and widget events.
- [ ] Update tests and imports after file moves.
- [ ] Create `docs/refactor/api-modules.md` with the new module map.

## Deliverables
- New API app assembly files: `apps/api/src/app.ts`, `apps/api/src/routes/index.ts`, `apps/api/src/startup/index.ts`.
- Domain module structure under `apps/api/src/modules/`.
- Reduced route file sizes and clearer ownership boundaries.
- Module map in `docs/refactor/api-modules.md` (includes boundaries and middleware order).

## Validation and Exit Criteria
- [ ] `bun run --filter @grounded/api typecheck` passes.
- [ ] `bun run --filter @grounded/api lint` passes (if configured).
- [ ] `bun run --filter @grounded/api test` passes.
- [ ] Manual smoke: login, list KBs, trigger a source run.
- [ ] SSE event names and payloads unchanged for chat/widget.
- [ ] Route mount paths and middleware order unchanged.
