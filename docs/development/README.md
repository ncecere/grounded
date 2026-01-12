# Grounded - Development Documentation

Welcome to the Grounded development documentation. This guide covers everything you need to know to contribute to and work on the Grounded platform.

## What is Grounded?

Grounded is an enterprise RAG (Retrieval-Augmented Generation) platform that enables organizations to build AI-powered chat agents backed by their own knowledge bases. The platform emphasizes **strict RAG with no hallucinations** - responses are always grounded in the provided knowledge sources.

## Documentation Index

### Getting Started

- **[Development Setup](./setup.md)** - Set up your local development environment
- **[Architecture Overview](./architecture.md)** - Understand the system design and components
- **[Project Structure](./project-structure.md)** - Navigate the monorepo codebase

### Technical Reference

- **[Database Schema](./database-schema.md)** - Data models and relationships
- **[API Reference](./api-reference.md)** - REST API endpoints and usage
- **[Worker Processes](./workers.md)** - Background job processing

### Development Guides

- **[Adding Features](./adding-features.md)** - Guide to implementing new functionality
- **[Testing](./testing.md)** - Testing strategies and tools
- **[Debugging](./debugging.md)** - Troubleshooting common issues

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/ncecere/grounded.git
cd grounded

# 2. Install dependencies
bun install

# 3. Start infrastructure (Postgres, pgvector, Redis)
bun run docker:dev

# 4. Set up environment
cp .env.example .env
# Edit .env with your configuration

# 5. Push database schema
bun run db:push

# 6. Start development servers
bun run dev
```

## Tech Stack Overview

| Component | Technology |
|-----------|------------|
| Runtime | [Bun](https://bun.sh) |
| API Framework | [Hono](https://hono.dev) |
| Database | PostgreSQL 16 + [Drizzle ORM](https://orm.drizzle.team) |
| Vector Store | PostgreSQL with [pgvector](https://github.com/pgvector/pgvector) |
| Frontend | React 19 + TypeScript + [Vite](https://vitejs.dev) |
| UI Components | [Radix UI](https://www.radix-ui.com) + [Tailwind CSS](https://tailwindcss.com) |
| Queue System | [BullMQ](https://bullmq.io) + Redis |
| LLM Integration | [Vercel AI SDK](https://sdk.vercel.ai) |
| Web Scraping | [Playwright](https://playwright.dev) |

## Key Design Principles

### 1. Multi-Tenancy First
Every piece of data is associated with a tenant. Row-level security (RLS) policies enforce data isolation at the database level.

### 2. Strict RAG
Responses are always grounded in knowledge base content. The system is designed to minimize hallucinations by requiring source attribution.

### 3. Provider Agnostic
The platform supports multiple LLM providers (OpenAI, Anthropic, Google, and OpenAI-compatible APIs) with a unified interface.

### 4. Modular Architecture
The monorepo structure separates concerns into focused packages that can be developed and tested independently.

## Getting Help

- Check the [Debugging Guide](./debugging.md) for common issues
- Review existing [GitHub Issues](https://github.com/ncecere/grounded/issues)
- Join our development discussions

## Contributing

We welcome contributions! Please read our contribution guidelines before submitting pull requests.

---

Next: [Development Setup](./setup.md)
