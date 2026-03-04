# API Request & Response Examples

Detailed payload examples for the most commonly used API endpoints. For the full route map, see [04 — API Reference](./04-api-reference.md).

All requests use `Content-Type: application/json` unless noted. All responses return JSON.

---

## Authentication

### Register

```
POST /api/v1/auth/register
Rate limit: 10/hour
```

```json
// Request
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "Jane Doe"
}

// Response (201)
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com"
  },
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "token_type": "Bearer"
}
```

Password requirements: min 8 chars, at least one uppercase, one lowercase, one digit.

### Login

```
POST /api/v1/auth/login
Rate limit: 20/5min
```

```json
// Request
{ "email": "user@example.com", "password": "SecurePass123!" }

// Response (200)
{
  "user": {
    "id": "550e8400-...",
    "email": "user@example.com",
    "isSystemAdmin": false
  },
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "token_type": "Bearer"
}
```

### Get Current User

```
GET /api/v1/auth/me
Authorization: Bearer <token>
```

```json
// Response (200)
{
  "user": {
    "id": "550e8400-...",
    "email": "user@example.com",
    "isSystemAdmin": false,
    "createdAt": "2025-01-15T10:00:00Z"
  },
  "tenants": [
    {
      "tenantId": "660e8400-...",
      "tenantName": "Acme Corp",
      "tenantSlug": "acme",
      "role": "owner"
    }
  ]
}
```

---

## Knowledge Bases

### Create KB

```
POST /api/v1/knowledge-bases
Authorization: Bearer <token>
X-Tenant-ID: <tenant-uuid>
```

```json
// Request
{
  "name": "Product Documentation",
  "description": "All product docs and guides",
  "embeddingModelId": "770e8400-..."
}

// Response (201)
{
  "kb": {
    "id": "880e8400-...",
    "tenantId": "660e8400-...",
    "name": "Product Documentation",
    "description": "All product docs and guides",
    "embeddingModelId": "770e8400-...",
    "chunkCount": 0,
    "createdAt": "2025-01-15T10:00:00Z",
    "updatedAt": "2025-01-15T10:00:00Z",
    "deletedAt": null
  }
}
```

---

## Sources

### Create Web Source

```
POST /api/v1/sources
Authorization: Bearer <token>
X-Tenant-ID: <tenant-uuid>
```

```json
// Request — Single page
{
  "kbId": "880e8400-...",
  "name": "Homepage",
  "type": "web",
  "config": {
    "mode": "single",
    "url": "https://docs.example.com"
  }
}

// Request — Domain crawl
{
  "kbId": "880e8400-...",
  "name": "Full Docs Site",
  "type": "web",
  "config": {
    "mode": "domain",
    "url": "https://docs.example.com",
    "depth": 3,
    "includePatterns": ["/docs/*", "/guides/*"],
    "excludePatterns": ["/blog/*", "/changelog/*"],
    "includeSubdomains": false,
    "respectRobotsTxt": true
  }
}

// Request — Sitemap
{
  "kbId": "880e8400-...",
  "name": "Via Sitemap",
  "type": "web",
  "config": {
    "mode": "sitemap",
    "url": "https://docs.example.com/sitemap.xml"
  }
}

// Response (201)
{
  "source": {
    "id": "990e8400-...",
    "kbId": "880e8400-...",
    "tenantId": "660e8400-...",
    "name": "Full Docs Site",
    "type": "web",
    "config": { "mode": "domain", "url": "https://docs.example.com", ... },
    "enrichmentEnabled": false,
    "createdAt": "2025-01-15T10:00:00Z"
  }
}
```

### Source Config Fields

| Field | Type | Default | Modes | Description |
|-------|------|---------|-------|-------------|
| `mode` | enum | required | — | `single`, `list`, `sitemap`, `domain` |
| `url` | string | — | single, sitemap, domain | Primary URL |
| `urls` | string[] | — | list | Multiple URLs |
| `depth` | int(1–10) | 3 | domain | Max crawl depth |
| `includePatterns` | string[] | [] | domain | URL patterns to include (glob) |
| `excludePatterns` | string[] | [] | domain | URL patterns to exclude (glob) |
| `includeSubdomains` | boolean | false | domain | Follow links to subdomains |
| `respectRobotsTxt` | boolean | true | all | Obey robots.txt |
| `schedule` | null/daily/weekly | null | all | Auto-rerun schedule |

### Trigger Source Run

```
POST /api/v1/sources/:id/run
```

```json
// Request (optional)
{ "forceReindex": true }

// Response (200)
{ "run": { "id": "aa0e8400-...", "status": "pending", "createdAt": "..." } }
```

### Get Run Details

```
GET /api/v1/sources/:id/runs/:runId
```

```json
// Response (200)
{
  "run": {
    "id": "aa0e8400-...",
    "sourceId": "990e8400-...",
    "status": "completed",
    "stage": "completed",
    "totalPages": 42,
    "fetchedPages": 42,
    "processedPages": 42,
    "failedPages": 0,
    "startedAt": "2025-01-15T10:00:00Z",
    "completedAt": "2025-01-15T10:05:23Z"
  },
  "pages": [
    {
      "url": "https://docs.example.com/getting-started",
      "status": "completed",
      "stage": "indexed",
      "chunksCreated": 5,
      "fetchedAt": "2025-01-15T10:01:00Z"
    }
  ]
}
```

---

## Agents

### Create Agent

```
POST /api/v1/agents
```

```json
// Request
{
  "name": "Support Bot",
  "description": "Customer support assistant",
  "welcomeMessage": "Hi! How can I help you today?",
  "systemPrompt": "You are a customer support agent for Acme Corp. Answer questions using only the provided context. If you don't have the information, say so. Always cite your sources.",
  "ragType": "simple",
  "kbIds": ["880e8400-..."],
  "llmModelConfigId": "bb0e8400-..."
}

// Response (201)
{
  "agent": {
    "id": "cc0e8400-...",
    "tenantId": "660e8400-...",
    "name": "Support Bot",
    "ragType": "simple",
    "isEnabled": true,
    ...
  }
}
```

### Update Retrieval Config

```
PUT /api/v1/agents/:id/retrieval-config
```

```json
// Request
{
  "topK": 10,
  "candidateK": 60,
  "maxCitations": 5,
  "similarityThreshold": 0.45,
  "rerankerEnabled": true,
  "historyTurns": 8,
  "advancedMaxSubqueries": 4
}
```

| Field | Range | Default | Description |
|-------|-------|---------|-------------|
| `topK` | 1–50 | 8 | Chunks sent to LLM |
| `candidateK` | 1–200 | 40 | Chunks from vector search (pre-reranking) |
| `maxCitations` | 1–20 | 3 | Sources shown in UI |
| `similarityThreshold` | 0–1 | 0.5 | Minimum cosine similarity |
| `rerankerEnabled` | bool | true | Enable hybrid search reranking |
| `historyTurns` | 1–20 | 5 | Conversation turns for query rewriting (Advanced RAG) |
| `advancedMaxSubqueries` | 1–5 | 3 | Sub-queries for parallel retrieval (Advanced RAG) |

### Create Chat Endpoint Token

```
POST /api/v1/agents/:id/chat-endpoints
```

```json
// Request
{ "name": "Production API", "endpointType": "api" }

// Response (201)
{
  "token": {
    "id": "dd0e8400-...",
    "agentId": "cc0e8400-...",
    "name": "Production API",
    "endpointType": "api",
    "rawToken": "grnd_ep_abc123...",
    "createdAt": "..."
  }
}
```

**Important:** `rawToken` is only returned once at creation. Store it securely.

---

## Chat (Admin)

```
POST /api/v1/chat/simple/:agentId
Authorization: Bearer <token>
X-Tenant-ID: <tenant-uuid>
```

```json
// Request
{
  "message": "What is the return policy?",
  "conversationId": "ee0e8400-..."
}
```

Response is an SSE stream (see [19 — Chat Endpoints](./19-chat-endpoints-and-retrieval.md) for full SSE format).

---

## Test Suites

### Create Test Suite

```
POST /api/v1/test-suites
```

```json
// Request
{
  "name": "Product FAQ Quality",
  "description": "Tests for product FAQ accuracy",
  "scheduleType": "daily",
  "scheduleTime": "09:00",
  "alertOnRegression": true,
  "alertThresholdPercent": 10,
  "llmJudgeModelConfigId": "bb0e8400-..."
}
```

### Create Test Case

```
POST /api/v1/test-cases
```

```json
// Request
{
  "suiteId": "ff0e8400-...",
  "name": "Return policy deadline",
  "question": "What is the return policy deadline?",
  "expectedBehavior": {
    "mode": "all",
    "checks": [
      {
        "type": "contains_phrases",
        "phrases": ["30 days", "full refund"],
        "caseSensitive": false
      },
      {
        "type": "semantic_similarity",
        "expectedAnswer": "Items can be returned within 30 days for a full refund.",
        "threshold": 0.75
      }
    ]
  }
}
```

### Start A/B Experiment

```
POST /api/v1/test-suites/:id/experiments
```

```json
// Request
{
  "candidatePrompt": "You are a customer support agent. Always answer in 2-3 concise sentences. Cite sources with [1] notation."
}

// Response (201)
{
  "experimentId": "110e8400-...",
  "baselineRunId": "220e8400-...",
  "status": "started"
}
```

---

## File Uploads

```
POST /api/v1/uploads
Content-Type: multipart/form-data
```

```
kbId=880e8400-...
file=@document.pdf
```

```json
// Response (201)
{
  "source": {
    "id": "330e8400-...",
    "name": "document.pdf",
    "type": "upload",
    "config": { "mode": "single", "url": "upload://330e8400.../document.pdf" }
  }
}
```

Supported formats: PDF, DOCX, XLSX, CSV, TXT, HTML, PPTX, MD, EPUB, RTF. Max 15MB.

---

## Admin — System Settings

```
GET /api/v1/admin/settings
```

```json
// Response (200)
{
  "settings": {
    "auth.local_registration_enabled": true,
    "auth.oidc_enabled": false,
    "quotas.default_max_kbs": 10,
    "quotas.default_max_agents": 5,
    "email.smtp_enabled": false,
    "workers.scraper_concurrency": 5,
    "workers.fairness_enabled": true,
    ...
  }
}
```

```
PUT /api/v1/admin/settings
```

```json
// Request
{
  "key": "quotas.default_max_kbs",
  "value": 20
}
```

---

## Error Responses

All errors follow the same format:

```json
// 400 Bad Request
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid email address",
  "details": { "field": "email" }
}

// 401 Unauthorized
{
  "error": "UNAUTHORIZED",
  "message": "Invalid email or password"
}

// 404 Not Found
{
  "error": "NOT_FOUND",
  "message": "Agent not found"
}

// 429 Rate Limited
{
  "error": "RATE_LIMITED",
  "message": "Too many requests",
  "retryAfter": 45
}
```

---

## Related Docs

- [04 — API Reference](./04-api-reference.md) — Full route map (all endpoints listed)
- [19 — Chat Endpoints](./19-chat-endpoints-and-retrieval.md) — SSE streaming format, token types
- [14 — Security](./14-security.md) — Authentication methods, role requirements
