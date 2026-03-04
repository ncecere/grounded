# Security Model

## Multi-Tenancy Isolation

### Row-Level Security (RLS)
- All tenant data includes a `tenant_id` column
- Queries are scoped via RLS context set from the auth middleware
- The API uses `withRequestRLS()` helper to execute queries in a tenant-scoped transaction
- System admins can access all tenants

### RLS Context
```typescript
interface RLSContext {
  tenantId: string | null;
  userId: string;
  isSystemAdmin: boolean;
}
```

Set on every authenticated request and stored in the Hono context for use in route handlers.

## Authentication Methods

### 1. Local JWT (Primary)
- Login via `POST /api/v1/auth/login` with email + password
- Password hashed with bcrypt (stored in `userCredentials`)
- JWT issued with user ID, signed with `SESSION_SECRET`
- Issuer: `grounded-local`, Audience: `grounded-api`
- Client sends: `Authorization: Bearer <jwt>`

### 2. OIDC / SSO (Optional)
- Configured via `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
- JWKS validation of external tokens
- Auto-creates user on first OIDC login (`findOrCreateUser`)
- Falls back from OIDC to local JWT if OIDC validation fails

### 3. Tenant API Keys
- Created per-tenant via the Admin UI
- Format: `grounded_<random>` (prefix identifies it as an API key)
- Stored as hash in `apiKeys.keyHash` (SHA-256)
- Key prefix (`keyPrefix`) stored for identification without revealing the key
- Scoped: `chat`, `read` (configurable at creation)
- Optional expiration via `expiresAt`

### 4. Widget Tokens
- Public tokens for embedding the chat widget
- Format: `grounded_<random>` (widget-specific generation)
- Stored as hash in `widgetTokens.tokenHash`
- Identifies agent + tenant (no user session needed)
- Domain restriction via `allowedDomains` in widget config

### 5. Chat Endpoint Tokens
- Similar to widget tokens but for API/hosted chat
- Types: `api` (programmatic access) or `hosted` (full-page chat)
- Stored as hash in `chatEndpointTokens.tokenHash`

### 6. Admin API Tokens
- System-level tokens for programmatic admin access
- Format: `grounded_admin_<random>`
- Created by system admins only
- Stored as hash in `adminApiTokens.tokenHash`
- Optional expiration, revocation tracking

## Secret Storage

| Secret | Storage | Notes |
|--------|---------|-------|
| User passwords | `userCredentials.passwordHash` | bcrypt hashed |
| API keys | `apiKeys.keyHash` | SHA-256 hashed, prefix stored separately |
| Widget tokens | `widgetTokens.tokenHash` | SHA-256 hashed |
| Chat endpoint tokens | `chatEndpointTokens.tokenHash` | SHA-256 hashed |
| Admin tokens | `adminApiTokens.tokenHash` | SHA-256 hashed |
| AI provider API keys | `modelProviders.apiKey` | Stored as-is (encrypt at rest in prod) |
| System settings secrets | `systemSettings.value` | `isSecret` flag, masked in API responses |

## Request Security

### Headers
- `X-Request-ID` — Generated per request for tracing
- `Secure-Headers` — HSTS, X-Frame-Options, X-Content-Type-Options, etc.
- `CORS` — Strict origin validation (`CORS_ORIGINS` must be explicit in production)

### Body Size Limits
- JSON: 64 KB (`MAX_JSON_BODY_BYTES`)
- Public chat: 64 KB (`MAX_PUBLIC_CHAT_BODY_BYTES`)
- File uploads: 15 MB (`MAX_UPLOAD_BODY_BYTES`)

### Rate Limiting
- Redis-backed sliding window
- Per-tenant for authenticated requests
- Per-IP fallback for unauthenticated
- Configurable via `tenantQuotas.chatRateLimitPerMinute`

## Worker Security

### Internal API Communication
- Workers fetch settings from `GET /api/v1/internal/workers/settings`
- In production: `INTERNAL_API_KEY` env var required
- Workers include it as `Authorization: Bearer <key>`
- In development: Endpoint is open if no key configured

### Job Data
- Job payloads contain tenant IDs and content references (not raw content for most jobs)
- `page-process` jobs include raw HTML (transient, removed after processing)
- Redis queue data is not encrypted at rest

## Audit Trail

All security-relevant actions are logged to `auditLogs`:
- Authentication events (login, logout, failed attempts)
- CRUD operations on all resources
- Settings changes
- Token creation/revocation
- Role changes

Each audit entry includes `actorId`, `tenantId`, `ipAddress`, and `metadata` with change details.

## Domain Restrictions

Widget configurations support `allowedDomains`:
- When set, widget chat requests are validated against the `Origin` / `Referer` header
- Empty array = allow all domains
- Useful for preventing unauthorized embedding of the chat widget

## OIDC Widget Authentication

Widgets can optionally require OIDC authentication:
- `oidcRequired: true` on `agentWidgetConfigs`
- Widget prompts user to authenticate before chatting
- Verifies bearer token against configured OIDC provider
- Prevents anonymous chat access

## Production Security Checklist

- [ ] Set `CORS_ORIGINS` to specific domains (not `*`)
- [ ] Set `INTERNAL_API_KEY` for worker communication
- [ ] Use strong `SESSION_SECRET` (32+ chars, random)
- [ ] Enable TLS everywhere (ingress, database connections)
- [ ] Encrypt database at rest
- [ ] Rotate AI provider API keys periodically
- [ ] Monitor audit logs for suspicious activity
- [ ] Set appropriate rate limits per tenant
- [ ] Configure `allowedDomains` on widget configs
- [ ] Review and minimize API key scopes
- [ ] Set token expiration dates
