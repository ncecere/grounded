# Grounded

A multi-tenant RAG (Retrieval-Augmented Generation) platform for building AI chat agents grounded in your knowledge bases. Emphasizes strict retrieval with proper citations and no hallucinations.

## Features

- **Multi-tenant Architecture** - Complete data isolation with PostgreSQL row-level security (RLS)
- **Knowledge Base Management** - Create and manage knowledge bases from web crawling or file uploads
- **Web Crawling** - Automated content ingestion with multiple modes:
  - Single page, sitemap-based, or full domain crawling
  - URL pattern filtering (include/exclude)
  - Scheduled re-crawling (daily, weekly, monthly)
- **File Uploads** - Support for PDF, Word, Excel, PowerPoint, text, HTML, CSV, and JSON
- **AI Agents** - Configurable chat agents with:
  - Custom system prompts and personas
  - Multiple LLM providers (OpenAI, Anthropic, Google, OpenAI-compatible)
  - Retrieval tuning (top-k, reranking, citation limits)
  - Custom branding and welcome messages
- **Strict RAG Pipeline** - Hybrid vector + keyword search with citations ensuring responses are grounded in source content
- **Embeddable Chat Widget** - Preact-based widget for any website with:
  - Customizable appearance and branding
  - Domain restrictions
  - Streaming responses with inline citations
- **Hosted Chat Pages** - Shareable standalone chat URLs
- **REST API** - Full programmatic access with streaming support
- **Analytics** - Query volume, response times, and usage metrics

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **API**: [Hono](https://hono.dev)
- **Frontend**: React 19, Vite, TanStack Query, Radix UI, Tailwind CSS v4
- **Database**: PostgreSQL 16 with [Drizzle ORM](https://orm.drizzle.team)
- **Vector Store**: PostgreSQL + [pgvector](https://github.com/pgvector/pgvector)
- **Queue**: [BullMQ](https://bullmq.io) + Redis
- **AI**: [Vercel AI SDK](https://sdk.vercel.ai) with multi-provider support
- **Widget**: Preact (lightweight embeddable)

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Docker](https://docker.com) and Docker Compose

### Development Setup

1. **Clone and install dependencies**
   ```bash
   git clone <repo-url>
   cd grounded
   bun install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Start infrastructure**
   ```bash
   bun run docker:dev
   ```

4. **Initialize database**
   ```bash
   bun run db:push
   ```

5. **Start development servers**
   ```bash
   bun run dev
   ```

   This starts:
   - API server at `http://localhost:3001`
   - Web UI at `http://localhost:8088`
   - Ingestion worker
   - Scraper worker

6. **Login** with the admin credentials from your `.env` file

### Docker Deployment

```bash
# Build all images
bun run docker:build

# Start full stack
docker compose up -d

# View logs
docker compose logs -f
```

## Project Structure

```
grounded/
├── apps/
│   ├── api/              # Hono REST API
│   ├── web/              # React admin UI
│   ├── ingestion-worker/ # Document processing
│   └── scraper-worker/   # Web scraping (Playwright)
├── packages/
│   ├── db/               # Drizzle schema & client
│   ├── queue/            # BullMQ abstraction
│   ├── ai-providers/     # Multi-provider AI SDK
│   ├── vector-store/     # pgvector client
│   ├── llm/              # RAG response generation
│   ├── embeddings/       # Text embedding
│   └── widget/           # Embeddable chat widget
├── docker/               # Dockerfiles & configs
├── k8s/                  # Kubernetes manifests
└── migrations/           # SQL migrations
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `VECTOR_DB_URL` | pgvector database connection | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `SESSION_SECRET` | JWT signing secret (32+ chars) | Yes |
| `ADMIN_EMAIL` | Initial admin user email | Yes |
| `ADMIN_PASSWORD` | Initial admin user password | Yes |
| `CORS_ORIGINS` | Allowed CORS origins | No |
| `OIDC_*` | SSO configuration | No |
| `FIRECRAWL_API_KEY` | Firecrawl API for scraping | No |

### AI Models

LLM and embedding models are configured via the Admin UI (Settings > AI Models), not environment variables. Supported providers:

- **OpenAI** - GPT-4o, GPT-4o-mini, text-embedding-3-small/large
- **Anthropic** - Claude 3.5 Sonnet, Claude 3 Opus/Haiku
- **Google** - Gemini Pro
- **OpenAI-compatible** - Groq, Together, Ollama, local models

## Commands

```bash
# Development
bun run dev              # Start all services
bun run dev:api          # API only
bun run dev:web          # Web UI only

# Database
bun run db:generate      # Generate migrations
bun run db:migrate       # Apply migrations
bun run db:push          # Push schema (dev)
bun run db:studio        # Open Drizzle Studio

# Build
bun run build            # Build all packages
bun run typecheck        # TypeScript checking

# Docker
bun run docker:dev       # Start infrastructure
bun run docker:build     # Build images
bun run docker:up        # Start full stack
bun run docker:down      # Stop containers
```

## API Overview

### Authentication
- `POST /api/v1/auth/login` - Local login
- `GET /api/v1/auth/oidc/login` - SSO login
- `POST /api/v1/auth/logout` - Logout

### Knowledge Bases
- `GET/POST /api/v1/knowledge-bases` - List/create KBs
- `GET/PUT/DELETE /api/v1/knowledge-bases/:id` - KB operations
- `POST /api/v1/knowledge-bases/:id/sources` - Add sources

### Agents
- `GET/POST /api/v1/agents` - List/create agents
- `PUT /api/v1/agents/:id/knowledge-bases` - Attach KBs

### Chat
- `POST /api/v1/chat/:agentId` - Send message
- `POST /api/v1/chat/:agentId/stream` - Streaming chat

### Widget
- `GET /api/v1/widget/:token/config` - Widget config
- `POST /api/v1/widget/:token/chat/stream` - Widget chat

## Embedding the Widget

```html
<script src="https://your-domain.com/widget.js"></script>
<script>
  Grounded.init({
    token: 'your-widget-token',
    position: 'bottom-right'
  });
</script>
```

## Architecture

### Data Flow

1. **Ingestion**: Sources (URLs/files) → Scraper → Chunks → Embeddings → Vector DB
2. **Query**: User question → Embedding → Hybrid search → Rerank → LLM → Response with citations

### Multi-tenancy

All data includes `tenant_id` with PostgreSQL RLS policies. API requests use JWT tokens with embedded tenant context.

### Job Processing

Background workers process BullMQ jobs:
- `source.discover` - Find pages to crawl
- `source.fetch` - Fetch and extract content
- `chunk.create` - Split into chunks
- `embed.generate` - Generate embeddings

## License

MIT
