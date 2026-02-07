# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Separate Admin Panel**: System admins now operate in normal workspace mode by default. A dedicated "Admin Panel" mode is toggled via the avatar menu, replacing the previous mixed sidebar that showed both workspace and administration items together.
  - New `isAdminMode` state in `AppStateProvider` with `enterAdminMode()` / `exitAdminMode()` actions
  - Admin mode shows dedicated sidebar with "Back to Workspace" button and administration-only navigation
  - Workspace mode shows tenant switcher and workspace-only navigation (no admin items)
  - Avatar menu shows "Admin Panel" link for system admins in workspace mode, "Back to Workspace" in admin mode
  - Auto-enters admin mode when a system admin has no tenant memberships

## [0.6.0] - 2026-02-06

### Added

- **Hybrid Search (RRF)**: Search now combines vector similarity with full-text search (`ts_rank_cd` on `kb_chunks.tsv`) merged via Reciprocal Rank Fusion (k=60). Replaces the naive JS token-overlap reranker in Simple RAG and adds FTS-augmented search to Advanced RAG. New `apps/api/src/services/hybrid-search.ts` module.
- **Redis Caching Layer**: New `apps/api/src/services/cache.ts` with generic `cacheGet`/`cacheSet`/`cacheInvalidate` helpers.
  - Agent config cached with 60s TTL, invalidated on 5 mutation routes (update, delete, KBs, retrieval config, widget config)
  - Widget token validation cached with 120s TTL, with agent + widget config DB queries parallelized
  - Query embeddings cached with 5min TTL to avoid repeated embedding API calls
- **HNSW Vector Indexes**: Added `dimensions` column to the `vectors` table and created partial HNSW indexes for 768-dim and 1536-dim vectors. Vector search now includes `dimensions = N` in the WHERE clause for index utilization, changing search from O(n) sequential scan to O(log n) approximate nearest-neighbor.
- **Source Run Recovery Service**: Periodic scanner (every 60s) finds runs stuck in `"running"` for >15 minutes, marks them `"failed"`, and cleans up BullMQ jobs, fairness scheduler slots, and Redis crawl state.

### Changed

- **Advanced RAG Sub-Query Batching**: Sub-query embeddings are now batch-generated in a single `generateEmbeddings()` call instead of 3 separate `generateEmbedding()` calls, reducing API round-trips.
- **Browser Pool Improvements**: Fixed race condition with a launch mutex to prevent orphaned browser instances from concurrent BullMQ jobs. Added browser recycling after 500 pages to prevent memory fragmentation.
- **Domain-Level JS-Rendering Memoization**: Bounded cache (max 500 domains) remembers which domains need Playwright, skipping the wasted HTTP fetch for subsequent pages from the same domain.
- **DB Connection Pool Tuning**: Explicit pool configuration (`DB_POOL_MAX` env var, default 20) with 30s idle timeout and 10s connect timeout, replacing the default max of 10.
- **RAG Config Loading**: Parallelized 3 sequential DB queries (agent, retrievalConfig, attachedKbs) into `Promise.all()` in both Simple and Advanced RAG services.
- **Frontend Bundle Optimization**:
  - Vite manual chunks for react, radix-ui, markdown, xyflow, and motion
  - Lazy-loaded 8 admin/settings pages via `React.lazy()` in page-registry
  - Removed unused `@tanstack/react-router` dependency
  - Main bundle reduced from 644 KB to 319 KB (50% reduction)

### Fixed

- **Docker Deployment**: Made user/group creation idempotent in Dockerfiles (oven/bun:1 base already has UID/GID 1000). Wired `INTERNAL_API_KEY` env var to API and worker services. Fixed healthcheck from `curl` to `bun -e "fetch(...)"`. Set `PLAYWRIGHT_BROWSERS_PATH` for scraper worker.
- **Null Byte Crashes**: Added `html.replace(/\x00/g, "")` in content extraction, error message recording, and upload text extraction. PostgreSQL text columns cannot store `\u0000`, which was causing page-process inserts to fail.
- **Stuck Run Prevention**: Wrapped `recordPageFailure`/`deleteFetchedHtml` in try/catch so `incrementStageProgress` always runs, preventing runs from getting permanently stuck.

### Removed

- **Dead `processors/` Directory**: Removed 10 duplicate job handler files (2,059 lines) from `apps/ingestion-worker/src/processors/`. All handlers had been migrated to `jobs/` but the originals were never deleted.
- **Duplicate GIN Index**: Dropped `kb_chunks_tsv_idx` (migration 0013 duplicate of `kb_chunks_tsv_gin_idx` from migration 0003).

### Technical

- New migration `0031_drop_duplicate_gin_index.sql` for main DB
- New migration `vector-db/0001_hnsw_indexes.sql` for vector DB
- Widget token validation now parallelizes agent + widget config queries after token lookup

## [0.5.1] - 2026-01-22

### Fixed

- **Analytics Chart Overflow**: Fixed pass rate line chart bleeding into adjacent sections on the workspace Analytics page. Chart now properly clips content within its container using HTML-based circular data points and `vector-effect="non-scaling-stroke"` for consistent line rendering.
- **View Run Button**: Clicking "View run" in the Recent Regressions table now opens the test run detail panel, allowing users to inspect run results directly from the Analytics page.
- **Baseline-Only Analytics**: Test suite analytics now exclude candidate (A/B test) runs from calculations. Summary stats, pass rate charts, agent health metrics, and regression detection now only consider baseline runs for accurate historical tracking.

## [0.5.0] - 2026-01-21

### Added

- **Modular API Architecture**: New `apps/api/src/modules/` structure with domain-specific schemas and services for agents, admin, chat, tools, test-suites, and more.
- **Route Assembly**: Centralized v1 route assembly in `apps/api/src/routes/index.ts` with dedicated hosted chat routes.
- **Startup Tasks**: New `apps/api/src/startup/` module for centralized initialization.
- **Agent Services Layer**: Extracted agent business logic into `modules/agents/service.ts` with full test coverage.
- **Admin Repository**: New `modules/admin/repo.ts` for audit query logic.

### Changed

- **Ingestion Worker Modularization**: Complete restructure with new directories:
  - `bootstrap/` - Settings, vector store, and shutdown helpers
  - `jobs/` - Individual job processors (embed-chunks, page-index, page-process, source-discover, etc.)
  - `queues/` - Queue definitions and registration
  - `stage/` - Stage management (transitions, progress tracking, queue helpers)
  - `services/` - Extraction and robots.txt handling
- **Scraper Worker Modularization**: Complete restructure with new directories:
  - `bootstrap/` - Settings initialization with acceptance tests
  - `browser/` - Browser pool lifecycle management
  - `fetch/` - Strategy selection (HTTP, Playwright, Firecrawl) with orchestration
  - `jobs/` - Centralized job registration
  - `services/` - Content validation, fairness slot management
- **Web App Provider Pattern**: New provider architecture for cleaner state management:
  - `AppStateProvider` - Centralized navigation and app state
  - `AuthProvider` - Authentication context
  - `TenantProvider` - Tenant context
- **Page Registry**: Centralized page metadata with auth gates and navigation grouping in `apps/web/src/app/page-registry.ts`.
- **API Types by Domain**: Split monolithic `types.ts` into domain-specific files (admin, agents, analytics, auth, chat, knowledge-bases, sources, tenants, test-suites, tools).
- **Shared Package Consolidation**: Centralized tenant admin DTOs and HTTP errors in `@grounded/shared` with defined export boundaries.

### Documentation

- **Refactor Documentation**: Comprehensive docs in `docs/refactor/` covering:
  - Architecture boundaries and constraints
  - Module ownership guidelines
  - API module patterns
  - Dependency mapping
  - Test matrix
  - Migration log
- **Phase Task Plans**: Detailed task breakdowns in `tasks/` for each refactor phase (0-5).
- **Baseline Inventory**: Captured observability, API contracts, queue payloads, and cross-cutting concerns.

### Technical

- **246 files changed** across the codebase with improved separation of concerns
- New barrel exports for cleaner imports across all apps
- Extensive test coverage for new modules and refactored code
- Import structure validation tests to enforce module boundaries
- Docker build fix: Added missing `packages/shared` to web Dockerfile

## [0.4.0] - 2026-01-21

### Added

- **Prompt Analysis & A/B Testing**: Analyze failed runs, generate candidate prompts, and compare baseline vs candidate performance.
- **Prompt Analysis UI**: Summary panels with failure clusters, suggested prompts, and "Apply to Agent" flow.
- **Test Prompt Dialog**: Provide custom candidate prompts for manual experiments.
- **Experiment Tracking**: Baseline/candidate badges and experiment detail views for runs.
- **Test Suite Detail Page**: Dedicated page for per-agent test suites with a new "Test Suites" action on agent cards.
- **System Prompt Capture**: Test runs now store the agent system prompt and display it in the run detail view.
- **Test Run Lock Recovery**: Automatically unlocks stuck test runs to keep suites unblocked.

### Changed

- **Prompt Analysis Quality**: Analysis now incorporates expected behavior, failure signals, and structured output for stronger prompt rewrites.
- **Test Suite UX**: Run cards now surface "View results," handle no-case runs explicitly, and the actual response is collapsible in run details.
- **Suite List API**: Test suite list responses now include test case counts and last-run summaries for better status visibility.

### Fixed

- **Run Refreshing**: Active runs now auto-refresh suite status, analytics, and recent runs without page reloads.
- **Pass Rate Accuracy**: Average pass rate calculations handle zero-case runs correctly, and chart markers no longer overflow.
- **Test Case Creation**: Prevented create-case forms from resetting during edits, avoiding false "Name/Question required" errors.
- **LLM Judge Robustness**: Improved JSON-only prompting and fallback parsing to reduce judge failures.
- **Worker Settings Fetch**: Docker workers now reach the API service via `API_URL` in compose.

## [0.3.1] - 2026-01-19

### Changed

- **Agents Page UI Redesign**: Replaced multiple modals with a unified slide-out panel for cleaner UX:
  - New `AgentCard` component with hover-to-reveal actions (Chat, Configure, Delete)
  - New `AgentDetailPanel` slide-out panel with 4 tabs: General, Model & RAG, Widget, Chat & API
  - Consolidated General + Status tabs into single General tab with inline status toggle
  - Consolidated Model & KB + Search tabs into single Model & RAG tab
  - Widget configuration and Chat/API endpoints moved from separate modals to panel tabs
  - Create mode shows only General and Model & RAG tabs (Widget/Chat tabs appear after creation)

- **Knowledge Bases Page UI Redesign**: Applied same card/panel pattern for consistency:
  - New `KBCard` component with hover-to-reveal actions (Open, Configure, Delete for owned KBs; View for shared KBs)
  - Shared badge moved to upper right corner of card
  - Consistent footer layout with sources, chunks, created date, and read-only indicator
  - New `KBDetailPanel` slide-out panel for creating/editing KB settings
  - Embedding model selection with reindex confirmation flow preserved

- **Admin Tenants Page**: Refactored to match styling patterns used in other admin pages (Users, Shared KBs, Models):
  - Table now uses proper border styling with `rounded-lg border` wrapper and `bg-muted/50` header background
  - Replaced text link buttons ("Manage", "Delete") with icon buttons (Settings, Trash2)
  - Added EmptyState component when no tenants exist
  - Converted custom modal to Dialog component with consistent `max-w-2xl` sizing
  - Added icons to modal tabs (Users for Members, Bell for Alert Settings)
  - Using ConfirmDialog for delete confirmations instead of browser `confirm()`

### Fixed

- **Dropdown Styling Consistency**: Replaced native HTML `<select>` elements with Radix Select components across tenant management:
  - Admin Tenants modal (add member and role selector dropdowns)
  - Tenant Settings page / MembersList component (add member and role selector dropdowns)
  - Admin Shared KBs tenant selection dropdown
- **Modal Size Stability**: Tenant management modal no longer changes size when switching between Members and Alert Settings tabs
- **Button Variants**: Standardized Cancel buttons to use `variant="outline"` instead of `variant="ghost"`
- **Remove Button Style**: Changed member remove action from text link to icon button with trash icon for consistency
- **Shared KB Chunk Counts**: Fixed RLS policies so tenants can now see chunk/source counts for published global knowledge bases. Previously, chunk counts showed as 0 because the RLS policy only allowed access to tenant-owned data, not global KB data with `tenant_id = NULL`.
- **Shared KB Detail Page**: The `GET /knowledge-bases/:id` endpoint now returns `sourceCount` and `chunkCount` fields, fixing the shared KB detail page which previously showed 0 chunks even though the list view showed the correct count.

## [0.3.0] - 2026-01-19

### Added

- **Sequential Stage Architecture**: Complete refactor of ingestion pipeline to process stages sequentially (DISCOVERING -> SCRAPING -> PROCESSING -> INDEXING -> EMBEDDING -> COMPLETED), ensuring reliable progress tracking and stage transitions.
- **Fairness Scheduler for Scraper Worker**: Dynamic fair-share slot allocation system that distributes worker capacity evenly across concurrent source runs, preventing one large run from monopolizing resources.
- **Worker Settings UI**: New Admin Settings tab for configuring worker fairness and concurrency settings via the UI, with real-time fairness metrics display showing active runs, slot allocation, and fair share per run.
- **Worker Settings API**: Internal API endpoint (`/api/v1/internal/workers/settings`) for workers to fetch configuration from the database, with `WorkerSettingsClient` for periodic settings refresh.
- **Stage Progress Tracking**: Redis-based atomic counters for tracking job completion within each stage, enabling accurate stage transition detection.
- **Stage Transition Jobs**: New job type that coordinates transitions between pipeline stages, queueing jobs for the next stage when the current stage completes.
- **Upload Support for Global KBs**: Admin can now upload documents directly to shared/global knowledge bases.
- **Source Run Cancellation Improvements**: Canceling a run now cleans up all pending jobs across queues and unregisters from fairness scheduler.

### Documentation

- **System Settings Guide** (`system-settings.md`): Comprehensive documentation for all admin settings tabs including Authentication (OIDC/SSO), Quotas, Email (SMTP), Alerts, and API Tokens with screenshots.
- **Shared Knowledge Bases Guide** (`shared-knowledge-bases.md`): New guide covering global KB creation, sharing methods (publish to all vs. individual tenants), source management, and tenant read-only experience.
- **Worker Settings Guide** (`worker-settings.md`): Documentation for worker concurrency and fairness scheduler configuration via Admin UI.
- **AI Models Guide Updates**: Enhanced `model-configuration.md` with step-by-step screenshots for adding providers, chat models, and embedding models.
- **Administration Screenshots**: 40+ new screenshots for admin documentation covering Settings, AI Models, and Shared KBs pages.
- **Tenant Guide Screenshots**: Updated tenant documentation with screenshots for Knowledge Bases, Agents, Sources, and Team Management.

### Changed

- **Ingestion Pipeline**: Refactored from parallel/chaotic processing to sequential stage-based processing for better reliability and observability.
- **BullMQ Delayed Job Handling**: Fixed lock errors by properly throwing `DelayedError` after `moveToDelayed()` to signal BullMQ that job state was already handled.
- **Page Processing**: Split into two stages - PROCESSING (chunking/content extraction) and INDEXING (database writes), with HTML stored temporarily in Redis between SCRAPING and PROCESSING stages.

### Technical

- New `fairness-scheduler.ts` module with Lua scripts for atomic slot acquisition/release
- New `stage-job-queuer.ts` for batching and queueing jobs at stage transitions
- New `stage-manager.ts` for stage state management utilities
- New `stage-transition.ts` processor for handling stage completion events
- New `page-index.ts` processor for the INDEXING stage
- Exported `DelayedError` from BullMQ through `@grounded/queue` package

## [0.2.0] - 2026-01-18

### Added

- **Advanced RAG Mode**: New multi-step retrieval pipeline for complex queries:
  - Query rewriting using conversation history context for better search relevance
  - Sub-query planning that breaks complex questions into focused searches
  - Parallel retrieval across multiple sub-queries
  - Intelligent result merging and deduplication
  - Configurable via `ragType` field on agents ("simple" or "advanced")
- **Reasoning Steps Display**: Visual progress indicators showing AI thinking process:
  - Step-by-step reasoning panel in Test Chat, Widget, and Published Chat
  - Five visible stages: Query Rewrite, Plan, Search, Merge, Generate
  - Real-time streaming of reasoning progress via SSE events
  - Collapsible panel with status indicators for each step
- **Show Reasoning Steps Toggle**: Per-agent configuration to show/hide reasoning steps in widget and published chat interfaces
- **Advanced RAG Settings**: New agent configuration options:
  - `historyTurns` (1-20): Number of conversation turns used for query rewriting
  - `advancedMaxSubqueries` (1-5): Maximum sub-queries generated for retrieval

### Changed

- Agent form modal now includes RAG Type selector with Advanced mode settings
- Widget and Published Chat automatically detect Advanced RAG mode from agent config
- Chat API streams additional `reasoning` events for Advanced RAG progress

### Fixed

- Widget reasoning panel scroll clipping issue when scrolling up after long responses
- Sub-query generation reliability with structured output and fallback parsing

### Technical

- New `AdvancedRAGService` with full test coverage
- SSE event types extended for reasoning step streaming
- Database schema additions for Advanced RAG configuration fields
- ReasoningPanel component for widget with Preact

## [0.1.0] - 2026-01-11

### Added

- **Multi-tenant Architecture**: Full multi-tenancy support with row-level security (RLS) for complete data isolation between organizations.
- **Knowledge Base Management**: Create and manage knowledge bases with web crawling and file upload support.
- **Web Crawling**: Automated content ingestion from websites with multiple crawl modes:
  - Single page crawling
  - Sitemap-based crawling
  - Full domain crawling with depth control
  - URL pattern filtering (include/exclude)
  - Scheduled re-crawling (daily, weekly, monthly)
- **File Uploads**: Support for PDF, Word, Excel, PowerPoint, text, HTML, CSV, and JSON files.
- **AI Agents**: Configurable chat agents with:
  - Custom system prompts
  - Multiple LLM provider support (OpenAI, Anthropic, Google, OpenAI-compatible)
  - Retrieval configuration (top-k, reranking, citation settings)
  - Welcome messages and branding
- **RAG Pipeline**: Strict retrieval-augmented generation ensuring responses are grounded in knowledge base content with proper citations.
- **Vector Search**: Semantic search using pgvector with support for multiple embedding models.
- **Chat Widget**: Embeddable Preact-based chat widget with:
  - Customizable appearance
  - Domain restrictions
  - Streaming responses
  - Citation display
  - Conversation persistence
- **Hosted Chat Pages**: Standalone chat pages accessible via shareable URLs.
- **REST API**: Full API for programmatic access with:
  - Streaming and non-streaming chat endpoints
  - Conversation management
  - Token-based authentication
- **User Management**:
  - Local authentication with email/password
  - SSO support via OpenID Connect
  - Role-based access control (Admin, Member, Viewer)
- **Team Management**: Invite team members, assign roles, and manage access.
- **Analytics Dashboard**: Query volume, response times, and usage metrics.
- **Admin Panel**: System-wide configuration for:
  - LLM provider management
  - Tenant administration
  - User management
  - Shared knowledge bases

### Infrastructure

- Docker Compose deployment configuration
- Kubernetes manifests for production deployment
- PostgreSQL with pgvector for vector storage
- Redis for job queue (BullMQ)
- Background workers for ingestion and web scraping

### Documentation

- Development setup guide
- Architecture documentation
- Deployment guides (Docker, Kubernetes)
- User documentation for administrators and tenants
- API integration guides

[unreleased]: https://github.com/ncecere/grounded/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/ncecere/grounded/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/ncecere/grounded/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ncecere/grounded/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ncecere/grounded/compare/v0.3.1...v0.4.0
[0.3.0]: https://github.com/ncecere/grounded/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ncecere/grounded/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ncecere/grounded/releases/tag/v0.1.0
