# Grounded — Developer Documentation

Welcome to the Grounded developer docs. Start with the overview and work through the docs in order, or jump to a specific topic.

## Table of Contents

| # | Document | Description |
|---|----------|-------------|
| 01 | [Project Overview](./01-overview.md) | What is Grounded, tech stack, monorepo structure, quick start |
| 02 | [Architecture](./02-architecture.md) | System diagram, request flows, auth, infrastructure, code patterns |
| 03 | [Data Model](./03-data-model.md) | All database tables, relationships, schemas, soft delete pattern |
| 04 | [API Reference](./04-api-reference.md) | Every API endpoint grouped by domain, request/response formats |
| 05 | [Ingestion Pipeline](./05-ingestion-pipeline.md) | 6-stage pipeline (discover → index), queue config, error handling |
| 06 | [RAG & Chat](./06-rag-and-chat.md) | Simple vs Advanced RAG, hybrid search, caching, widget integration |
| 07 | [Frontend](./07-frontend.md) | React admin UI, navigation, state management, adding pages |
| 08 | [Shared Packages](./08-packages.md) | All `@grounded/*` packages: db, queue, ai-providers, vector-store, etc. |
| 09 | [Testing](./09-testing.md) | Running tests, test structure, in-app agent test suites |
| 10 | [Development Guide](./10-development-guide.md) | Setup, common tasks, debugging, deployment, git workflow |
| 11 | [Glossary](./11-glossary.md) | Key terms and concepts |
| 12 | [Error Handling & Middleware](./12-error-handling.md) | Error classes, middleware stack, rate limiting, SSE streaming, logging |
| 13 | [Deployment & Operations](./13-deployment.md) | Docker Compose, Kubernetes, startup sequence, monitoring, production checklist |
| 14 | [Security Model](./14-security.md) | Multi-tenancy isolation, auth methods, secrets, audit trail, security checklist |
| 15 | [Workers & Fairness](./15-workers-and-fairness.md) | Worker architecture, job flow, fairness scheduler, settings management |
| 16 | [Tools & Agentic Mode](./16-tools-and-agentic-mode.md) | Tool types, agent capabilities, MCP connections, built-in tools |
| 17 | [Test Runner & Evaluation](./17-test-runner-and-evaluation.md) | Test runner, 3 check types, A/B experiments, prompt analysis |
| 18 | [Health Alerts & Background Services](./18-health-alerts-and-background-services.md) | Health monitoring, email, caching, hard-delete, source recovery |
| 19 | [Chat Endpoints & Retrieval](./19-chat-endpoints-and-retrieval.md) | 4 chat routes, token system, hybrid search deep dive, RRF, SSE |
| 20 | [Audit System](./20-audit-system.md) | 30 audit actions, 12 resource types, change tracking, query API |
| 21 | [API Request & Response Examples](./21-api-request-response-examples.md) | Payload examples for auth, KBs, sources, agents, chat, test suites |
| 22 | [Kubernetes Deployment](./22-kubernetes-deployment.md) | K8s manifest walkthrough, network policies, production customization |
| 23 | [Code Conventions](./23-conventions.md) | Naming, file structure, DB patterns, API format, frontend patterns |
| 24 | [Architecture Decisions](./24-architecture-decisions.md) | 9 ADRs: separate vector DB, BullMQ, state nav, Bun, hybrid search, RLS, Shadow DOM |

## Quick Links

- **New to the project?** Start with [Project Overview](./01-overview.md) → [Architecture](./02-architecture.md)
- **Setting up your dev environment:** [Development Guide](./10-development-guide.md)
- **Understanding the data:** [Data Model](./03-data-model.md)
- **Working on the API:** [API Reference](./04-api-reference.md) → [Error Handling](./12-error-handling.md)
- **Working on the frontend:** [Frontend](./07-frontend.md)
- **How chat/RAG works:** [RAG & Chat](./06-rag-and-chat.md) → [Chat Endpoints & Retrieval](./19-chat-endpoints-and-retrieval.md)
- **How testing works:** [Test Runner & Evaluation](./17-test-runner-and-evaluation.md)
- **How tools work:** [Tools & Agentic Mode](./16-tools-and-agentic-mode.md)
- **How ingestion works:** [Ingestion Pipeline](./05-ingestion-pipeline.md) → [Workers & Fairness](./15-workers-and-fairness.md)
- **Background services:** [Health Alerts & Background Services](./18-health-alerts-and-background-services.md)
- **Deploying to production:** [Deployment](./13-deployment.md) → [Kubernetes](./22-kubernetes-deployment.md) → [Security](./14-security.md)
- **Why decisions were made:** [Architecture Decisions](./24-architecture-decisions.md)
- **Confused by a term?** [Glossary](./11-glossary.md)

## Source Code Map

```
grounded/
├── apps/api/                → Hono REST API (port 3001)
├── apps/web/                → React admin UI (port 5173)
├── apps/ingestion-worker/   → Content processing worker
├── apps/scraper-worker/     → Web scraping worker
├── packages/db/             → Database schema & client
├── packages/shared/         → Types, constants, Zod schemas
├── packages/queue/          → BullMQ queues & Redis helpers
├── packages/ai-providers/   → Multi-provider AI model registry
├── packages/embeddings/     → Embedding generation
├── packages/vector-store/   → pgvector client
├── packages/logger/         → Structured logging
├── packages/widget/         → Embeddable Preact chat widget
├── migrations/              → SQL migration files
├── docker/                  → Dockerfiles & configs
├── k8s/                     → Kubernetes manifests
└── dev_docs/                → This documentation
```
