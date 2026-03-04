# Architecture Decision Records

Key architectural decisions made in Grounded, with rationale and trade-offs.

---

## ADR-001: Separate Vector Database

**Decision:** Use a separate PostgreSQL instance with pgvector for vector storage, distinct from the main application database.

**Context:** Vectors (embeddings) require specialized indexing (HNSW/IVFFlat) that can be memory-intensive. Vector queries have different performance characteristics than OLTP queries.

**Rationale:**
- **Resource isolation** — Vector index builds and searches don't compete with transactional workloads
- **Independent scaling** — Vector DB can have different CPU/memory/storage than main DB
- **Upgrade flexibility** — Can upgrade pgvector version independently
- **Simpler backup strategy** — Vector data is derived (can be regenerated from chunks); main DB has the source of truth

**Trade-off:** Two database connections to manage, cross-database joins impossible (chunk metadata fetched separately from vectors), slightly more complex deployment.

**Alternative considered:** Single PostgreSQL instance with pgvector. Simpler operationally but couples workloads.

---

## ADR-002: BullMQ for Job Queues

**Decision:** Use BullMQ (Redis-backed) for all background job processing.

**Context:** Grounded needs reliable job processing for web scraping, content ingestion, embedding generation, and hard-delete scheduling.

**Rationale:**
- **Redis already required** — Used for caching, conversation state, crawl state, and rate limiting
- **Mature and battle-tested** — BullMQ handles retries, backpressure, delayed jobs, priorities
- **Dashboard available** — Bull Board for monitoring (though not currently integrated)
- **Lua scripting** — Atomic operations for fairness scheduler
- **Worker isolation** — Jobs run in separate processes; a crash doesn't take down the API

**Trade-off:** Redis as SPOF for job processing. In-memory nature means jobs can be lost on Redis crash (mitigated by AOF persistence).

**Alternatives considered:**
- PostgreSQL-based queue (pg-boss) — Simpler but slower, no Lua scripting
- RabbitMQ — More complex to operate, didn't need routing features
- SQS — Cloud vendor lock-in

---

## ADR-003: State-Based Navigation (No React Router)

**Decision:** The web admin UI uses state-based navigation (`currentPage` state) instead of React Router.

**Context:** The admin UI is a single-page application with a sidebar navigation pattern.

**Rationale:**
- **Simplicity** — No URL parsing, no route config files, no nested router contexts
- **Predictable state** — Navigation is just a state transition; easy to reason about
- **Page registry** — All pages registered in one place (`page-registry.ts`)
- **No URL exposure** — Admin URLs don't reveal internal structure

**Trade-off:** No deep linking (can't bookmark a specific agent page), no browser back/forward, no shareable URLs for internal pages. URL always shows `/`.

**Alternative considered:** React Router with nested routes. Better UX for deep linking but adds complexity for an admin-only interface.

---

## ADR-004: Bun Runtime

**Decision:** Use Bun as the JavaScript/TypeScript runtime for all apps and packages.

**Context:** Need a fast, TypeScript-native runtime for a Node.js-ecosystem project.

**Rationale:**
- **Native TypeScript** — No compilation step for development
- **Fast startup** — Matters for worker processes that may restart frequently
- **Built-in bundler** — Used for widget builds
- **Workspace support** — `bun workspaces` for monorepo management
- **npm compatibility** — All npm packages work

**Trade-off:** Smaller ecosystem vs Node.js, fewer production deployments to learn from, some npm packages have edge-case incompatibilities.

---

## ADR-005: Hybrid Search with RRF

**Decision:** Combine vector search (pgvector) with full-text search (PostgreSQL tsvector) using Reciprocal Rank Fusion.

**Context:** Pure vector search can miss keyword-specific queries; pure FTS can miss semantic matches.

**Rationale:**
- **Complementary signals** — Vector catches semantic meaning, FTS catches exact terms
- **RRF is parameter-free** — No training data needed, k=60 is industry standard
- **Graceful degradation** — If FTS returns nothing, falls back to vector-only
- **No external service** — Both search types run on existing infrastructure

**Trade-off:** Slightly slower than vector-only (adds a SQL query for FTS). RRF doesn't learn from user behavior.

**Alternatives considered:**
- Cross-encoder reranking — Better quality but much slower (requires GPU)
- Cohere Rerank API — External dependency, cost per query
- Custom ML ranker — Requires training data we don't have

---

## ADR-006: Multi-Tenancy via Row-Level Security

**Decision:** Use PostgreSQL Row-Level Security (RLS) for tenant data isolation.

**Context:** Multi-tenant SaaS needs strict data isolation between organizations.

**Rationale:**
- **Database-enforced** — Even application bugs can't leak data across tenants
- **Transparent to queries** — Application code doesn't need `WHERE tenant_id = X` everywhere
- **Auditable** — Security policy is in SQL, reviewable
- **Performance** — PostgreSQL RLS adds minimal overhead with proper indexing

**Trade-off:** More complex connection management (need to set `app.tenant_id` session variable per request). Debug queries in Drizzle Studio need tenant context. Migrations must update policies when adding tables.

---

## ADR-007: Soft Delete with Delayed Hard Delete

**Decision:** All resource deletions are soft deletes (set `deletedAt`), with automatic hard deletion after 30 days.

**Context:** Users need the ability to recover accidentally deleted resources. GDPR and compliance may require eventual permanent deletion.

**Rationale:**
- **Recovery window** — 30 days to restore accidentally deleted KBs, agents, sources
- **Eventual cleanup** — `deletionJobs` table schedules permanent removal
- **Vector cleanup** — Hard delete handler removes vectors from pgvector DB
- **Consistent pattern** — All resources follow the same lifecycle

**Trade-off:** Queries must always filter `WHERE deleted_at IS NULL`. Storage usage grows during retention period. Partial indexes needed for unique constraints.

---

## ADR-008: Shadow DOM for Widget

**Decision:** The embeddable chat widget renders inside a Shadow DOM.

**Context:** The widget is embedded on third-party websites with unknown CSS.

**Rationale:**
- **CSS isolation** — Host page styles can't affect widget appearance
- **No conflicts** — Widget CSS can't leak into host page
- **Self-contained** — All styles bundled inline (no external stylesheet requests)
- **Theme support** — Color scheme can be set independently of host page

**Trade-off:** Slightly larger JS bundle (CSS embedded as string). Can't use host page's design tokens or font stack. Debugging in DevTools requires expanding Shadow DOM.

---

## ADR-009: AI Model Configuration via Admin UI

**Decision:** AI model API keys and configurations are stored in the database and managed through the Admin UI, not environment variables.

**Context:** Different tenants may need different models. Models need to be added/changed without redeploying.

**Rationale:**
- **Dynamic** — Add new providers and models without restart
- **Multi-model** — Different agents can use different models
- **Secure** — API keys stored encrypted in database, not in plaintext env vars
- **Testable** — Admin UI has "Test Connection" for immediate feedback

**Trade-off:** Initial setup requires both deployment AND Admin UI configuration. Can't use the system until at least one model is configured.

---

## Related Docs

- [02 — Architecture](./02-architecture.md) — System diagram and request flows
- [08 — Shared Packages](./08-packages.md) — Package design decisions
- [14 — Security](./14-security.md) — Security model details
