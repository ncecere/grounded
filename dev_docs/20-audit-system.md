# Audit System

The audit system records all significant user and system actions for compliance, debugging, and security investigation.

## Architecture

```
API Route Handler
  └── auditService.logSuccess() / logFailure()
        └── INSERT INTO audit_logs
              ↓
Audit Query API ← Admin UI "Audit Logs" page
  └── auditService.query() with filtering + pagination
```

**Files:**
- `packages/db/src/schema/audit.ts` — Table definition, action/resource types
- `apps/api/src/services/audit.ts` — Service class, helpers (396 lines)
- `apps/api/src/routes/admin/audit.ts` — Query endpoints

---

## Audit Actions

Every auditable event has an `action` and a `resourceType`.

### Actions (30 types)

| Category | Actions |
|----------|---------|
| **Auth** | `auth.login`, `auth.logout`, `auth.login_failed`, `auth.password_changed` |
| **Tenant** | `tenant.created`, `tenant.updated`, `tenant.deleted` |
| **User** | `user.created`, `user.updated`, `user.disabled`, `user.enabled`, `user.role_changed` |
| **Agent** | `agent.created`, `agent.updated`, `agent.deleted`, `agent.enabled`, `agent.disabled` |
| **Knowledge Base** | `kb.created`, `kb.updated`, `kb.deleted`, `kb.published`, `kb.unpublished` |
| **Source** | `source.created`, `source.updated`, `source.deleted`, `source.run_triggered` |
| **Token/Key** | `api_key.created`, `api_key.revoked`, `widget_token.created`, `widget_token.revoked`, `chat_endpoint.created`, `chat_endpoint.revoked` |
| **Settings** | `settings.updated` |
| **Models** | `model.created`, `model.updated`, `model.deleted`, `provider.created`, `provider.updated`, `provider.deleted` |

### Resource Types (12)

`user`, `tenant`, `agent`, `knowledge_base`, `source`, `api_key`, `widget_token`, `chat_endpoint`, `settings`, `model`, `provider`, `membership`

---

## Audit Log Record

| Column | Type | Nullable | Purpose |
|--------|------|:--------:|---------|
| `id` | uuid | | Primary key |
| `timestamp` | timestamptz | | When the event occurred |
| `actor_id` | uuid | ✓ | Who performed the action (null for system/automated) |
| `tenant_id` | uuid | ✓ | Tenant context (null for system-level actions) |
| `action` | text | | What was done (see actions above) |
| `resource_type` | text | | What type of thing was affected |
| `resource_id` | uuid | ✓ | Which specific resource |
| `metadata` | jsonb | | Additional details (see below) |
| `ip_address` | inet | ✓ | Client IP address |
| `success` | boolean | | Whether the action succeeded |
| `error_message` | text | ✓ | Error details on failure |

### Metadata Structure

```typescript
interface AuditMetadata {
  resourceName?: string;                    // Human-readable name
  changes?: Record<string, {                // What changed (for updates)
    from: unknown;
    to: unknown;
  }>;
  reason?: string;                          // Why the action was taken
  userAgent?: string;                       // Browser/client info
  [key: string]: unknown;                   // Any additional context
}
```

**Example metadata for an agent update:**
```json
{
  "resourceName": "Support Bot",
  "changes": {
    "systemPrompt": { "from": "You are helpful.", "to": "You are a support agent." },
    "ragType": { "from": "simple", "to": "advanced" }
  }
}
```

---

## Service API

### Logging Events

```typescript
const auditService = new AuditService();

// Log a successful action
await auditService.logSuccess(
  "agent.updated",         // action
  "agent",                 // resourceType
  auditContext,            // { actorId, tenantId, ipAddress }
  {
    resourceId: agent.id,
    resourceName: agent.name,
    changes: calculateChanges(oldAgent, newAgent),
    metadata: { ragType: "advanced" },
  }
);

// Log a failed action
await auditService.logFailure(
  "auth.login_failed",
  "user",
  auditContext,
  "Invalid credentials",    // error message
  { metadata: { email: "user@example.com" } }
);
```

### Building Audit Context

```typescript
import { buildAuditContext } from "../services/audit";

// From an API route handler:
const auditContext = buildAuditContext({
  authContext: c.get("auth"),    // From auth middleware
  headers: c.req.raw.headers,   // For IP extraction
});
// Returns: { actorId: "uuid", tenantId: "uuid", ipAddress: "1.2.3.4" }
```

IP address extraction checks: `X-Forwarded-For` → `X-Real-IP` → undefined.

### Querying Audit Logs

```typescript
const result = await auditService.query({
  tenantId: "uuid",              // Filter by tenant
  actorId: "uuid",               // Filter by user
  action: "agent.updated",       // Filter by action
  resourceType: "agent",         // Filter by resource type
  resourceId: "uuid",            // Filter by specific resource
  startDate: new Date("2025-01-01"),
  endDate: new Date("2025-02-01"),
  search: "Support Bot",         // Search in action, resourceType, metadata
  limit: 50,
  offset: 0,
});
// Returns: { logs: [...], total: 142, hasMore: true }
```

### Specialized Queries

```typescript
// Get activity history for a specific resource
const history = await auditService.getResourceHistory("agent", agentId, 20);

// Get activity summary for a tenant (last 30 days)
const summary = await auditService.getTenantSummary(tenantId, 30);
// Returns: { totalEvents: 450, byAction: { "agent.updated": 23, ... },
//            byResourceType: { "agent": 45, ... }, failureCount: 3 }
```

---

## Change Tracking

The `calculateChanges()` helper computes diffs between old and new objects:

```typescript
const changes = calculateChanges(oldObj, newObj, ["password", "secret"]);
// Returns: { "name": { from: "Old Name", to: "New Name" },
//            "password": { from: "[REDACTED]", to: "[REDACTED]" } }
```

- Only includes fields that actually changed
- Sensitive fields are automatically masked (password, passwordHash, token, secret, apiKey)
- Comparison uses `JSON.stringify` for deep equality

---

## Database Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| `audit_logs_tenant_idx` | `tenant_id` | Most common query pattern |
| `audit_logs_actor_idx` | `actor_id` | "What did this user do?" |
| `audit_logs_action_idx` | `action` | "Show all login events" |
| `audit_logs_resource_idx` | `resource_type, resource_id` | "Show history for this agent" |
| `audit_logs_timestamp_idx` | `timestamp` | Date range queries |
| `audit_logs_tenant_time_idx` | `tenant_id, timestamp` | Tenant + date range (compound) |

---

## Design Decisions

1. **Non-fatal logging**: Audit writes never throw — errors are logged to stdout but don't break the request
2. **Nullable actor/tenant**: System events (scheduled health checks, automated deletes) have no actor; system-admin actions may have no tenant
3. **JSONB metadata**: Flexible schema accommodates different event types without schema changes
4. **No retention policy**: Audit logs are append-only. Consider implementing periodic cleanup for compliance requirements.

---

## Related Docs

- [14 — Security](./14-security.md) — Security model and access control
- User Docs: [15 — Audit Logs](../user_docs/15-audit-logs.md) — Admin UI guide
