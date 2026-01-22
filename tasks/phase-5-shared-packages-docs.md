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

### Type Submodules (Initial Pass)
- `packages/shared/src/types/api.ts` - API-facing DTOs, enums, and retrieval/chat contracts.
- `packages/shared/src/types/workers.ts` - Ingestion/scraper worker contracts and helpers.
- `packages/shared/src/types/queue.ts` - Queue configuration and concurrency helpers.
- `packages/shared/src/types/widget.ts` - Widget theme/config schemas and enums.
- `packages/shared/src/types/analytics.ts` - Metrics/logging contracts and helpers.
- `packages/shared/src/types/admin.ts` - Admin/system-level roles and contracts.

These modules currently re-export from `packages/shared/src/types/index.ts` while the
type migration is staged. Subsequent tasks will move types into the matching
submodules and tighten their export boundaries.

## Shared Type Duplication Audit
Date: 2026-01-21

### Accounts and tenants (owner: API auth/tenants)
- Shared: `packages/shared/src/types/index.ts` exports `Tenant`, `User`, `TenantMembership`, `TenantRole`, `SystemRole`.
- Web duplicates: `apps/web/src/lib/api/types/tenants.ts` (`Tenant`, `UserTenant`, `TenantMember`) and `apps/web/src/lib/api/types/auth.ts` (`User`).
- Notes: Web DTOs use string timestamps and role strings; align with shared DTOs or introduce JSON-serializable variants.

### Knowledge bases and sources (owner: API knowledge-bases/sources)
- Shared: `KnowledgeBase`, `Source`, `SourceConfig`, `SourceType`, `SourceRun`, `SourceRunStats`, `SourceRunStage`, `SourceRunStatus`, `SourceRunTrigger` in `packages/shared/src/types/index.ts`.
- Web duplicates: `apps/web/src/lib/api/types/knowledge-bases.ts`, `apps/web/src/lib/api/types/sources.ts`.
- API usage: `apps/api/src/routes/uploads.ts` already imports `SourceRunStage` from shared.

### Agents, chat, and retrieval (owner: API agents/chat)
- Shared: `Agent`, `RagType`, `RerankerType`, `RetrievalConfig`, `Citation`, `ChatRequest`, `ChatResponse`, `ChatEndpointToken` in `packages/shared/src/types/index.ts`.
- Web duplicates: `apps/web/src/lib/api/types/agents.ts` (`RagType`, `Agent`, `ChatEndpoint`, `retrievalConfig`, widget config shape).
- API duplicates: `apps/api/src/modules/chat/service.ts` defines `ChatRagType`; `apps/api/src/modules/agents/schema.ts` uses `z.enum(["simple", "advanced"])` and `z.enum(["heuristic", "cross_encoder"])`.

### Widget configuration (owner: widget)
- Shared: `WidgetTheme`, `WidgetConfig`, `ButtonStyle`, `ButtonSize`, `ButtonIcon`, `widgetThemeSchema` in `packages/shared/src/types/index.ts`.
- Web duplicates: `apps/web/src/lib/api/types/agents.ts` embeds widget theme fields.
- API notes: `apps/api/src/modules/agents/schema.ts` already references `widgetThemeSchema`, but `apps/api/src/modules/agents/service.ts` keeps `WidgetTheme` typed as `Record<string, unknown>`.

### Ingestion and scraper job contracts (owner: workers/ingestion + queue)
- Shared: job payload types (`BaseJob`, `PageFetchJobPayload`, `EmbedChunksBatchJobPayload`), ingestion enums (`IngestionStage`, `StageStatus`, `PageStatus`, `SkipReason`), queue config helpers, and `FetchMode` in `packages/shared/src/types/index.ts`.
- Worker usage: `apps/ingestion-worker` and `apps/scraper-worker` already import these from `@grounded/shared`; no local duplicates observed.

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
