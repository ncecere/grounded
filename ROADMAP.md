# Grounded — Roadmap

This document outlines features that are planned, partially built, or stubbed in the codebase. Items are grouped by maturity — from code that's nearly complete to ideas that are only hinted at.

---

## 🟢 Backend Complete — Needs Frontend UI

These features have working API routes, database schemas, and service logic. They're blocked on building the admin UI.

### Tools & Agentic Mode

**What it is:** Let agents call external tools during a conversation instead of only searching knowledge bases.

**What's built:**
- Database: 4 tables (`toolDefinitions`, `agentTools`, `agentCapabilities`, `mcpConnections`)
- API: Full CRUD at `/api/v1/tools` — create, update, delete tools; attach/detach tools to agents; get/set agent capabilities
- Validation: Zod schemas for all tool operations

**Three tool types:**

| Type | Description | Config |
|------|-------------|--------|
| **API** | Call any REST endpoint | Base URL, method, path, auth (5 types), headers, body template, timeout |
| **MCP** | Connect to Model Context Protocol servers | Transport (stdio/SSE/WebSocket), command/URL, auto-discovers tools |
| **Built-in** | Bundled utilities | Multi-KB Router, Calculator, Date & Time, Web Search |

**Agent capabilities (per-agent toggles):**
- Agentic mode on/off
- Tool calling on/off (max calls per turn)
- Multi-KB routing (agent picks which KB to search)
- Multi-step reasoning (max steps)
- Show chain of thought to users

**What's missing:**
- [ ] Web UI: Tool management page (CRUD tool definitions)
- [ ] Web UI: Agent settings tab for capabilities + tool attachment
- [ ] Web UI: MCP connection management (connect, test, view available tools)
- [ ] Chat service integration: Neither `simple-rag.ts` nor `advanced-rag.ts` invoke tools yet
- [ ] Tool execution engine: Actually calling API/MCP/builtin tools during chat
- [ ] Streaming tool call events to the UI (showing which tool was called and what it returned)

**Estimated effort:** Large — UI pages, tool execution engine, chat service integration, streaming events.

---

## 🟡 Partially Built — Needs Completion

### Cross-Encoder Reranking

**What it is:** Replace the heuristic reranker with a neural cross-encoder model for better search result quality.

**What's built:**
- Schema: `rerankerType` field on `retrievalConfigs` accepts `"heuristic"` or `"cross_encoder"`
- Validation: Zod schemas accept both values
- Tests: Validate the enum

**What's missing:**
- [ ] Cross-encoder model integration (e.g., Cohere Rerank, a local model, or an API)
- [ ] Actual reranking logic in the hybrid search service (currently only heuristic scoring)
- [ ] UI: Reranker type selector in agent retrieval settings

### Firecrawl Integration

**What it is:** Use [Firecrawl](https://firecrawl.dev) as an alternative fetch mode for web scraping — better at extracting clean content from JavaScript-heavy sites.

**What's built:**
- Fetch implementation: `scraper-worker/src/fetch/firecrawl.ts` — full API client
- Fetch selection: Logic to choose Firecrawl when `firecrawlEnabled` is true on a source config
- Source config: `firecrawlEnabled` field in source configuration
- UI: Field exists in source creation form (defaults to false)

**What's missing:**
- [ ] Documentation / setup guide for the Firecrawl API key (`FIRECRAWL_API_KEY` env var)
- [ ] UI: Better surfacing — currently just a boolean toggle, could show connection status
- [ ] Fallback behavior if Firecrawl quota exceeded

### Chunk Enrichment

**What it is:** Use an LLM to generate summaries, keywords, and entity extractions for each chunk — improving search quality.

**What's built:**
- Database: `kbChunks` has `summary`, `keywords`, `entities` columns
- Worker job: `enrich-page.ts` — processes chunks through an LLM to fill enrichment fields
- Queue: `enrich-page` job type registered in ingestion worker

**What's missing:**
- [ ] Enrichment is optional and may not run for all sources (unclear trigger conditions)
- [ ] UI: No visibility into enrichment status or results
- [ ] Search: Enrichment fields aren't clearly used in hybrid search scoring yet

---

## 🔵 Stubbed / Typed — Needs Implementation

### Qdrant Vector Store

**What it is:** Alternative vector database backend (in addition to pgvector).

**What's built:**
- Type: `VectorStoreType = "pgvector" | "qdrant"` in `packages/vector-store`
- Registry: Switch case for `"qdrant"` exists — currently throws `"not yet implemented"`
- Config: `VECTOR_DB_TYPE` env var already routes to provider factory

**What's missing:**
- [ ] Qdrant provider implementation (`packages/vector-store/src/providers/qdrant.ts`)
- [ ] Qdrant connection config (host, API key, collection settings)
- [ ] Testing with Qdrant Cloud or self-hosted

### Scheduled Test Suite Runs

**What it is:** Automatically run test suites on a schedule (daily/weekly) instead of only manually.

**What's built:**
- Database: `scheduleType` (`manual`, `daily`, `weekly`), `scheduleTime`, `scheduleDayOfWeek` on `agentTestSuites`
- UI: Schedule tab in test suite creation form
- Run tracking: `triggeredBy` field distinguishes `"manual"` vs `"schedule"`

**What's missing:**
- [ ] Cron/scheduler service that checks for due test suites and triggers runs
- [ ] Timezone handling for schedule times

---

## 🔮 Natural Next Steps

Features not yet in code but strongly implied by the architecture.

### Conversation Persistence

Currently conversations exist only in Redis during a session. There's no conversation history table.

- **Why:** Enables chat history view, conversation analytics, compliance logging
- **What exists:** `conversationId` is passed through chat, `chatEvents` logs metadata per message
- **What's needed:** Conversation + message tables, history API, UI for past conversations

### Webhooks / Event Notifications

No webhook system exists, but the audit service logs 30+ event types — a natural hook point.

- **Why:** Integrate with Slack, PagerDuty, or custom systems on events like ingestion failures, test regressions, quota warnings
- **What's needed:** Webhook registration table, event dispatch service, retry logic

### Per-Tenant Model Overrides

Models are currently system-wide (configured by system admins). Tenants can't bring their own API keys.

- **Why:** Enterprise tenants may want to use their own OpenAI/Anthropic keys, or require specific model versions
- **What exists:** `openai-compatible` provider type already supports custom `baseUrl` — could point to tenant-specific endpoints
- **What's needed:** Tenant-level model configuration UI, key storage, model selection per agent

### Granular Permissions

Current RBAC has 4 roles (owner, admin, member, viewer) with broad permissions.

- **Why:** Large organizations need fine-grained control (e.g., "can edit agents but not delete KBs")
- **What exists:** Role-based middleware, per-route role checks
- **What's needed:** Permission system, role-permission mapping, UI for custom roles

### Analytics Dashboards

Chat events capture rich data (latency, tokens, chunk counts, status) but the analytics UI is basic.

- **Why:** Understand usage patterns, identify slow queries, track costs
- **What exists:** `chatEvents` table with all metrics, basic analytics page
- **What's needed:** Time-series charts, cost estimation, per-agent performance breakdown, export

---

## Priority Recommendation

| Priority | Feature | Rationale |
|----------|---------|-----------|
| **P0** | Tools UI + chat integration | Backend is 100% built; biggest feature gap |
| **P1** | Conversation persistence | Required for production use; compliance need |
| **P1** | Scheduled test suite runs | Schema is ready; small effort for high value |
| **P2** | Cross-encoder reranking | Quality improvement; schema ready |
| **P2** | Analytics dashboards | Data already collected; needs visualization |
| **P3** | Qdrant support | Nice-to-have; pgvector works well |
| **P3** | Webhooks | Can use audit log polling as workaround |
| **P3** | Per-tenant models | Current model works for most deployments |
| **P4** | Granular permissions | Current 4-role system is sufficient for now |
