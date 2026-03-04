# Chat Endpoints & Retrieval Pipeline

Grounded exposes chat through four distinct routes, each serving a different access channel with different authentication, rate limiting, and security models. This document covers all chat channels and the full retrieval pipeline.

## Chat Routes Overview

| Route File | Mount Point | Auth | Purpose |
|-----------|------------|------|---------|
| `chat.ts` | `/api/v1/chat/simple/:agentId` | Bearer + Tenant | Admin UI chat |
| `chat-endpoint.ts` | `/api/v1/c/:token/chat` | Public token (hashed) | API + hosted chat |
| `chat-endpoint.ts` | `/api/v1/c/:token` | Public token | Hosted chat HTML page |
| `widget.ts` | `/api/v1/widget/:token/config` | Widget token | Widget config endpoint |
| `hosted-chat.ts` | `/api/v1/hosted-chat` | — | Static HTML shell |

### 1. Admin UI Chat (`chat.ts` — 72 lines)

The simplest route. Used by logged-in users in the admin interface.

- **Auth:** Bearer JWT + tenant context
- **Rate limit:** 60 requests/min per user (via `rateLimit` middleware)
- **Flow:** Determines RAG type (simple/advanced) → creates service → streams SSE events
- **Channel tag:** `admin_ui` (logged in chat_events)

### 2. Chat Endpoint (`chat-endpoint.ts` — 568 lines)

The main public-facing chat route. Handles both API integrations and hosted chat pages.

**Token system:**
- Each agent can have `chatEndpointTokens` — each with an `endpointType` of `"api"` or `"hosted"`
- Raw tokens are hashed via `hashPublicToken()` (SHA-256) and stored as `tokenHash`
- Lookup: `hashPublicToken(rawToken)` → query by `tokenHash`

**Rate limiting (3-tier):**
```
Per-tenant:  quotas.chatRateLimitPerMinute (default: 60/min)
Per-token:   max(20, tenantLimit / 2) per minute
Per-IP:      max(30, tenantLimit) per minute
```
All three are checked in parallel. First block wins.

**Public access policy:**
- `enforcePublicAccessPolicy()` checks: is the endpoint public? Is the requesting domain allowed? Is OIDC required?
- `allowedDomains` — restricts which origins can use the endpoint
- `oidcRequired` — requires authentication for public chat

**Endpoints within chat-endpoint.ts:**
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/:token/config` | Return agent name, welcome message, RAG type |
| `GET` | `/:token` | Render hosted chat HTML page (for `hosted` type tokens) |
| `POST` | `/:token/chat` | Chat message → SSE stream |

**Hosted page security headers:**
- CSP with nonce-based script execution
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
- Inline config is XSS-sanitized via `serializeInlineConfig()`

### 3. Widget (`widget.ts` — 69 lines)

Widget token validation and config endpoint. The actual chat messages go through the widget's own SSE connection which uses the same streaming infrastructure.

### 4. Hosted Chat Shell (`hosted-chat.ts` — 44 lines)

Serves a minimal HTML page that loads the Preact chat widget bundle. Used as the full-page hosted chat experience.

---

## Retrieval Pipeline (Simple RAG)

**File:** `apps/api/src/services/simple-rag.ts` (441 lines)

```
User message
    │
    ├── 1. Load agent config (Redis cache, 60s TTL)
    │   └── Parallel queries: agent, retrievalConfig, agentKbs
    │
    ├── 2. Get/create conversation ID
    ├── 3. Load conversation history from Redis
    ├── 4. Store user message in Redis conversation
    │
    ├── 5. searchKnowledge(query)
    │   ├── a. Generate query embedding (Redis cache, 5min TTL)
    │   ├── b. Vector search (pgvector, candidateK results, min similarityThreshold)
    │   ├── c. Hybrid search: FTS + RRF merge
    │   └── d. Take topK results → fetch chunk details from DB
    │
    ├── 6. Build system prompt with context
    │   └── Appends CONTEXT section: [1] Title\nContent, [2] ...
    │
    ├── 7. Build messages array (history + current message)
    ├── 8. Get LLM model from AI registry
    ├── 9. Stream response via Vercel AI SDK streamText()
    │
    ├── 10. Log usage → chat_events table
    ├── 11. Store assistant response in Redis conversation
    └── 12. Yield sources + done event
```

### Key Configuration (AgentConfig)

| Field | Default | Purpose |
|-------|---------|---------|
| `candidateK` | 40 | Chunks retrieved from vector search (broad pool) |
| `topK` | 8 | Chunks after RRF reranking (sent to LLM) |
| `maxCitations` | 3 | Sources shown in UI |
| `similarityThreshold` | 0.5 | Minimum vector similarity score |
| `rerankerEnabled` | true | Whether reranking is active |

### Caching Strategy

| What | Domain | TTL | Cache Key |
|------|--------|-----|-----------|
| Agent config | `agent_config` | 60s | `{tenantId}:{agentId}` |
| Query embedding | `embed` | 300s | `sha256(modelId + "::" + text)` |
| Widget token | `widget` | 120s | `{tokenHash}` |

---

## Hybrid Search

**File:** `apps/api/src/services/hybrid-search.ts` (208 lines)

### Two Search Paths

1. **Vector search** (pgvector) — cosine distance on embedding vectors, run by the RAG service before calling hybrid search
2. **Full-text search** (PostgreSQL tsvector) — `plainto_tsquery('english', query)` ranked by `ts_rank_cd` (cover density)

### FTS Query

```sql
SELECT id, ts_rank_cd(tsv, plainto_tsquery('english', $query)) AS rank
FROM kb_chunks
WHERE (tenant_id = $tenantId OR tenant_id IS NULL)
  AND kb_id = ANY($kbIds)
  AND deleted_at IS NULL
  AND tsv IS NOT NULL
  AND tsv @@ plainto_tsquery('english', $query)
ORDER BY rank DESC
LIMIT $topK
```

The `tsv` column is a pre-computed `tsvector` on each chunk, populated during ingestion.

### Reciprocal Rank Fusion (RRF)

Merges two ranked lists into a single ranking:

```
For each document d appearing in either list:

  RRF_score(d) = Σ  weight_i / (k + rank_i(d))

where:
  k = 60          (smoothing constant, from Cormack et al. 2009)
  rank_i = 1-based position in list i
  weight_vector = 0.5 (default, configurable)
  weight_fts = 1 - weight_vector = 0.5
```

**Why RRF?**
- Handles incomparable score scales (cosine similarity vs ts_rank_cd)
- Only uses rank positions, not raw scores
- k=60 is the industry standard — dampens the impact of being #1 vs #2
- Simple, deterministic, no training required

**Example:**

| Document | Vector Rank | FTS Rank | RRF Score |
|----------|------------|----------|-----------|
| Doc A | 1 | 3 | 0.5/(60+1) + 0.5/(60+3) = 0.00820 + 0.00794 = **0.01614** |
| Doc B | 5 | 1 | 0.5/(60+5) + 0.5/(60+1) = 0.00769 + 0.00820 = **0.01589** |
| Doc C | 2 | — | 0.5/(60+2) + 0 = **0.00806** |
| Doc D | — | 2 | 0 + 0.5/(60+2) = **0.00806** |

Doc A wins despite not being #1 in either list — it's consistently relevant across both signals.

### Fallback Behavior

- If FTS returns nothing (e.g., query has no indexable terms), vector results pass through unchanged
- If FTS fails (query error), warning is logged and vector-only results are returned

---

## Advanced RAG

**File:** `apps/api/src/services/advanced-rag.ts` (854 lines)

Multi-step pipeline with visible reasoning:

```
1. REWRITE  — Rewrite query using conversation history context
2. PLAN     — Break into sub-queries (up to advancedMaxSubqueries)
3. SEARCH   — Parallel retrieval for each sub-query
4. MERGE    — Deduplicate and re-rank combined results
5. GENERATE — Stream final response with all context
```

Each step emits a `reasoning` SSE event with: step type, title, summary, status (pending/active/complete).

### Additional SSE Event: `reasoning`

```typescript
{
  type: "reasoning",
  step: {
    type: "rewrite" | "plan" | "search" | "merge" | "generate",
    title: "Rewriting Query...",
    summary: "Expanded query to include...",
    status: "active" | "complete"
  }
}
```

---

## SSE Stream Format

All chat endpoints use `streamWithHeartbeat()` which:
1. Sends SSE events as `data: {json}\n\n`
2. Sends periodic heartbeat comments (`: heartbeat\n\n`) to keep connections alive
3. Detects client disconnection via `controller.isAborted()`

### Event Types

| Event | Fields | Emitted By |
|-------|--------|-----------|
| `status` | `status`, `message`, `sourceCount?` | Both |
| `text` | `content` | Both |
| `sources` | `sources[]` (id, title, url, snippet, index) | Both |
| `reasoning` | `step` (type, title, summary, status) | Advanced only |
| `done` | `conversationId` | Both |
| `error` | `message` | Both |

---

## Conversation History

Stored in Redis (not the database):

```
Key: conversation:{tenantId}:{agentId}:{conversationId}
Value: Array of { role, content, timestamp }
TTL: managed by @grounded/queue conversation helpers
```

Functions: `getConversation()`, `addToConversation()` from `@grounded/queue`.

---

## File Map

| File | Lines | Purpose |
|------|-------|---------|
| `apps/api/src/routes/chat.ts` | 72 | Admin UI chat route |
| `apps/api/src/routes/chat-endpoint.ts` | 568 | Public chat (API + hosted) |
| `apps/api/src/routes/hosted-chat.ts` | 44 | HTML shell for hosted chat |
| `apps/api/src/routes/widget.ts` | 69 | Widget config + chat |
| `apps/api/src/services/simple-rag.ts` | 441 | Simple RAG pipeline |
| `apps/api/src/services/advanced-rag.ts` | 854 | Advanced RAG pipeline |
| `apps/api/src/services/hybrid-search.ts` | 208 | FTS + RRF hybrid search |
| `apps/api/src/services/cache.ts` | 191 | Redis caching layer |
| `apps/api/src/services/sse-stream.ts` | — | SSE streaming with heartbeat |
| `apps/api/src/services/public-access-policy.ts` | — | Domain/OIDC access control |
| `apps/api/src/services/public-token-security.ts` | — | Token hashing/validation |
| `apps/api/src/modules/chat/service.ts` | — | RAG type resolution |
| `apps/api/src/modules/chat/schema.ts` | — | Chat request validation |
| `apps/api/src/modules/chat-endpoint/schema.ts` | — | Public chat validation |

---

## Related Docs

- [06 — RAG & Chat](./06-rag-and-chat.md) — Higher-level overview of RAG modes
- [14 — Security](./14-security.md) — Token types, rate limiting, public access
- [16 — Tools & Agentic Mode](./16-tools-and-agentic-mode.md) — Future tool calling in chat
