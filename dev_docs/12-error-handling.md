# Error Handling & Middleware

## Error Class Hierarchy

All application errors extend from `AppError` (defined in `packages/shared/src/errors/http.ts`):

```
AppError (base)
├── NotFoundError        (404)  — "Resource not found"
├── UnauthorizedError    (401)  — "Unauthorized"
├── ForbiddenError       (403)  — "Forbidden"
├── BadRequestError      (400)  — Validation / malformed input
├── ConflictError        (409)  — Duplicate / constraint violation
├── RateLimitError       (429)  — Rate limit exceeded
└── QuotaExceededError   (402)  — Tenant quota exceeded
```

### Usage
```typescript
import { NotFoundError, BadRequestError } from "@grounded/shared/errors/http";

// In a route handler:
const agent = await db.query.agents.findFirst({ where: ... });
if (!agent) throw new NotFoundError("Agent");

if (!body.name) throw new BadRequestError("Name is required");
```

### Error Response Format
The global error handler in `apps/api/src/middleware/error-handler.ts` catches all errors:

```json
{
  "error": "NOT_FOUND",
  "message": "Agent not found",
  "requestId": "uuid"
}
```

In production, internal errors (500) hide the actual message. In development, the real error message is returned.

## Middleware Stack

The API applies middleware in this order (see `apps/api/src/app.ts`):

```
1. requestId()          — Generates X-Request-ID for every request
2. secureHeaders()      — Sets security headers (HSTS, X-Frame-Options, etc.)
3. prettyJSON()         — Pretty-prints JSON in dev
4. cors()               — CORS with configured origins
5. Body size limiter    — Rejects oversized payloads (64KB JSON, 15MB uploads)
6. wideEventMiddleware  — Structured request logging (timing, tenant, user)
7. [route middleware]   — Auth, rate limiting, role checks (per-route)
8. [route handler]
9. errorHandler         — Global error catch (onError)
10. notFound            — 404 for unmatched routes
```

## Authentication Middleware

**File:** `apps/api/src/middleware/auth/middleware.ts`

### `auth()`
Main authentication middleware. Applied to all protected routes.

Token type detection:
- `grounded_admin_*` → Admin API token
- `grounded_*` → Tenant API key
- Other → JWT bearer (tries local first, then OIDC)

### `requireRole(...roles)`
RBAC middleware. Accepts role names: `"owner"`, `"admin"`, `"member"`, `"viewer"`.
System admins bypass role checks.

### `requireSystemAdmin()`
Restricts to system admin users only.

### `requireTenant()`
Ensures `X-Tenant-ID` header is present and valid.

### Common Pattern
```typescript
const routes = new Hono();

// All routes need auth
routes.use("*", auth());

// Read access: any role
routes.get("/", requireRole("viewer", "member", "admin", "owner"), handler);

// Write access: admin or above
routes.post("/", requireRole("admin", "owner"), handler);

// System-level: admin only
routes.get("/admin/settings", requireSystemAdmin(), handler);
```

## Rate Limiting

**File:** `apps/api/src/middleware/rate-limit.ts`

Uses Redis-backed sliding window rate limiter:

```typescript
import { rateLimit } from "../middleware/rate-limit";

// Apply to chat endpoint
routes.post("/chat", rateLimit({
  keyPrefix: "chat",
  limit: 60,             // 60 requests
  windowSeconds: 60,     // per minute
}), handler);
```

**Rate limit key resolution (in priority order):**
1. Custom `keyFn` if provided
2. `{prefix}:{tenantId}` if authenticated with tenant
3. `{prefix}:user:{userId}` if authenticated without tenant
4. `{prefix}:ip:{ip}` as fallback

**Response headers:**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1709510400
Retry-After: 60  (only when limited)
```

## SSE Streaming

**File:** `apps/api/src/services/sse-stream.ts`

Provides a robust SSE streaming helper with heartbeat:

```typescript
import { streamWithHeartbeat, setSSEHeaders } from "../services/sse-stream";

return streamWithHeartbeat(c, {
  heartbeatMs: 2000,  // Send ping every 2s to keep connection alive
  onStream: async ({ writeJson, isAborted }) => {
    for await (const event of ragService.chat(message)) {
      if (isAborted()) break;
      await writeJson(event);
    }
  },
  onAbort: () => {
    // Cleanup on client disconnect
  },
});
```

**Features:**
- Automatic heartbeat pings (prevents proxy timeouts)
- Abort detection (client disconnect handling)
- Proper SSE headers (`X-Accel-Buffering: no`, `Cache-Control: no-cache`)
- Clean stream closure

## Wide Event Logging

**File:** `packages/logger/src/types.ts`

Every API request produces a single "wide event" log entry containing all context:

```typescript
interface WideEvent {
  requestId: string;
  traceId?: string;
  timestamp: string;
  durationMs?: number;
  service: "api" | "ingestion-worker" | "scraper-worker";
  
  // Context
  tenant?: { id, name, slug };
  user?: { id, email, role };
  http?: { method, path, statusCode, userAgent, ip };
  job?: { id, name, queue, attempt };
  
  // Business context
  knowledgeBase?: { id, name };
  source?: { id, name, type };
  agent?: { id, name };
  
  // Result
  operation?: string;
  outcome?: "success" | "error" | "partial";
  error?: { type, code, message, stack };
  
  // Metrics
  dbQueries?: number;
  cacheHit?: boolean;
  bytesProcessed?: number;
}
```

### Sampling
Not every request needs to be logged. The sampling config controls:
- `baseSampleRate` — Default: 0.1 (10% of successful requests)
- `alwaysLogErrors: true` — All errors are logged
- `slowRequestThresholdMs: 2000` — Slow requests always logged
- Workers default to 100% logging

## Audit Logging

**File:** `apps/api/src/services/audit.ts`

Critical actions are recorded to the `audit_logs` table:

```typescript
import { audit } from "../services/audit";

await audit.log(
  {
    action: "agent.updated",
    resourceType: "agent",
    resourceId: agentId,
    metadata: {
      changes: { systemPrompt: { from: old, to: new } },
      resourceName: agent.name,
    },
  },
  {
    actorId: auth.user.id,
    tenantId: auth.tenantId,
    ipAddress: c.req.header("X-Forwarded-For"),
  }
);
```

50+ audited action types covering auth, CRUD, settings, and model changes. See `packages/db/src/schema/audit.ts` for the full list.
