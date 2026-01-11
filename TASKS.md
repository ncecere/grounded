# Engineering Tasks

## Multi-Tenant AI Knowledge & Conversational Platform

This document outlines the engineering tasks required to build the platform described in `PRD.md`.

---

## Milestone 0: Project Foundation

### Epic 0.1: Repository & Project Setup

- [ ] **T0.1.1** Initialize monorepo structure (pnpm workspaces or Turborepo)
- [ ] **T0.1.2** Configure TypeScript with strict mode
- [ ] **T0.1.3** Set up ESLint + Prettier
- [ ] **T0.1.4** Configure Jest/Vitest for testing
- [ ] **T0.1.5** Set up Docker Compose for local development
- [ ] **T0.1.6** Create `.env.example` with all configuration variables
- [ ] **T0.1.7** Set up CI/CD pipeline (GitHub Actions)

### Epic 0.2: Package Structure

```
/
├── apps/
│   ├── api/                 # API Service (Express/Fastify)
│   ├── ingestion-worker/    # Ingestion Worker Service
│   ├── scraper-worker/      # Scraper Worker Service
│   └── web/                 # Admin UI (React)
├── packages/
│   ├── db/                  # Database client, migrations, RLS
│   ├── queue/               # Redis queue abstraction (BullMQ)
│   ├── shared/              # Shared types, utils, constants
│   ├── embeddings/          # Embedding service client
│   ├── llm/                 # LLM provider abstraction
│   └── widget/              # Widget SDK source
├── docker/
│   ├── docker-compose.yml
│   ├── Dockerfile.api
│   ├── Dockerfile.worker
│   └── Dockerfile.scraper
└── migrations/              # SQL migrations
```

- [ ] **T0.2.1** Create `apps/api` package with Express/Fastify skeleton
- [ ] **T0.2.2** Create `apps/ingestion-worker` package skeleton
- [ ] **T0.2.3** Create `apps/scraper-worker` package skeleton
- [ ] **T0.2.4** Create `apps/web` package (React + Vite)
- [ ] **T0.2.5** Create `packages/db` with Drizzle ORM or Prisma
- [ ] **T0.2.6** Create `packages/queue` with BullMQ wrapper
- [ ] **T0.2.7** Create `packages/shared` for types and utilities
- [ ] **T0.2.8** Create `packages/embeddings` for embedding API client
- [ ] **T0.2.9** Create `packages/llm` for OpenAI-compatible LLM client
- [ ] **T0.2.10** Create `packages/widget` for embeddable widget source

---

## Milestone 1: Database & Core Infrastructure

### Epic 1.1: Database Schema

- [ ] **T1.1.1** Write migration: `tenants` table
- [ ] **T1.1.2** Write migration: `users` table
- [ ] **T1.1.3** Write migration: `user_identities` table (OIDC mapping)
- [ ] **T1.1.4** Write migration: `tenant_memberships` table with roles enum
- [ ] **T1.1.5** Write migration: `knowledge_bases` table (tenant + global)
- [ ] **T1.1.6** Write migration: `tenant_kb_subscriptions` table
- [ ] **T1.1.7** Write migration: `sources` table with JSONB config
- [ ] **T1.1.8** Write migration: `source_runs` table with status enum
- [ ] **T1.1.9** Write migration: `source_run_pages` table
- [ ] **T1.1.10** Write migration: `kb_chunks` table with tsvector column
- [ ] **T1.1.11** Write migration: Enable pgvector extension
- [ ] **T1.1.12** Write migration: `embeddings` table with vector column
- [ ] **T1.1.13** Write migration: `agents` table
- [ ] **T1.1.14** Write migration: `agent_kbs` junction table
- [ ] **T1.1.15** Write migration: `agent_widget_configs` table
- [ ] **T1.1.16** Write migration: `retrieval_configs` table
- [ ] **T1.1.17** Write migration: `chat_events` table (metadata only)
- [ ] **T1.1.18** Write migration: `deletion_jobs` table
- [ ] **T1.1.19** Create all required indexes (see PRD schema section)
- [ ] **T1.1.20** Create GIN index on `kb_chunks.tsv`
- [ ] **T1.1.21** Create HNSW/IVFFlat index on `embeddings.embedding`

### Epic 1.2: Row-Level Security (RLS)

- [ ] **T1.2.1** Enable RLS on all tenant-owned tables
- [ ] **T1.2.2** Create RLS policy for `tenant_id = current_setting('app.tenant_id')::uuid`
- [ ] **T1.2.3** Create System Admin bypass policy
- [ ] **T1.2.4** Create security definer views for global KB access
- [ ] **T1.2.5** Write integration tests for RLS enforcement
- [ ] **T1.2.6** Test cross-tenant data isolation

### Epic 1.3: Redis & Queue Infrastructure

- [ ] **T1.3.1** Configure Redis connection in `packages/queue`
- [ ] **T1.3.2** Implement BullMQ queue definitions for all job types
- [ ] **T1.3.3** Implement job type: `SOURCE_RUN_START`
- [ ] **T1.3.4** Implement job type: `SOURCE_DISCOVER_URLS`
- [ ] **T1.3.5** Implement job type: `PAGE_FETCH`
- [ ] **T1.3.6** Implement job type: `PAGE_PROCESS`
- [ ] **T1.3.7** Implement job type: `EMBED_CHUNKS_BATCH`
- [ ] **T1.3.8** Implement job type: `ENRICH_PAGE` (optional enrichment)
- [ ] **T1.3.9** Implement job type: `SOURCE_RUN_FINALIZE`
- [ ] **T1.3.10** Implement job type: `HARD_DELETE_OBJECT`
- [ ] **T1.3.11** Configure retry policy (3 retries, exponential backoff)
- [ ] **T1.3.12** Implement per-tenant concurrency limiter (max 5)
- [ ] **T1.3.13** Implement global worker concurrency config

---

## Milestone 2: Authentication & Authorization

### Epic 2.1: OIDC Authentication

- [ ] **T2.1.1** Implement OIDC client configuration (issuer, client_id, secret)
- [ ] **T2.1.2** Implement `GET /v1/auth/oidc/login` (redirect to provider)
- [ ] **T2.1.3** Implement `GET /v1/auth/oidc/callback` (handle code exchange)
- [ ] **T2.1.4** Implement user creation/linking from OIDC claims
- [ ] **T2.1.5** Map `issuer + subject` as primary identity key
- [ ] **T2.1.6** Implement session management (JWT or secure cookies)
- [ ] **T2.1.7** Implement `GET /v1/me` endpoint
- [ ] **T2.1.8** Implement `GET /v1/tenants` (list user's tenants)
- [ ] **T2.1.9** Implement tenant context switching

### Epic 2.2: API Key Management

- [ ] **T2.2.1** Create `api_keys` table (tenant_id, hashed_key, scopes, created_by)
- [ ] **T2.2.2** Implement API key generation endpoint
- [ ] **T2.2.3** Implement API key revocation endpoint
- [ ] **T2.2.4** Implement API key rotation
- [ ] **T2.2.5** Implement API key authentication middleware
- [ ] **T2.2.6** Support both OIDC bearer and API key auth on endpoints

### Epic 2.3: RBAC Enforcement

- [ ] **T2.3.1** Define role hierarchy: Owner > Admin > Member > Viewer
- [ ] **T2.3.2** Implement permission middleware
- [ ] **T2.3.3** Enforce Owner/Admin for KB create/modify
- [ ] **T2.3.4** Enforce Owner/Admin for source create/modify
- [ ] **T2.3.5** Enforce Owner/Admin for agent create/modify
- [ ] **T2.3.6** Enforce Owner/Admin for widget config
- [ ] **T2.3.7** Implement System Admin role check
- [ ] **T2.3.8** Write authorization integration tests

---

## Milestone 3: Tenant & Membership Management

### Epic 3.1: Tenant CRUD

- [ ] **T3.1.1** Implement tenant creation (by System Admin or self-service)
- [ ] **T3.1.2** Implement `GET /v1/tenants/:tenantId`
- [ ] **T3.1.3** Implement `PATCH /v1/tenants/:tenantId` (name, settings)
- [ ] **T3.1.4** Implement tenant soft delete
- [ ] **T3.1.5** Implement tenant hard delete job

### Epic 3.2: Membership Management

- [ ] **T3.2.1** Implement `GET /v1/tenants/:tenantId/members`
- [ ] **T3.2.2** Implement `POST /v1/tenants/:tenantId/members` (invite/add)
- [ ] **T3.2.3** Implement `PATCH /v1/tenants/:tenantId/members/:userId` (role change)
- [ ] **T3.2.4** Implement `DELETE /v1/tenants/:tenantId/members/:userId`
- [ ] **T3.2.5** Validate at least one Owner exists before role changes

---

## Milestone 4: Knowledge Base Management

### Epic 4.1: Knowledge Base CRUD

- [ ] **T4.1.1** Implement `GET /v1/kbs` (tenant KBs + subscribed globals)
- [ ] **T4.1.2** Implement `POST /v1/kbs` (create KB)
- [ ] **T4.1.3** Implement `GET /v1/kbs/:kbId`
- [ ] **T4.1.4** Implement `PATCH /v1/kbs/:kbId`
- [ ] **T4.1.5** Implement `DELETE /v1/kbs/:kbId` (soft delete)
- [ ] **T4.1.6** Enforce per-tenant KB quota (default: 10)

### Epic 4.2: Global Knowledge Bases

- [ ] **T4.2.1** Implement `GET /v1/global-kbs` (list published)
- [ ] **T4.2.2** Implement `POST /v1/global-kbs` (System Admin only)
- [ ] **T4.2.3** Implement `POST /v1/global-kbs/:kbId/publish`
- [ ] **T4.2.4** Implement `POST /v1/global-kbs/:kbId/unpublish`
- [ ] **T4.2.5** Implement `POST /v1/kbs/:kbId/subscribe` (tenant admin)
- [ ] **T4.2.6** Implement `POST /v1/kbs/:kbId/unsubscribe`

---

## Milestone 5: Website Scraping

### Epic 5.1: Source Configuration

- [ ] **T5.1.1** Implement `GET /v1/kbs/:kbId/sources`
- [ ] **T5.1.2** Implement `POST /v1/kbs/:kbId/sources` with config:
  - Scrape mode: single | list | sitemap | domain
  - Include/exclude patterns
  - Crawl depth
  - Subdomain policy
  - Schedule (daily/weekly)
  - Firecrawl toggle
  - Enrichment toggle
- [ ] **T5.1.3** Implement `PATCH /v1/sources/:sourceId`
- [ ] **T5.1.4** Implement `DELETE /v1/sources/:sourceId`

### Epic 5.2: Source Run Management

- [ ] **T5.2.1** Implement `POST /v1/sources/:sourceId/runs` (trigger run)
- [ ] **T5.2.2** Implement `GET /v1/sources/:sourceId/runs`
- [ ] **T5.2.3** Implement `GET /v1/runs/:runId` (status + stats)
- [ ] **T5.2.4** Implement `POST /v1/runs/:runId/cancel`
- [ ] **T5.2.5** Implement run scheduling (cron for daily/weekly)

### Epic 5.3: Scraper Worker - URL Discovery

- [ ] **T5.3.1** Implement single page URL handling
- [ ] **T5.3.2** Implement URL list processing
- [ ] **T5.3.3** Implement sitemap.xml parsing and URL extraction
- [ ] **T5.3.4** Implement domain crawl with depth limit
- [ ] **T5.3.5** Implement include/exclude pattern matching
- [ ] **T5.3.6** Implement subdomain policy (same host vs *.host)
- [ ] **T5.3.7** Implement URL normalization (strip utm_*, gclid, fbclid)
- [ ] **T5.3.8** Implement URL deduplication within run

### Epic 5.4: Scraper Worker - Page Fetching

- [ ] **T5.4.1** Implement HTML-first fetch (axios/got)
- [ ] **T5.4.2** Implement JS detection heuristic (check for empty content, JS frameworks)
- [ ] **T5.4.3** Set up Playwright worker pool
- [ ] **T5.4.4** Implement Playwright page rendering
- [ ] **T5.4.5** Implement Firecrawl API client
- [ ] **T5.4.6** Implement fallback logic: HTML → Playwright → Firecrawl (if enabled)
- [ ] **T5.4.7** Implement fetch timeout and error handling
- [ ] **T5.4.8** Respect robots.txt (with admin override flag)

### Epic 5.5: Content Extraction

- [ ] **T5.5.1** Implement main content extraction (Readability.js or similar)
- [ ] **T5.5.2** Extract page title
- [ ] **T5.5.3** Extract headings (H1-H6 hierarchy)
- [ ] **T5.5.4** Extract section path from heading structure
- [ ] **T5.5.5** Strip navigation, ads, cookie banners, footers
- [ ] **T5.5.6** Extract tables (best-effort HTML→text)
- [ ] **T5.5.7** Compute content hash for change detection

---

## Milestone 6: Document Uploads

### Epic 6.1: Upload API

- [ ] **T6.1.1** Implement `POST /v1/kbs/:kbId/uploads` (multipart file upload)
- [ ] **T6.1.2** Implement `GET /v1/kbs/:kbId/uploads` (list uploads)
- [ ] **T6.1.3** Implement `DELETE /v1/uploads/:uploadId`
- [ ] **T6.1.4** Enforce monthly upload quota (default: 1000 docs)

### Epic 6.2: Document Processing

- [ ] **T6.2.1** Implement PDF text extraction (pdf-parse or pdfjs-dist)
- [ ] **T6.2.2** Implement DOCX text extraction (mammoth)
- [ ] **T6.2.3** Implement TXT/Markdown passthrough
- [ ] **T6.2.4** Implement HTML text extraction (same as scraper)
- [ ] **T6.2.5** Store extracted text only (no original file persistence)
- [ ] **T6.2.6** Configure temporary blob storage (S3/MinIO for SaaS, local for self-host)

---

## Milestone 7: Chunking & Embeddings

### Epic 7.1: Text Chunking

- [ ] **T7.1.1** Implement token-based chunking (800 tokens, 120 overlap)
- [ ] **T7.1.2** Use tiktoken or similar for token counting
- [ ] **T7.1.3** Preserve heading/section context in chunks
- [ ] **T7.1.4** Generate chunk metadata (title, heading, section_path, chunk_index)
- [ ] **T7.1.5** Compute content_hash per chunk

### Epic 7.2: Embedding Generation

- [ ] **T7.2.1** Implement OpenAI-compatible embedding API client
- [ ] **T7.2.2** Support configurable embedding endpoint and model
- [ ] **T7.2.3** Implement batch embedding (reduce API calls)
- [ ] **T7.2.4** Insert embeddings into pgvector
- [ ] **T7.2.5** Handle embedding API rate limits and retries

### Epic 7.3: Full-Text Search Index

- [ ] **T7.3.1** Generate tsvector from chunk content + title + heading
- [ ] **T7.3.2** Store tsvector in `kb_chunks.tsv` column
- [ ] **T7.3.3** Create/update GIN index

### Epic 7.4: LLM Enrichment (Optional)

- [ ] **T7.4.1** Implement enrichment job processor
- [ ] **T7.4.2** Generate: summary, keywords, tags, entities per page/doc
- [ ] **T7.4.3** Cache enrichment by content_hash
- [ ] **T7.4.4** Apply only when `enrichment_enabled = true` on source/KB
- [ ] **T7.4.5** Respect tenant quota for enrichment calls

---

## Milestone 8: Agents

### Epic 8.1: Agent CRUD

- [ ] **T8.1.1** Implement `GET /v1/agents`
- [ ] **T8.1.2** Implement `POST /v1/agents`
- [ ] **T8.1.3** Implement `GET /v1/agents/:agentId`
- [ ] **T8.1.4** Implement `PATCH /v1/agents/:agentId`
- [ ] **T8.1.5** Implement `DELETE /v1/agents/:agentId`
- [ ] **T8.1.6** Enforce per-tenant agent quota (default: 10)

### Epic 8.2: Agent Knowledge Base Attachment

- [ ] **T8.2.1** Implement `GET /v1/agents/:agentId/kbs`
- [ ] **T8.2.2** Implement `PUT /v1/agents/:agentId/kbs` (replace set)
- [ ] **T8.2.3** Validate KB access (tenant-owned or subscribed global)

### Epic 8.3: Retrieval Configuration

- [ ] **T8.3.1** Implement `GET /v1/agents/:agentId/retrieval-config`
- [ ] **T8.3.2** Implement `PUT /v1/agents/:agentId/retrieval-config`
  - top_k (default: 8)
  - candidate_k (default: 40)
  - reranker_enabled (boolean)
  - reranker_type (heuristic | cross_encoder)

---

## Milestone 9: Retrieval & RAG Pipeline

### Epic 9.1: Hybrid Retrieval

- [ ] **T9.1.1** Implement query embedding generation
- [ ] **T9.1.2** Implement pgvector similarity search with `kb_id IN (...)` filter
- [ ] **T9.1.3** Implement tsvector keyword search with `plainto_tsquery`
- [ ] **T9.1.4** Merge candidate pools (union, cap at 2 * candidate_k)

### Epic 9.2: Heuristic Reranker

- [ ] **T9.2.1** Implement normalized vector similarity scoring
- [ ] **T9.2.2** Implement keyword overlap scoring
- [ ] **T9.2.3** Implement title/heading match boost
- [ ] **T9.2.4** Implement combined weighted score
- [ ] **T9.2.5** Select top_k after reranking

### Epic 9.3: Cross-Encoder Reranker (Optional)

- [ ] **T9.3.1** Integrate cross-encoder model (self-hosted or API)
- [ ] **T9.3.2** Score (query, chunk) pairs
- [ ] **T9.3.3** Make toggle-able per agent

### Epic 9.4: Context Assembly

- [ ] **T9.4.1** Build context from top_k chunks
- [ ] **T9.4.2** Include title, URL, heading, content per chunk
- [ ] **T9.4.3** Enforce token budget (drop lowest-scored if over)

### Epic 9.5: LLM Generation

- [ ] **T9.5.1** Implement strict RAG system prompt
- [ ] **T9.5.2** Enforce "answer only from sources"
- [ ] **T9.5.3** Implement "I don't know" fallback
- [ ] **T9.5.4** Request citations in response format
- [ ] **T9.5.5** Parse citations (title, URL, snippet) from response
- [ ] **T9.5.6** Support streaming responses

---

## Milestone 10: Chat API

### Epic 10.1: Chat Endpoint

- [ ] **T10.1.1** Implement `POST /v1/chat`
  - Auth: OIDC bearer OR API key
  - Body: agent_id, message, conversation_id (optional)
  - Response: answer, citations[], conversation_id
- [ ] **T10.1.2** Validate agent access
- [ ] **T10.1.3** Enforce per-tenant rate limiting
- [ ] **T10.1.4** Log chat event metadata (latency, tokens, etc.)

### Epic 10.2: Conversation Memory

- [ ] **T10.2.1** Implement Redis conversation storage
- [ ] **T10.2.2** Key format: `conv:{tenant_id}:{agent_id}:{conversation_id}`
- [ ] **T10.2.3** Store last 20 turns (sliding window)
- [ ] **T10.2.4** Set TTL: 1 hour
- [ ] **T10.2.5** Include conversation history in LLM context
- [ ] **T10.2.6** Refresh TTL on each interaction

---

## Milestone 11: Widget

### Epic 11.1: Widget Token Management

- [ ] **T11.1.1** Implement `POST /v1/widgets/token` (create public token)
- [ ] **T11.1.2** Token scoped to: tenant_id, agent_id, allowed_domains
- [ ] **T11.1.3** Store token mappings in DB

### Epic 11.2: Widget Configuration

- [ ] **T11.2.1** Implement `GET /v1/agents/:agentId/widget`
- [ ] **T11.2.2** Implement `PUT /v1/agents/:agentId/widget`
  - is_public: boolean
  - allowed_domains: string[]
  - theme: object (colors, position, etc.)

### Epic 11.3: Widget Endpoints (Public)

- [ ] **T11.3.1** Implement `GET /v1/widgets/:publicToken/config` (no auth)
- [ ] **T11.3.2** Implement `POST /v1/widgets/:publicToken/chat` (no auth)
- [ ] **T11.3.3** Validate Origin + Referer against allowlist
- [ ] **T11.3.4** Apply per-tenant rate limiting
- [ ] **T11.3.5** Generate/accept conversation_id

### Epic 11.4: Widget SDK (widget.js)

- [ ] **T11.4.1** Create widget.js loader script
- [ ] **T11.4.2** Read `data-widget-token` from script tag
- [ ] **T11.4.3** Fetch config from `/v1/widgets/:token/config`
- [ ] **T11.4.4** Inject floating chat button
- [ ] **T11.4.5** Implement chat panel UI (open/close)
- [ ] **T11.4.6** Generate conversation_id, store in sessionStorage
- [ ] **T11.4.7** Implement message send/receive
- [ ] **T11.4.8** Display citations with links
- [ ] **T11.4.9** Apply theme customization
- [ ] **T11.4.10** Build and bundle widget.js for CDN

---

## Milestone 12: Quotas & Rate Limiting

### Epic 12.1: Quota Tracking

- [ ] **T12.1.1** Create `tenant_quotas` table (configurable limits)
- [ ] **T12.1.2** Create `tenant_usage` table (monthly counters)
- [ ] **T12.1.3** Track: KBs, agents, uploaded_docs, scraped_pages
- [ ] **T12.1.4** Enforce quotas in relevant endpoints
- [ ] **T12.1.5** Return clear error when quota exceeded

### Epic 12.2: Rate Limiting

- [ ] **T12.2.1** Implement Redis-based rate limiter (sliding window)
- [ ] **T12.2.2** Apply per-tenant rate limit to `/v1/chat`
- [ ] **T12.2.3** Apply per-tenant rate limit to widget chat
- [ ] **T12.2.4** Apply per-tenant rate limit to run triggers
- [ ] **T12.2.5** Return 429 with Retry-After header

---

## Milestone 13: Analytics & Logging

### Epic 13.1: Chat Event Logging

- [ ] **T13.1.1** Log to `chat_events` table on each chat request
- [ ] **T13.1.2** Record: latency, tokens, retrieved_chunks, status, error_code
- [ ] **T13.1.3** No transcript storage (metadata only)

### Epic 13.2: Analytics Endpoints

- [ ] **T13.2.1** Implement `GET /v1/analytics/agents/:agentId`
  - Query counts, latency percentiles, error rates
- [ ] **T13.2.2** Implement `GET /v1/analytics/tenant`
  - Aggregate stats across agents
- [ ] **T13.2.3** Support time range filtering

### Epic 13.3: Observability

- [ ] **T13.3.1** Implement structured logging (JSON format)
- [ ] **T13.3.2** Add correlation IDs to requests
- [ ] **T13.3.3** Expose Prometheus metrics endpoint
- [ ] **T13.3.4** Set up job failure alerting

---

## Milestone 14: Deletion & Retention

### Epic 14.1: Soft Delete

- [ ] **T14.1.1** Implement soft delete for KBs
- [ ] **T14.1.2** Implement soft delete for sources
- [ ] **T14.1.3** Implement soft delete for agents
- [ ] **T14.1.4** Implement soft delete for tenants

### Epic 14.2: Hard Delete Jobs

- [ ] **T14.2.1** Schedule hard delete 30 days after soft delete
- [ ] **T14.2.2** Implement cascade delete for KB → sources → chunks → embeddings
- [ ] **T14.2.3** Implement `HARD_DELETE_OBJECT` job processor
- [ ] **T14.2.4** Track deletion job status in `deletion_jobs` table

### Epic 14.3: Versioning (Optional)

- [ ] **T14.3.1** Implement source run versioning
- [ ] **T14.3.2** Keep last 5 runs per source
- [ ] **T14.3.3** Prune old versions automatically

---

## Milestone 15: Admin UI

### Epic 15.1: Authentication Flow

- [ ] **T15.1.1** Implement OIDC login redirect
- [ ] **T15.1.2** Handle callback and session
- [ ] **T15.1.3** Implement tenant switcher

### Epic 15.2: Dashboard

- [ ] **T15.2.1** Display tenant overview (KBs, agents, usage)
- [ ] **T15.2.2** Display recent activity

### Epic 15.3: Knowledge Base Management

- [ ] **T15.3.1** KB list view
- [ ] **T15.3.2** KB create/edit form
- [ ] **T15.3.3** Source list within KB
- [ ] **T15.3.4** Source create/edit form (scrape config)
- [ ] **T15.3.5** Run history view
- [ ] **T15.3.6** Trigger "run now" button
- [ ] **T15.3.7** Upload documents UI (drag-and-drop)

### Epic 15.4: Agent Management

- [ ] **T15.4.1** Agent list view
- [ ] **T15.4.2** Agent create/edit form
- [ ] **T15.4.3** KB attachment selector
- [ ] **T15.4.4** Retrieval config panel
- [ ] **T15.4.5** Widget config panel
- [ ] **T15.4.6** Widget embed code generator

### Epic 15.5: Chat Testing

- [ ] **T15.5.1** Implement admin chat interface
- [ ] **T15.5.2** Display citations and debug info

### Epic 15.6: Analytics Dashboard

- [ ] **T15.6.1** Display query volume over time
- [ ] **T15.6.2** Display latency charts
- [ ] **T15.6.3** Display error rates

### Epic 15.7: Member Management

- [ ] **T15.7.1** Member list view
- [ ] **T15.7.2** Invite member form
- [ ] **T15.7.3** Role editor

---

## Milestone 16: Deployment & Self-Hosting

### Epic 16.1: Docker Configuration

- [ ] **T16.1.1** Dockerfile for API service
- [ ] **T16.1.2** Dockerfile for ingestion worker
- [ ] **T16.1.3** Dockerfile for scraper worker
- [ ] **T16.1.4** Dockerfile for web UI
- [ ] **T16.1.5** Docker Compose for full stack

### Epic 16.2: Configuration

- [ ] **T16.2.1** Environment variable documentation
- [ ] **T16.2.2** Storage backend config (S3 vs local)
- [ ] **T16.2.3** OIDC provider config
- [ ] **T16.2.4** Embedding/LLM endpoint config

### Epic 16.3: Kubernetes (Optional)

- [ ] **T16.3.1** Helm chart for all services
- [ ] **T16.3.2** Horizontal Pod Autoscaler configs
- [ ] **T16.3.3** Ingress configuration

---

## Milestone 17: Testing & QA

### Epic 17.1: Unit Tests

- [ ] **T17.1.1** Unit tests for chunking logic
- [ ] **T17.1.2** Unit tests for URL normalization
- [ ] **T17.1.3** Unit tests for content extraction
- [ ] **T17.1.4** Unit tests for reranker scoring

### Epic 17.2: Integration Tests

- [ ] **T17.2.1** Integration tests for full scraping pipeline
- [ ] **T17.2.2** Integration tests for document upload pipeline
- [ ] **T17.2.3** Integration tests for RAG pipeline
- [ ] **T17.2.4** Integration tests for widget chat flow
- [ ] **T17.2.5** RLS isolation tests

### Epic 17.3: End-to-End Tests

- [ ] **T17.3.1** E2E test: tenant creates KB, adds source, triggers scrape
- [ ] **T17.3.2** E2E test: agent answers question from scraped content
- [ ] **T17.3.3** E2E test: widget embed and chat

---

## Milestone 18: Documentation

### Epic 18.1: Developer Documentation

- [ ] **T18.1.1** API reference documentation
- [ ] **T18.1.2** Self-hosting guide
- [ ] **T18.1.3** Configuration reference
- [ ] **T18.1.4** Architecture overview

### Epic 18.2: User Documentation

- [ ] **T18.2.1** Getting started guide
- [ ] **T18.2.2** Knowledge base setup guide
- [ ] **T18.2.3** Widget integration guide

---

## Priority Order (Suggested Build Sequence)

1. **Milestone 0** - Project foundation
2. **Milestone 1** - Database & infrastructure
3. **Milestone 2** - Authentication
4. **Milestone 3** - Tenant management
5. **Milestone 4** - Knowledge base management
6. **Milestone 7** - Chunking & embeddings (needed for scraping)
7. **Milestone 5** - Website scraping
8. **Milestone 6** - Document uploads
9. **Milestone 8** - Agents
10. **Milestone 9** - RAG pipeline
11. **Milestone 10** - Chat API
12. **Milestone 11** - Widget
13. **Milestone 12** - Quotas & rate limiting
14. **Milestone 13** - Analytics
15. **Milestone 14** - Deletion & retention
16. **Milestone 15** - Admin UI
17. **Milestone 16** - Deployment
18. **Milestone 17** - Testing
19. **Milestone 18** - Documentation

---

## Task Status Legend

- [ ] Not started
- [x] Completed
- [~] In progress
- [!] Blocked

---

*Last updated: 2026-01-09*
