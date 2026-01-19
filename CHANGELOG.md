# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Sequential Stage Architecture**: Complete refactor of ingestion pipeline to process stages sequentially (DISCOVERING -> SCRAPING -> PROCESSING -> INDEXING -> EMBEDDING -> COMPLETED), ensuring reliable progress tracking and stage transitions.
- **Fairness Scheduler for Scraper Worker**: Dynamic fair-share slot allocation system that distributes worker capacity evenly across concurrent source runs, preventing one large run from monopolizing resources.
- **Stage Progress Tracking**: Redis-based atomic counters for tracking job completion within each stage, enabling accurate stage transition detection.
- **Stage Transition Jobs**: New job type that coordinates transitions between pipeline stages, queueing jobs for the next stage when the current stage completes.
- **Upload Support for Global KBs**: Admin can now upload documents directly to shared/global knowledge bases.
- **Source Run Cancellation Improvements**: Canceling a run now cleans up all pending jobs across queues and unregisters from fairness scheduler.

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

[unreleased]: https://github.com/ncecere/grounded/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ncecere/grounded/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ncecere/grounded/releases/tag/v0.1.0
