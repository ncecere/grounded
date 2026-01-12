# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KCB is a multi-tenant SaaS platform combining knowledge ingestion (RAG), configurable AI agents, and an embeddable chat widget. It uses row-level security (RLS) on PostgreSQL for tenant isolation.

## Commands

### Development
```bash
bun run docker:dev          # Start infrastructure (Postgres, pgvector, Redis)
bun run dev                 # Start all services with hot reload
bun run dev:api             # API only
bun run dev:web             # Web UI only
bun run dev:ingestion       # Ingestion worker only
bun run dev:scraper         # Scraper worker only
```

### Database
```bash
bun run db:generate         # Generate migrations from schema changes
bun run db:migrate          # Apply pending migrations
bun run db:push             # Push schema directly (dev only)
bun run db:studio           # Open Drizzle Studio
```

### Build & Quality
```bash
bun run build               # Build all packages
bun run lint                # Lint all packages
bun run test                # Test all packages
bun run typecheck           # TypeScript type checking
```

### Docker
```bash
bun run docker:build        # Build all images
bun run docker:up           # Start full stack
bun run docker:down         # Stop all containers
bun run docker:logs         # View logs
```

## Architecture

### Monorepo Structure
- **apps/api** - Hono REST API server
- **apps/web** - React 19 admin UI (Vite, TanStack Query, Radix UI)
- **apps/ingestion-worker** - Document processing (chunking, embedding)
- **apps/scraper-worker** - Website scraping (Playwright)
- **packages/db** - Drizzle ORM schema and client
- **packages/queue** - BullMQ job queue abstraction
- **packages/ai-providers** - Multi-provider AI SDK (OpenAI, Anthropic, Google)
- **packages/vector-store** - pgvector storage client
- **packages/widget** - Preact embeddable chat widget

### Key Patterns

**Multi-Tenancy**: All tenant data has `tenant_id` column with RLS policies. Use `X-Tenant-ID` header in API requests.

**Database Migrations**: Schema defined in `packages/db/src/schema/`. Run `db:generate` after schema changes, review the SQL, then `db:migrate`.

**Job Processing**: Workers pull jobs from BullMQ queues. Job types: `source.discover`, `source.fetch`, `chunk.create`, `embed.generate`.

**RAG Pipeline**: Hybrid retrieval (vector + keyword), heuristic reranking, citations with source attribution.

**AI Models**: Configured via Admin UI (not env vars). Supports multiple providers per tenant.

### Infrastructure
- **PostgreSQL 16** (port 5432) - Main database
- **PostgreSQL 16 + pgvector** (port 5433) - Vector storage
- **Redis 7** (port 6379) - Job queue and caching

### API Route Structure
Routes in `apps/api/src/routes/`:
- `auth.ts` - OIDC/local authentication
- `tenants.ts` - Tenant CRUD and memberships
- `knowledge-bases.ts` - KB management
- `sources.ts` - Source configuration
- `agents.ts` - Agent configuration with KB attachments
- `chat.ts` - Chat endpoint with streaming
- `widget.ts` - Widget config and public chat
- `admin/` - System admin routes (users, models, settings, analytics)

### Frontend Navigation
The web app uses state-based navigation (not React Router). Pages controlled via `currentPage` state in `App.tsx`. Add new pages to the `Page` type in `app-sidebar.tsx`.

## Environment Setup

Copy `.env.example` to `.env`. Key variables:
- `DATABASE_URL` - Main Postgres connection
- `VECTOR_DB_URL` - pgvector connection
- `REDIS_URL` - Redis connection
- `SESSION_SECRET` - JWT signing (32+ chars)
- `ADMIN_EMAIL/ADMIN_PASSWORD` - Initial admin user
