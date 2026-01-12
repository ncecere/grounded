# Project Structure

This document provides a detailed overview of the Grounded monorepo structure.

## Root Directory

```
grounded/
├── apps/                      # Application packages
│   ├── api/                   # REST API server
│   ├── web/                   # React admin dashboard
│   ├── ingestion-worker/      # Document processing worker
│   └── scraper-worker/        # Web scraping worker
├── packages/                  # Shared library packages
│   ├── db/                    # Database schema and client
│   ├── shared/                # Common types and utilities
│   ├── queue/                 # Job queue abstraction
│   ├── ai-providers/          # LLM provider adapters
│   ├── embeddings/            # Embedding generation
│   ├── vector-store/          # Vector database client
│   ├── llm/                   # RAG and response generation
│   ├── crawl-state/           # Web crawling state
│   └── widget/                # Embeddable chat widget
├── docker/                    # Docker configuration
│   ├── Dockerfile.api
│   ├── Dockerfile.web
│   ├── Dockerfile.ingestion
│   ├── Dockerfile.scraper
│   ├── docker-entrypoint-api.sh
│   ├── docker-entrypoint-web.sh
│   └── nginx.conf
├── k8s/                       # Kubernetes manifests
├── migrations/                # SQL migration files
├── docs/                      # Documentation
│   ├── development/           # Developer documentation
│   └── users/                 # User documentation
├── docker-compose.yml         # Production Docker Compose
├── docker-compose.dev.yml     # Development infrastructure
├── package.json               # Root package configuration
├── tsconfig.json              # TypeScript configuration
├── .env.example               # Environment template
└── CLAUDE.md                  # AI assistant context
```

## Applications

### API Server (`apps/api`)

The main REST API server built with Hono.

```
apps/api/
├── src/
│   ├── index.ts               # Application entry point
│   ├── routes/                # API route handlers
│   │   ├── auth.ts            # Authentication endpoints
│   │   ├── tenants.ts         # Tenant management
│   │   ├── knowledge-bases.ts # KB CRUD operations
│   │   ├── sources.ts         # Data source management
│   │   ├── uploads.ts         # File upload handling
│   │   ├── agents.ts          # Agent configuration
│   │   ├── chat.ts            # Authenticated chat
│   │   ├── widget.ts          # Widget public endpoints
│   │   ├── chat-endpoint.ts   # Public chat endpoints
│   │   ├── analytics.ts       # Usage analytics
│   │   └── admin/             # System admin routes
│   │       ├── settings.ts    # Global settings
│   │       ├── models.ts      # LLM configuration
│   │       ├── users.ts       # User management
│   │       ├── shared-kbs.ts  # Shared KB management
│   │       ├── dashboard.ts   # Admin dashboard
│   │       └── analytics.ts   # System analytics
│   ├── middleware/            # Express middleware
│   │   ├── auth.ts            # JWT authentication
│   │   ├── tenant.ts          # Tenant context
│   │   ├── rate-limit.ts      # Rate limiting
│   │   └── error-handler.ts   # Error handling
│   └── services/              # Business logic services
│       ├── email.ts           # Email notifications
│       └── health.ts          # Health checks
├── package.json
└── tsconfig.json
```

### Web Dashboard (`apps/web`)

React 19 single-page application.

```
apps/web/
├── src/
│   ├── main.tsx               # Application entry
│   ├── App.tsx                # Root component & routing
│   ├── pages/                 # Page components
│   │   ├── Login.tsx          # Authentication
│   │   ├── Chat.tsx           # Chat interface
│   │   ├── Agents.tsx         # Agent management
│   │   ├── KnowledgeBases.tsx # KB management
│   │   ├── Sources.tsx        # Source management
│   │   ├── Analytics.tsx      # Usage analytics
│   │   ├── TenantSettings.tsx # Tenant configuration
│   │   ├── SharedKbDetail.tsx # Shared KB view
│   │   ├── AdminDashboard.tsx # System dashboard
│   │   ├── AdminSettings.tsx  # System settings
│   │   ├── AdminModels.tsx    # Model configuration
│   │   ├── AdminUsers.tsx     # User management
│   │   ├── AdminTenants.tsx   # Tenant management
│   │   ├── AdminSharedKBs.tsx # Shared KB admin
│   │   └── AdminAnalytics.tsx # System analytics
│   ├── components/            # Reusable components
│   │   ├── ui/                # shadcn/ui components
│   │   ├── app-sidebar.tsx    # Main navigation
│   │   ├── nav-main.tsx       # Navigation menu
│   │   ├── nav-user.tsx       # User menu
│   │   └── tenant-switcher.tsx # Tenant selector
│   ├── lib/                   # Utilities
│   │   ├── api.ts             # API client
│   │   └── utils.ts           # Helper functions
│   └── hooks/                 # Custom React hooks
├── public/                    # Static assets
│   ├── grounded-logo.png      # Application logo
│   ├── widget.js              # Chat widget bundle
│   └── test-widget.html       # Widget test page
├── index.html                 # HTML template
├── package.json
├── tsconfig.json
├── vite.config.ts             # Vite configuration
└── tailwind.config.js         # Tailwind CSS config
```

### Ingestion Worker (`apps/ingestion-worker`)

Background processor for document ingestion.

```
apps/ingestion-worker/
├── src/
│   ├── index.ts               # Worker entry point
│   ├── processors/            # Job processors
│   │   ├── discover-source.ts # URL discovery
│   │   ├── fetch-page.ts      # Page fetching
│   │   ├── create-chunks.ts   # Text chunking
│   │   └── embed-chunks.ts    # Embedding generation
│   └── parsers/               # Document parsers
│       ├── pdf.ts             # PDF extraction
│       ├── docx.ts            # Word documents
│       ├── xlsx.ts            # Excel spreadsheets
│       └── text.ts            # Plain text/markdown
├── package.json
└── tsconfig.json
```

### Scraper Worker (`apps/scraper-worker`)

Web crawling with Playwright.

```
apps/scraper-worker/
├── src/
│   ├── index.ts               # Worker entry point
│   ├── crawler.ts             # Main crawler logic
│   ├── strategies/            # Crawl strategies
│   │   ├── single.ts          # Single page
│   │   ├── list.ts            # URL list
│   │   ├── sitemap.ts         # Sitemap crawl
│   │   └── domain.ts          # Domain crawl
│   └── extractors/            # Content extractors
│       ├── html.ts            # HTML content
│       └── metadata.ts        # Page metadata
├── package.json
└── tsconfig.json
```

## Shared Packages

### Database (`packages/db`)

Drizzle ORM schema and migrations.

```
packages/db/
├── src/
│   ├── index.ts               # Package exports
│   ├── client.ts              # Database client
│   └── schema/                # Table definitions
│       ├── index.ts           # Schema exports
│       ├── tenants.ts         # Tenant tables
│       ├── users.ts           # User tables
│       ├── knowledge.ts       # KB tables
│       ├── sources.ts         # Source tables
│       ├── chunks.ts          # Chunk tables
│       ├── agents.ts          # Agent tables
│       ├── models.ts          # Model config tables
│       ├── analytics.ts       # Analytics tables
│       └── settings.ts        # Settings tables
├── drizzle/                   # Generated migrations
├── drizzle.config.ts          # Drizzle configuration
├── package.json
└── tsconfig.json
```

### Shared Types (`packages/shared`)

Common types and utilities.

```
packages/shared/
├── src/
│   ├── index.ts               # Package exports
│   ├── types/                 # TypeScript types
│   │   ├── index.ts           # Type exports
│   │   ├── api.ts             # API types
│   │   ├── chat.ts            # Chat types
│   │   └── widget.ts          # Widget types
│   └── utils/                 # Utility functions
│       ├── id.ts              # ID generation
│       └── validation.ts      # Validation helpers
├── package.json
└── tsconfig.json
```

### Queue (`packages/queue`)

BullMQ job queue abstraction.

```
packages/queue/
├── src/
│   ├── index.ts               # Package exports
│   ├── client.ts              # Queue client
│   ├── jobs.ts                # Job definitions
│   └── conversation.ts        # Conversation memory
├── package.json
└── tsconfig.json
```

### AI Providers (`packages/ai-providers`)

Multi-provider LLM adapter.

```
packages/ai-providers/
├── src/
│   ├── index.ts               # Package exports
│   ├── registry.ts            # Provider registry
│   ├── providers/             # Provider implementations
│   │   ├── openai.ts          # OpenAI
│   │   ├── anthropic.ts       # Anthropic
│   │   ├── google.ts          # Google AI
│   │   └── openai-compat.ts   # OpenAI-compatible
│   └── types.ts               # Provider types
├── package.json
└── tsconfig.json
```

### Embeddings (`packages/embeddings`)

Text embedding generation.

```
packages/embeddings/
├── src/
│   ├── index.ts               # Package exports
│   └── generator.ts           # Embedding generator
├── package.json
└── tsconfig.json
```

### Vector Store (`packages/vector-store`)

Vector database operations.

```
packages/vector-store/
├── src/
│   ├── index.ts               # Package exports
│   ├── registry.ts            # Store registry
│   ├── stores/                # Store implementations
│   │   └── pgvector.ts        # pgvector adapter
│   └── types.ts               # Store types
├── package.json
└── tsconfig.json
```

### LLM (`packages/llm`)

RAG pipeline and response generation.

```
packages/llm/
├── src/
│   ├── index.ts               # Package exports
│   ├── rag.ts                 # RAG implementation
│   ├── prompts.ts             # System prompts
│   └── citations.ts           # Citation extraction
├── package.json
└── tsconfig.json
```

### Widget (`packages/widget`)

Embeddable chat widget built with Preact.

```
packages/widget/
├── src/
│   ├── index.tsx              # Widget entry
│   ├── components/            # UI components
│   │   ├── Widget.tsx         # Main widget
│   │   ├── Message.tsx        # Chat message
│   │   └── Icons.tsx          # Icon components
│   ├── hooks/                 # Custom hooks
│   │   └── useChat.ts         # Chat state hook
│   ├── styles.ts              # CSS-in-JS styles
│   └── types.ts               # Widget types
├── dist/                      # Built output
│   └── widget.js              # Production bundle
├── package.json
├── tsconfig.json
└── vite.config.ts             # Build configuration
```

## Configuration Files

### Root Configuration

| File | Purpose |
|------|---------|
| `package.json` | Workspace definition and scripts |
| `tsconfig.json` | Base TypeScript configuration |
| `.env.example` | Environment variable template |
| `bunfig.toml` | Bun runtime configuration |
| `.gitignore` | Git ignore patterns |
| `.dockerignore` | Docker ignore patterns |

### Docker Configuration

| File | Purpose |
|------|---------|
| `docker/Dockerfile.api` | API server image |
| `docker/Dockerfile.web` | Web frontend image |
| `docker/Dockerfile.ingestion` | Ingestion worker image |
| `docker/Dockerfile.scraper` | Scraper worker image |
| `docker/nginx.conf` | Nginx configuration for web |
| `docker-compose.yml` | Production stack |
| `docker-compose.dev.yml` | Development infrastructure |

### Kubernetes Configuration

| File | Purpose |
|------|---------|
| `k8s/namespace.yaml` | Kubernetes namespace |
| `k8s/configmap.yaml` | Configuration |
| `k8s/secrets.yaml` | Secrets template |
| `k8s/postgres.yaml` | PostgreSQL StatefulSet |
| `k8s/redis.yaml` | Redis deployment |
| `k8s/api.yaml` | API deployment |
| `k8s/web.yaml` | Web deployment |
| `k8s/ingestion-worker.yaml` | Worker deployment |
| `k8s/scraper-worker.yaml` | Scraper deployment |
| `k8s/ingress.yaml` | Ingress configuration |

## Import Conventions

### Package Imports

All packages use the `@grounded/` scope:

```typescript
import { db } from "@grounded/db";
import { generateId } from "@grounded/shared";
import { getQueue } from "@grounded/queue";
import { generateEmbedding } from "@grounded/embeddings";
import { getVectorStore } from "@grounded/vector-store";
import { generateRAGResponse } from "@grounded/llm";
```

### Path Aliases

The web app uses `@/` alias for src directory:

```typescript
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
```

---

Next: [Database Schema](./database-schema.md)
