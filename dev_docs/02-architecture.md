# Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         End Users / Websites                         │
└───────────┬─────────────────────────────┬───────────────────────────┘
            │ Embed Widget                │ Hosted Chat / API
            ▼                             ▼
┌─────────────────────┐     ┌─────────────────────────┐
│   Chat Widget        │     │   Admin Web UI           │
│   (Preact, Shadow    │     │   (React 19, Vite,       │
│    DOM, embeddable)  │     │    TanStack Query)       │
└─────────┬───────────┘     └───────────┬─────────────┘
          │                             │
          │  SSE / REST                 │  REST
          ▼                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API Server (Hono)                           │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │   Auth   │ │  Agents  │ │   Chat   │ │  Widget  │ │  Admin   │ │
│  │ Middleware│ │  Routes  │ │  Routes  │ │  Routes  │ │  Routes  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐   │
│  │  SimpleRAGService │  │ AdvancedRAGService│  │  Hybrid Search  │   │
│  │  (single-pass)    │  │ (multi-step)      │  │  (RRF fusion)   │   │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘   │
└────────┬────────────────────────┬───────────────────┬───────────────┘
         │                        │                   │
         ▼                        ▼                   ▼
┌─────────────────┐   ┌────────────────┐   ┌────────────────────────┐
│   PostgreSQL    │   │     Redis      │   │  PostgreSQL + pgvector │
│   (Main DB)     │   │  (Queues +     │   │  (Vector DB)           │
│   Port 5432     │   │   Cache)       │   │  Port 5433             │
│                 │   │   Port 6379    │   │                        │
└─────────────────┘   └───────┬────────┘   └────────────────────────┘
                              │
                   BullMQ Job Queues
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│   Scraper Worker         │   │   Ingestion Worker       │
│                          │   │                          │
│  • HTTP fetch            │   │  • Content extraction    │
│  • Playwright (headless) │   │  • Chunking              │
│  • Firecrawl API         │   │  • Embedding generation  │
│  • Link extraction       │   │  • Vector indexing       │
│  • Content validation    │   │  • Source run management  │
│  • Fairness scheduling   │   │  • KB reindexing         │
└──────────────────────────┘   └──────────────────────────┘
```

## Request Flow

### Chat Request (Simple RAG)

```
1. User sends message → POST /api/v1/chat (or /api/v1/widget/chat)
2. Auth middleware validates session/token/API key
3. SimpleRAGService.chat() starts:
   a. Load agent config (DB, cached in Redis 60s)
   b. Retrieve conversation history from Redis
   c. Generate embedding for user query
   d. Vector search (pgvector) → candidateK results
   e. Full-text search (PostgreSQL tsv) → candidateK results
   f. Reciprocal Rank Fusion merges results → topK chunks
   g. Build system prompt with context chunks
   h. Stream LLM response via Vercel AI SDK
   i. Emit SSE events: status → text chunks → sources → done
   j. Store conversation turn in Redis
   k. Log to chat_events for analytics
```

### Chat Request (Advanced RAG)

```
1-3. Same as Simple RAG
4. AdvancedRAGService.chat() starts:
   a. Load agent config
   b. REWRITE step: Rewrite query using conversation context
   c. PLAN step: Generate sub-queries (1-5) for comprehensive search
   d. SEARCH step: Execute parallel searches for each sub-query
      - Each sub-query: embed → vector search → FTS → RRF merge
   e. MERGE step: Deduplicate and rank all retrieved chunks
   f. GENERATE step: Stream final answer with full context
   g. Each step emits "reasoning" SSE events for UI visibility
```

### Knowledge Ingestion Pipeline

```
1. User creates Source → POST /api/v1/sources
2. User triggers run → POST /api/v1/sources/:id/run
3. API creates SourceRun record, enqueues SourceRunStart job

Pipeline stages (each is a BullMQ job):

┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ DISCOVER │ → │  FETCH   │ → │ EXTRACT  │ → │  CHUNK   │ → │  EMBED   │ → │  INDEX   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
  Sitemap/       HTTP/          Parse HTML     Split into     Generate        Store in
  domain crawl   Playwright/    extract main   overlapping    vector          pgvector
  URL list       Firecrawl      content        chunks         embeddings

Stage tracking: Each page has per-stage status records (sourceRunPageStages table)
Run tracking: sourceRuns.stage shows current pipeline stage with progress counters
```

## Authentication Architecture

The API supports multiple auth methods, checked in order:

1. **Bearer Token (JWT)** — For admin UI sessions. JWT contains user ID, issued by login endpoint.
2. **API Key** — `X-API-Key` header. Tenant-scoped keys with configurable scopes (`chat`, `read`).
3. **Widget Token** — For public widget chat. Token identifies agent + tenant.
4. **Chat Endpoint Token** — For published chat pages / API endpoints.
5. **Admin Token** — System-admin-only API tokens for programmatic access.
6. **OIDC** — Optional SSO integration via any OIDC-compliant identity provider.

```typescript
// Auth context available on every request:
interface AuthContext {
  user: AuthUser;           // { id, email, issuer, subject }
  tenantId: string | null;  // Current tenant (from X-Tenant-ID header)
  role: string | null;      // Tenant role: owner | admin | member | viewer
  isSystemAdmin: boolean;   // System-wide admin access
  apiKeyId: string | null;  // If authenticated via API key
}
```

### Tenant Roles

| Role | Permissions |
|------|------------|
| `owner` | Full control, can delete tenant, manage members |
| `admin` | Manage KBs, agents, sources. Cannot delete tenant. |
| `member` | Use chat, view KBs. Cannot modify configuration. |
| `viewer` | Read-only access to all resources |

### System Admin
- Has a separate `system_admins` table (not tied to tenants)
- Can manage all tenants, users, AI models, system settings
- Seeded on first startup from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars

## Infrastructure

### PostgreSQL (Main DB — Port 5432)
- Application data: tenants, users, agents, knowledge bases, sources, chunks, etc.
- Full-text search: `tsv` column on `kb_chunks` with GIN index
- Drizzle ORM for type-safe queries
- Migrations in `migrations/` directory

### PostgreSQL + pgvector (Vector DB — Port 5433)
- Stores embedding vectors for similarity search
- Separate from main DB for independent scaling
- Supports variable dimensions (different KBs can use different embedding models)
- Cosine distance search with metadata filtering (tenant_id, kb_id)

### Redis (Port 6379)
- **BullMQ Queues**: Job queue for all worker tasks
- **Conversation Store**: Chat conversation history (1hr TTL, 20 turn max)
- **Cache**: Agent config cache (60s TTL), embedding cache (5min TTL)
- **Fairness Scheduler**: Slot tracking for fair scraper resource allocation
- **Concurrency Tracking**: Per-tenant and per-domain crawl limits

## Code Organization Patterns

### API Modules Pattern
Routes in `apps/api/src/routes/` are organized by domain. Each route file:
1. Creates a Hono router
2. Applies auth middleware
3. Validates request with Zod
4. Calls service layer or DB directly
5. Returns typed JSON responses

### Service Layer
Complex business logic lives in `apps/api/src/services/`:
- `simple-rag.ts` — Single-pass RAG chat
- `advanced-rag.ts` — Multi-step reasoning RAG
- `hybrid-search.ts` — Vector + FTS with RRF fusion
- `cache.ts` — Redis caching helpers
- `test-runner.ts` — Test suite execution engine
- `audit.ts` — Audit log recording

### Worker Job Pattern
Workers in `apps/ingestion-worker/src/jobs/` and `apps/scraper-worker/src/jobs/`:
1. Receive job data from BullMQ
2. Process the job (DB queries, API calls, etc.)
3. Enqueue next stage jobs if successful
4. Update status tracking in DB
5. Handle errors with retry/backoff

### Frontend State Management
The web app uses a **state-based navigation pattern** (not React Router):
- `currentPage` state in `AppStateProvider` controls which page renders
- Pages registered in `page-registry.ts` with auth gates
- TanStack Query for server state / API data
- Context providers for auth, tenant, and app state
