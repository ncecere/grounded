# API Reference

The API server runs on Hono at `http://localhost:3001`. All routes are prefixed with `/api/v1`.

## Authentication

All requests (except public widget/chat endpoints) require authentication:

```
Authorization: Bearer <jwt_token>     # Admin UI sessions
X-API-Key: <api_key>                  # Tenant API keys
X-Tenant-ID: <tenant_uuid>           # Required for tenant-scoped operations
```

## Route Map

### Auth (`/api/v1/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login with email/password, returns JWT |
| POST | `/auth/logout` | Invalidate session |
| GET | `/auth/me` | Get current user info + tenants |
| GET | `/auth/oidc/login` | Initiate OIDC flow |
| GET | `/auth/oidc/callback` | OIDC callback handler |

### Tenants (`/api/v1/tenants`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/tenants` | List user's tenants |
| POST | `/tenants` | Create new tenant |
| GET | `/tenants/:id` | Get tenant details |
| PATCH | `/tenants/:id` | Update tenant |
| DELETE | `/tenants/:id` | Soft delete tenant |
| GET | `/tenants/:id/members` | List members |
| POST | `/tenants/:id/members` | Invite member |
| PATCH | `/tenants/:id/members/:userId` | Change member role |
| DELETE | `/tenants/:id/members/:userId` | Remove member |
| GET | `/tenants/:id/api-keys` | List API keys |
| POST | `/tenants/:id/api-keys` | Create API key |
| DELETE | `/tenants/:id/api-keys/:keyId` | Revoke API key |
| GET | `/tenants/:id/quotas` | Get quotas |
| GET | `/tenants/:id/usage` | Get monthly usage |
| GET | `/tenants/:id/alert-settings` | Get alert settings |
| PUT | `/tenants/:id/alert-settings` | Update alert settings |

### Knowledge Bases (`/api/v1/knowledge-bases`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/knowledge-bases` | List KBs for current tenant |
| POST | `/knowledge-bases` | Create KB |
| GET | `/knowledge-bases/:id` | Get KB details |
| PATCH | `/knowledge-bases/:id` | Update KB |
| DELETE | `/knowledge-bases/:id` | Soft delete KB |
| POST | `/knowledge-bases/:id/reindex` | Trigger re-embedding with new model |

### Sources (`/api/v1/sources`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/sources?kbId=<id>` | List sources for a KB |
| POST | `/sources` | Create source (web or upload) |
| GET | `/sources/:id` | Get source details |
| PATCH | `/sources/:id` | Update source config |
| DELETE | `/sources/:id` | Soft delete source |
| POST | `/sources/:id/run` | Trigger ingestion run |
| GET | `/sources/:id/runs` | List run history |
| GET | `/sources/:id/runs/:runId` | Get run details with page results |
| POST | `/sources/:id/runs/:runId/cancel` | Cancel running ingestion |

### Agents (`/api/v1/agents`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/agents` | List agents for current tenant |
| POST | `/agents` | Create agent |
| GET | `/agents/:id` | Get agent with KB attachments, retrieval config |
| PATCH | `/agents/:id` | Update agent (prompt, model, RAG type, etc.) |
| DELETE | `/agents/:id` | Soft delete agent |
| PUT | `/agents/:id/kbs` | Set attached knowledge bases |
| GET | `/agents/:id/widget-config` | Get widget configuration |
| PUT | `/agents/:id/widget-config` | Update widget configuration |
| GET | `/agents/:id/widget-tokens` | List widget tokens |
| POST | `/agents/:id/widget-tokens` | Create widget token |
| DELETE | `/agents/:id/widget-tokens/:tokenId` | Revoke widget token |
| GET | `/agents/:id/chat-endpoints` | List chat endpoint tokens |
| POST | `/agents/:id/chat-endpoints` | Create chat endpoint token |
| DELETE | `/agents/:id/chat-endpoints/:tokenId` | Revoke endpoint token |

### Chat (`/api/v1/chat`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Send chat message (SSE streaming response) |

**Request Body:**
```json
{
  "agentId": "uuid",
  "message": "What is...",
  "conversationId": "uuid (optional, for follow-up)"
}
```

**SSE Event Types:**
```
event: status    → { status: "generating", message: "Found 5 sources...", sourceCount: 5 }
event: text      → { content: "chunk of response text" }
event: reasoning → { id, type, title, summary, status, details }  (advanced RAG only)
event: sources   → { sources: [{ id, title, url, snippet, index }] }
event: done      → { conversationId: "uuid" }
event: error     → { message: "error description" }
```

### Widget (Public) (`/api/v1/widget`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/widget/config?token=<token>` | Get widget config (theme, agent name) |
| POST | `/widget/chat` | Send chat message (public, token-authenticated) |

### Chat Endpoints (Public) (`/api/v1/c`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/c/config?token=<token>` | Get config for hosted chat / API endpoint |
| POST | `/c/chat` | Send chat message via endpoint token |

### Hosted Chat (`/chat/:token`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/:token` | Serve full-page hosted chat HTML |

### Uploads (`/api/v1/uploads`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/uploads` | Upload document file (multipart/form-data) |

### Analytics (`/api/v1/analytics`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/analytics/chat-events` | Query chat event analytics |
| GET | `/analytics/usage` | Get usage statistics |

### Test Suites (`/api/v1/test-suites`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/test-suites` | List test suites |
| POST | `/test-suites` | Create test suite |
| GET | `/test-suites/:id` | Get test suite details |
| PATCH | `/test-suites/:id` | Update test suite |
| DELETE | `/test-suites/:id` | Delete test suite |
| POST | `/test-suites/:id/run` | Trigger test run |
| GET | `/test-runs` | List test runs |
| GET | `/test-runs/:id` | Get run results |
| GET | `/test-cases` | List test cases |
| POST | `/test-cases` | Create test case |
| PATCH | `/test-cases/:id` | Update test case |
| DELETE | `/test-cases/:id` | Delete test case |

### Tools (`/api/v1/tools`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/tools` | List tool definitions |
| POST | `/tools` | Create tool |
| PATCH | `/tools/:id` | Update tool |
| DELETE | `/tools/:id` | Delete tool |

### Admin Routes (`/api/v1/admin/*`)
*Requires system admin authentication.*

| Route Group | Description |
|-------------|-------------|
| `/admin/dashboard` | System health, stats, active tenants |
| `/admin/settings` | System settings (CRUD on `systemSettings`) |
| `/admin/models` | AI provider and model management |
| `/admin/users` | User management across all tenants |
| `/admin/shared-kbs` | Global knowledge base management |
| `/admin/analytics` | System-wide analytics |
| `/admin/tokens` | Admin API token management |
| `/admin/audit` | Audit log queries |

### Internal (`/api/v1/internal/workers`)
*For worker-to-API communication. Secured by `INTERNAL_API_KEY` in production.*

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/workers/settings` | Workers fetch runtime configuration |

## Error Response Format

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

Common error codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`.

## Request Size Limits

| Context | Default Limit |
|---------|--------------|
| JSON body | 64 KB |
| Public chat body | 64 KB |
| File upload | 15 MB |
