# API Module Map

## Purpose

- Document the API module structure after Phase 1 refactoring.
- Provide a reference for module boundaries, file ownership, and import rules.
- Capture middleware order and route mounting for operational reference.

## Module Structure Overview

The API follows a domain-driven module structure under `apps/api/src/modules/`. Each domain module can include:

| File | Responsibility |
| --- | --- |
| `routes.ts` | Hono routes: request wiring + response formatting |
| `schema.ts` | Validation schemas + parsing helpers (Zod) |
| `service.ts` | Business logic, orchestration, transactions |
| `repo.ts` | Database queries and persistence helpers |
| `types.ts` | Type-only exports shared across layers |

Modules expose their public API through the root `apps/api/src/modules/index.ts` barrel export.

## Domain Modules

### Current Module Inventory

| Module | Routes | Schema | Service | Repo | Owner |
| --- | --- | --- | --- | --- | --- |
| `auth` | `routes/auth.ts` | - | - | - | Unassigned |
| `tenants` | `routes/tenants.ts` | `modules/tenants/schema.ts` | - | - | Unassigned |
| `knowledge-bases` | `routes/knowledge-bases.ts` | `modules/knowledge-bases/schema.ts` | - | - | Unassigned |
| `sources` | `routes/sources.ts` | `modules/sources/schema.ts` | - | - | Unassigned |
| `agents` | `routes/agents.ts` | `modules/agents/schema.ts` | `modules/agents/service.ts` | - | Unassigned |
| `chat` | `routes/chat.ts` | `modules/chat/schema.ts` | `modules/chat/service.ts` | - | Unassigned |
| `widget` | `routes/widget.ts` | `modules/widget/schema.ts` | - | - | Unassigned |
| `chat-endpoint` | `routes/chat-endpoint.ts` | `modules/chat-endpoint/schema.ts` | - | - | Unassigned |
| `analytics` | `routes/analytics.ts` | `modules/analytics/schema.ts` | - | - | Unassigned |
| `uploads` | `routes/uploads.ts` | - | - | - | Unassigned |
| `tools` | `routes/tools.ts` | `modules/tools/schema.ts` | - | - | Unassigned |
| `test-suites` | `routes/test-suites.ts` | `modules/test-suites/schema.ts` | - | - | Unassigned |
| `admin` | `routes/admin/*.ts` | `modules/admin/schema.ts` | - | `modules/admin/repo.ts` | Unassigned |
| `internal` | `routes/internal/workers.ts` | - | - | - | Unassigned |
| `hosted-chat` | `routes/hosted-chat.ts` | - | - | - | Unassigned |

### Module Boundaries

Each module owns a specific domain and should encapsulate:

- **auth**: Login, session management, API key auth, auth-specific middleware.
- **tenants**: Tenant CRUD, memberships, billing status, tenant-scoped access checks.
- **knowledge-bases**: KB CRUD, attachments, sharing metadata, reindex operations.
- **sources**: Source configuration, runs, status, ingestion orchestration hooks.
- **agents**: Agent CRUD, model selection, KB attachments, agent settings, widget config.
- **chat**: Chat sessions, SSE streaming, retrieval orchestration entrypoints.
- **widget**: Public widget config, widget chat entrypoints.
- **chat-endpoint**: Hosted widget public chat endpoints (`/api/v1/c`).
- **analytics**: Usage metrics, dashboard aggregates, retention summaries.
- **tools**: Agent tool registry, tool invocation metadata, tool config.
- **uploads**: File upload handling, storage metadata, signed URL helpers.
- **test-suites**: Test suite CRUD, test cases, test runs, experiments.
- **admin**: Admin-only routes for tenant/user management, models, settings, audit.
- **internal**: Worker-to-API routes, settings fetch, health checks.
- **hosted-chat**: Top-level hosted chat page redirect and published chat asset.

## Import Rules

### Allowed Import Directions

```
routes.ts  -->  schema.ts, service.ts, types.ts, shared helpers
service.ts -->  repo.ts, schema.ts, types.ts, shared helpers
repo.ts    -->  DB clients, shared helpers, types.ts (no service/route imports)
schema.ts  -->  self-contained (Zod, types, shared validation helpers)
types.ts   -->  type-only, no runtime imports
```

### Cross-Module Access Rules

1. Cross-module reads/writes go through the owning module's `service.ts` exports.
2. Avoid cross-module `repo.ts` imports; use service wrappers if needed.
3. Shared helpers (auth, audit, errors, RLS, logging, settings) are safe to import from any layer.
4. Module-to-module type sharing uses exported `types.ts` or shared package types.
5. Exceptions must be documented in the module's README with rationale.

### Service/Repo Transaction Patterns

- Services own transactions when workflows span multiple repo calls.
- Repos accept an optional transaction client (`tx`) and avoid opening their own transactions.
- Services pass the same `tx` to all repo calls that must commit/rollback together.
- External side effects (jobs, provider calls, uploads) happen after commit or use outbox pattern.

## App Assembly

### Entry Point

- `apps/api/src/index.ts` - Main entry point, imports `createApiApp` and runs startup tasks.

### App Assembly Module

- `apps/api/src/app.ts` - Builds the Hono app with middleware and routes.

### Routes Assembly

- `apps/api/src/routes/index.ts` - Creates v1 route tree by mounting domain routers.

### Startup Module

- `apps/api/src/startup/index.ts` - Encapsulates migrations, seeding, scheduler startup, and shutdown handlers.

## Middleware Order

Middleware is registered in this order in `apps/api/src/app.ts`:

| Order | Middleware | Notes |
| --- | --- | --- |
| 1 | `requestId()` | Assigns unique request ID |
| 2 | `secureHeaders()` | Security headers |
| 3 | `prettyJSON()` | JSON formatting |
| 4 | `cors()` | CORS handling |
| 5 | `wideEventMiddleware()` | Wide event logging (skips `/health`) |
| 6 | `app.onError(errorHandler)` | Global error handler |
| 7 | `app.notFound()` | 404 handler |

## Route Mount Map

### Top-Level Routes

| Path | Handler | Notes |
| --- | --- | --- |
| `GET /health` | Inline handler | Health check endpoint |
| `GET /chat/:token` | `hostedChatRoutes` | Redirects to `/api/v1/c/:token` |
| `GET /published-chat.js` | `hostedChatRoutes` | Serves published chat widget script |
| `/api/v1/*` | `createV1Routes()` | V1 API routes |

### V1 Routes - Public (no auth required)

| Mount Path | Router | Notes |
| --- | --- | --- |
| `/api/v1/auth` | `authRoutes` | Login, logout, session, OAuth |
| `/api/v1/widget` | `widgetRoutes` | Public widget config and chat |
| `/api/v1/c` | `chatEndpointRoutes` | Public hosted chat endpoints |

### V1 Routes - Tenant/Authenticated

| Mount Path | Router | Notes |
| --- | --- | --- |
| `/api/v1/tenants` | `tenantRoutes` | Tenant CRUD, memberships |
| `/api/v1/knowledge-bases` | `kbRoutes` | KB management |
| `/api/v1/global-knowledge-bases` | `kbRoutes` | Shares router with `/knowledge-bases` |
| `/api/v1/sources` | `sourceRoutes` | Source configuration, runs |
| `/api/v1/agents` | `agentRoutes` | Agent CRUD |
| `/api/v1/agents` | `agentTestSuiteRoutes` | Agent test suites (same mount) |
| `/api/v1/test-suites` | `testSuiteRoutes` | Test suite management |
| `/api/v1/test-cases` | `testCaseRoutes` | Test case management |
| `/api/v1/test-runs` | `testRunRoutes` | Test run management |
| `/api/v1/experiments` | `experimentRoutes` | Experiment management |
| `/api/v1/tools` | `toolRoutes` | Tool registry |
| `/api/v1/chat` | `chatRoutes` | Chat sessions, SSE streaming |
| `/api/v1/analytics` | `analyticsRoutes` | Usage analytics |
| `/api/v1/uploads` | `uploadRoutes` | File uploads |

### V1 Routes - Admin (system admin only)

| Mount Path | Router | Notes |
| --- | --- | --- |
| `/api/v1/admin/dashboard` | `adminDashboardRoutes` | Admin dashboard data |
| `/api/v1/admin/settings` | `adminSettingsRoutes` | System settings |
| `/api/v1/admin/models` | `adminModelsRoutes` | AI model configuration |
| `/api/v1/admin/users` | `adminUsersRoutes` | User management |
| `/api/v1/admin/shared-kbs` | `adminSharedKbsRoutes` | Shared KB management |
| `/api/v1/admin/analytics` | `adminAnalyticsRoutes` | System analytics |
| `/api/v1/admin/tokens` | `adminTokensRoutes` | API token management |
| `/api/v1/admin/audit` | `adminAuditRoutes` | Audit log access |

### V1 Routes - Internal (worker access)

| Mount Path | Router | Notes |
| --- | --- | --- |
| `/api/v1/internal/workers` | `internalWorkersRoutes` | Worker settings fetch |

### Route Aliases

| Alias | Target | Reason |
| --- | --- | --- |
| `/api/v1/global-knowledge-bases` | Same router as `/api/v1/knowledge-bases` | Shared CRUD behavior |
| `/api/v1/agents` (test suites) | Mounts both `agentRoutes` and `agentTestSuiteRoutes` | Agent-specific test suites |
| `GET /chat/:token` | Redirects to `/api/v1/c/:token` | Nicer URLs for hosted chat |

## Module Exports

The barrel export at `apps/api/src/modules/index.ts` exposes:

```typescript
// Domain route exports
export { authRoutes } from "../routes/auth";
export { tenantRoutes } from "../routes/tenants";
export { kbRoutes } from "../routes/knowledge-bases";
export { sourceRoutes } from "../routes/sources";
export { agentRoutes } from "../routes/agents";
export { chatRoutes } from "../routes/chat";
export { widgetRoutes } from "../routes/widget";
export { chatEndpointRoutes } from "../routes/chat-endpoint";
export { analyticsRoutes } from "../routes/analytics";
export { uploadRoutes } from "../routes/uploads";
export { toolRoutes } from "../routes/tools";

// Test suite exports
export {
  agentTestSuiteRoutes,
  testCaseRoutes,
  testSuiteRoutes,
  testRunRoutes,
  experimentRoutes,
} from "../routes/test-suites";

// Admin route exports
export { adminSettingsRoutes } from "../routes/admin/settings";
export { adminModelsRoutes } from "../routes/admin/models";
export { adminUsersRoutes } from "../routes/admin/users";
export { adminSharedKbsRoutes } from "../routes/admin/shared-kbs";
export { adminDashboardRoutes } from "../routes/admin/dashboard";
export { adminAnalyticsRoutes } from "../routes/admin/analytics";
export { adminTokensRoutes } from "../routes/admin/tokens";
export { adminAuditRoutes } from "../routes/admin/audit";

// Internal route exports
export { internalWorkersRoutes } from "../routes/internal/workers";
```

## Related Documentation

- Baseline inventory: `docs/refactor/baseline.md`
- Dependency map: `docs/refactor/dependencies.md`
- Test matrix: `docs/refactor/test-matrix.md`
- Migration log: `docs/refactor/migration-log.md`
- Phase 1 plan: `tasks/phase-1-api-structure.md`
