# Code Conventions

Coding standards and patterns used throughout the Grounded codebase.

## Language & Runtime

- **Runtime:** Bun (v1.x) — used for all apps and packages
- **Language:** TypeScript (strict mode)
- **Target:** ES2022
- **Module system:** ESNext (bundler resolution)

## Project Structure

### Naming Conventions

| What | Convention | Example |
|------|-----------|---------|
| Files (general) | kebab-case | `source-run-recovery.ts` |
| React components | PascalCase | `ReasoningPanel.tsx` |
| Variables/functions | camelCase | `getChatAgentRagType()` |
| Types/interfaces | PascalCase | `AgentConfig`, `StreamEvent` |
| Constants | camelCase or UPPER_SNAKE | `DEFAULT_CASE_TIMEOUT_MS` |
| Database tables | snake_case | `agent_test_suites` |
| Database columns | snake_case | `tenant_id`, `created_at` |
| API routes | kebab-case | `/knowledge-bases/:id` |
| Package names | kebab-case | `@grounded/ai-providers` |
| Zod schemas | camelCase + "Schema" | `createAgentSchema` |
| Service classes | PascalCase + "Service" | `SimpleRAGService` |

### File Organization

```
apps/api/src/
├── routes/           ← HTTP route handlers (thin: validate, call service, return)
├── modules/          ← Zod schemas + service helpers per domain
│   └── agents/
│       └── schema.ts ← Request validation schemas
├── services/         ← Business logic (heavy: DB queries, AI calls, streaming)
└── middleware/        ← Auth, error handling, rate limiting
```

**Pattern:** Routes are thin — they validate input (via Zod), call services, and return results. Services contain all business logic.

### Import Order

1. External packages (`hono`, `drizzle-orm`, `ai`)
2. Internal packages (`@grounded/db`, `@grounded/queue`)
3. Local imports (`../services/...`, `../middleware/...`)

## Database Conventions

### Soft Delete Pattern

All tenant-owned resources use soft delete:

```typescript
// Schema
deletedAt: timestamp("deleted_at", { withTimezone: true }),

// Query — always filter deleted
where: and(eq(table.id, id), isNull(table.deletedAt))

// Delete — set timestamp, don't remove
await db.update(table).set({ deletedAt: new Date() }).where(...)
```

After 30 days, the hard-delete scheduler permanently removes the data.

### Timestamps

Every table has:
- `createdAt` — set by `defaultNow()`
- `updatedAt` — set by `defaultNow()`, manually updated on writes
- `deletedAt` — null unless soft-deleted

All timestamps use `withTimezone: true` (stored as UTC in Postgres).

### UUID Primary Keys

All tables use `uuid("id").primaryKey().defaultRandom()`.

### RLS (Row-Level Security)

Tenant-scoped queries should use `withRequestRLS(c, async (tx) => { ... })` which sets the Postgres `app.tenant_id` session variable for RLS policy enforcement.

## API Conventions

### Response Format

```typescript
// Single resource
c.json({ agent: { ... } })

// List
c.json({ agents: [...] })

// Action confirmation
c.json({ message: "Agent deleted" })

// Error (via error classes)
throw new NotFoundError("Agent")
// → { error: "NOT_FOUND", message: "Agent not found" }
```

### Status Codes

| Code | When |
|------|------|
| 200 | Success (GET, PATCH, DELETE) |
| 201 | Resource created (POST) |
| 400 | Validation error |
| 401 | Not authenticated |
| 403 | Not authorized |
| 404 | Resource not found |
| 429 | Rate limited |

### Route Guards

```typescript
// Stack: auth() → requireTenant() → requireRole() → handler
route.post("/", auth(), requireTenant(), requireRole("owner", "admin"), async (c) => { ... })
```

## Service Conventions

### Error Handling

- Services throw typed errors (`NotFoundError`, `BadRequestError`)
- Error handler middleware catches and formats the response
- Audit logging is non-fatal — errors are logged but don't break requests
- Background service errors are logged but don't crash the process

### Async Generators for Streaming

Chat services use `async *` generators:

```typescript
async *chat(message: string): AsyncGenerator<StreamEvent> {
  yield { type: "status", ... };
  for await (const chunk of result.textStream) {
    yield { type: "text", content: chunk };
  }
  yield { type: "done", ... };
}
```

### Dependency Injection (Test Runner)

Complex services use factory functions with injectable dependencies:

```typescript
function createTestRunner(deps?: Partial<TestRunnerDependencies>) {
  // Use provided deps or defaults
  const store = deps?.store ?? createDefaultStore();
  const now = deps?.now ?? (() => new Date());
  // ...
}
```

## Frontend Conventions

### State-Based Navigation

The web app uses state, not React Router:

```typescript
// Navigation via state setter
setCurrentPage("agents");

// Page rendering via registry
const PageComponent = pageRegistry[currentPage];
```

### Component Structure

```
apps/web/src/
├── app/                ← App shell, navigation, page registry
├── components/
│   ├── ui/             ← Shadcn/Radix primitives (Button, Dialog, etc.)
│   └── [feature]/      ← Feature components (AgentCard, SourceDetail, etc.)
├── hooks/              ← Custom hooks (useApi, useToast, etc.)
└── lib/                ← Utilities, API client
```

### Data Fetching

TanStack Query for all API calls:

```typescript
const { data, isLoading } = useQuery({
  queryKey: ["agents", tenantId],
  queryFn: () => api.get("/agents"),
});
```

---

## Related Docs

- [10 — Development Guide](./10-development-guide.md) — Setup, common tasks, debugging
- [12 — Error Handling](./12-error-handling.md) — Error classes, middleware chain
- [07 — Frontend](./07-frontend.md) — React UI architecture
