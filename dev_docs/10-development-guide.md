# Development Guide

## Prerequisites

- [Bun](https://bun.sh/) (latest)
- [Docker](https://www.docker.com/) (for infrastructure services)
- Node.js 20+ (for some tooling compatibility)

## Environment Setup

### 1. Install Dependencies
```bash
bun install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` — the defaults work for local development. Key values to set:
- `SESSION_SECRET` — Any 32+ character string
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — Your initial admin login

### 3. Start Infrastructure
```bash
bun run docker:dev
```
Starts PostgreSQL (5432), pgvector (5433), and Redis (6379).

### 4. Run Migrations
```bash
bun run db:migrate
```

### 5. Start Services
```bash
# All services at once:
bun run dev

# Or individually:
bun run dev:api        # API server (port 3001)
bun run dev:web        # Web UI (port 5173)
bun run dev:ingestion  # Ingestion worker
bun run dev:scraper    # Scraper worker
```

### 6. Access the App
- Web UI: `http://localhost:5173`
- API: `http://localhost:3001`
- Drizzle Studio: `bun run db:studio`

## Common Development Tasks

### Modifying Database Schema

1. Edit schema files in `packages/db/src/schema/`
2. Generate migration:
   ```bash
   bun run db:generate
   ```
3. Review generated SQL in `migrations/`
4. Apply migration:
   ```bash
   bun run db:migrate
   ```
5. For quick iteration (dev only):
   ```bash
   bun run db:push   # Pushes schema directly, no migration file
   ```

### Adding an API Route

1. Create or edit route file in `apps/api/src/routes/`
2. Define Zod validation schemas in `apps/api/src/modules/<domain>/schema.ts`
3. Add route to `apps/api/src/routes/index.ts` (mount on v1 router)
4. Export from `apps/api/src/modules/index.ts`
5. Add types to `packages/shared/src/types/` if shared across apps

**Route template:**
```typescript
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireTenantRole } from "../middleware/auth";

const routes = new Hono();

routes.use("*", requireAuth());

routes.get("/", requireTenantRole("viewer"), async (c) => {
  const auth = c.get("auth");
  // ... query logic
  return c.json({ data: results });
});

routes.post("/", requireTenantRole("admin"), async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.parse(body);
  // ... create logic
  return c.json({ data: created }, 201);
});

export { routes as myRoutes };
```

### Adding a Frontend Page

1. Create component: `apps/web/src/pages/MyPage.tsx`
2. Register in `apps/web/src/app/page-registry.ts`
3. Add sidebar link in `apps/web/src/components/app-sidebar.tsx`
4. Create API functions in `apps/web/src/lib/api/`
5. Use TanStack Query for data fetching

### Adding a Worker Job

1. Define job payload type in `packages/shared/src/types/index.ts`
2. Create Zod schema for the payload
3. Add queue in `packages/queue/src/index.ts` (if new queue needed)
4. Create job handler in the appropriate worker's `jobs/` directory
5. Register worker in the worker's `index.ts`

### Adding an AI Model Provider

Models are managed via the Admin UI at runtime, but to add a new provider type:
1. Add provider type to `packages/ai-providers/src/types.ts`
2. Implement provider factory in `packages/ai-providers/src/registry.ts`
3. Add to `ProviderType` union in `packages/db/src/schema/ai-models.ts`

## Code Quality

```bash
# Lint (oxlint)
bun run lint

# Type check all packages
bun run typecheck

# Run all tests
bun run test

# Build all packages
bun run build
```

## Debugging

### API Server
- Logs output to stdout (structured JSON in production, pretty in dev)
- Set `LOG_LEVEL=debug` in `.env` for verbose output
- Use `bun run db:studio` to inspect database state

### Workers
- Worker logs include job IDs and tenant context
- Check Redis queues: `redis-cli LRANGE bull:page-fetch:wait 0 -1`
- BullMQ dashboard: Consider adding [bull-board](https://github.com/felixmosh/bull-board) for queue monitoring

### Chat Issues
- Check `chatEvents` table for error records
- Verify agent has KB attachments: `agentKbs` table
- Verify chunks exist: `kbChunks` table for the KB
- Verify embeddings exist: check pgvector DB
- Check conversation history: `redis-cli GET conv:{tenantId}:{agentId}:{convId}`

## Environment Variables Reference

See `.env.example` for the full list. Key categories:

| Category | Variables |
|----------|----------|
| Database | `DATABASE_URL`, `VECTOR_DB_URL` |
| Redis | `REDIS_URL` |
| Auth | `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, OIDC settings |
| API | `PORT`, `CORS_ORIGINS`, `API_URL` |
| Workers | `WORKER_CONCURRENCY`, `EMBED_WORKER_CONCURRENCY`, fairness settings |
| Logging | `LOG_LEVEL`, `LOG_SAMPLE_RATE` |
| External | `FIRECRAWL_API_KEY` |

## Docker Deployment

### Development
```bash
bun run docker:dev         # Infrastructure only
bun run docker:dev:down    # Stop infrastructure
```

### Production
```bash
bun run docker:build       # Build all images
bun run docker:up          # Start full stack
bun run docker:down        # Stop all
bun run docker:logs        # View logs
```

### Kubernetes
Manifests in `k8s/` directory. Separate deployments for:
- API server (with HPA)
- Ingestion worker
- Scraper worker
- Web UI (nginx)

## Git Workflow

- Feature branches off `main`
- PRs require passing CI (lint + typecheck + test)
- Database migrations should be reviewed carefully
- Keep CHANGELOG.md updated for significant changes
