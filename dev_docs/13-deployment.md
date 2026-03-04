# Deployment & Operations

## Deployment Options

### Docker Compose (Staging / Small Production)

**Files:** `docker-compose.yml`, `docker/`

The full stack runs as 6 containers:

| Container | Image | Resources | Ports |
|-----------|-------|-----------|-------|
| `grounded-postgres` | postgres:16-alpine | — | 5433:5432 |
| `grounded-postgres-vector` | pgvector/pgvector:pg16 | — | 5434:5432 |
| `grounded-redis` | redis:7-alpine | — | 6380:6379 |
| `grounded-api` | Dockerfile.api | 0.5 CPU, 512MB | Internal |
| `grounded-ingestion` | Dockerfile.ingestion | 1 CPU, 1GB | Internal |
| `grounded-scraper` | Dockerfile.scraper | 1 CPU, 2GB | Internal |
| `grounded-web` | Dockerfile.web (nginx) | 0.25 CPU, 128MB | 8088:80 |

```bash
# Build and start
bun run docker:build
bun run docker:up

# View logs
bun run docker:logs

# Stop
bun run docker:down
```

**Required environment variables** (in `.env`):
- `POSTGRES_PASSWORD` — Main DB password
- `VECTOR_DB_PASSWORD` — Vector DB password  
- `SESSION_SECRET` — JWT signing secret (32+ chars)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — Initial admin user

### Kubernetes (Production)

**Files:** `k8s/`

Manifests provide:

| Manifest | Description |
|----------|-------------|
| `namespace.yaml` | `grounded` namespace |
| `configmap.yaml` | Non-sensitive configuration |
| `secrets.yaml` | Database URLs, API keys, session secret |
| `postgres.yaml` | StatefulSet for main PostgreSQL |
| `redis.yaml` | Deployment + Service for Redis |
| `api.yaml` | Deployment + Service + HPA for API |
| `web.yaml` | Deployment + Service for frontend (nginx) |
| `ingestion-worker.yaml` | Deployment for ingestion worker |
| `scraper-worker.yaml` | Deployment for scraper worker |
| `ingress.yaml` | Nginx Ingress routing |
| `network-policies.yaml` | Network isolation policies |
| `kustomization.yaml` | Kustomize overlay |

**Deploy:**
```bash
kubectl apply -k k8s/
```

**Scaling:**
```bash
kubectl scale -n grounded deployment/api --replicas=4
kubectl scale -n grounded deployment/ingestion-worker --replicas=4
kubectl scale -n grounded deployment/scraper-worker --replicas=2
```

**Ingress Routing:**
```
/api/*    → API service (port 3000)
/widget*  → API service (serves widget JS)
/chat/*   → API service (hosted chat)
/*        → Web service (port 80, nginx serving static files)
```

## Dockerfiles

| File | Base | Description |
|------|------|-------------|
| `Dockerfile.api` | bun | API server, includes migration runner |
| `Dockerfile.ingestion` | bun | Ingestion worker |
| `Dockerfile.scraper` | bun + Playwright | Scraper worker with Chromium |
| `Dockerfile.web` | nginx:alpine | Static frontend build |

**Entrypoint scripts** (`docker/`):
- `docker-entrypoint-api.sh` — Runs migrations, then starts API
- `docker-entrypoint-web.sh` — Injects runtime config (API_URL) into static build

## API Startup Sequence

When the API server starts (`apps/api/src/startup/index.ts`):

```
1. runMigrations()              — Apply pending Drizzle migrations
2. backfillPublicTokenHashes()  — Backfill missing token hashes (one-time)
3. seedSystemAdmin()            — Create admin user from env vars (if not exists)
4. initializeVectorStore()      — Connect to pgvector database
5. recoverOrphanedLocks()       — Clean up stuck test suite locks
6. startPeriodicRecovery()      — Start periodic lock recovery
7. recoverStuckSourceRuns()     — Mark stuck source runs as failed
8. startSourceRunRecovery()     — Start periodic stuck-run recovery
9. startHardDeleteScheduler()   — Start scheduler for hard deletions
10. startTestSuiteScheduler()   — Start scheduler for test suite runs
```

**Graceful shutdown** cleans up all schedulers on SIGTERM/SIGINT.

## Worker Configuration at Runtime

Workers fetch their configuration from the API:

```
Worker starts → GET /api/v1/internal/workers/settings → Apply settings
  ↓
Every 60s → Refresh settings (concurrency, fairness config, etc.)
```

**Security:** In production, set `INTERNAL_API_KEY` env var. Workers include this as a bearer token. In development, the endpoint is open.

**Settings priority:** Admin UI > Environment variables > Defaults

## Monitoring & Observability

### Structured Logs
All services output JSON logs (pino):
```json
{
  "level": "info",
  "service": "api",
  "requestId": "uuid",
  "durationMs": 42,
  "http": { "method": "POST", "path": "/api/v1/chat", "statusCode": 200 },
  "tenant": { "id": "uuid" },
  "operation": "chat",
  "outcome": "success"
}
```

### Health Check
```
GET /health → { "status": "ok", "timestamp": "...", "version": "0.1.0" }
```

### Key Metrics to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Chat latency | `chatEvents.latencyMs` | > 5s |
| Chat error rate | `chatEvents.status = 'error'` | > 5% |
| Source run failures | `sourceRuns.status = 'failed'` | Any |
| Embed queue depth | BullMQ `embed-chunks` waiting | > 1000 |
| Worker memory | Container metrics | > 80% |

### Tenant Health Alerts
Built-in email alerting system (`apps/api/src/services/health-alerts.ts`):
- Monitors error rates per tenant
- Quota warning thresholds
- Inactivity detection
- Configurable per tenant via `tenantAlertSettings`
- SMTP configured via Admin UI (Settings > Email)

### Test Regression Alerts
When test suite pass rate drops:
- Emails tenant owners/admins
- Configurable threshold per test suite (`alertThresholdPercent`)
- Includes details of newly failing test cases

## Backup & Recovery

### Database Backups
- Main PostgreSQL: Standard pg_dump / WAL archiving
- Vector DB: Same approach (separate pg_dump)
- Redis: Append-only file (AOF) persistence enabled by default

### Disaster Recovery Considerations
- Source content can be re-ingested from original URLs
- Vector embeddings can be regenerated (KB reindex feature)
- Conversation history (Redis) is ephemeral (1hr TTL) — not critical
- Audit logs and chat events should be backed up

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `CORS_ORIGINS` explicitly (not wildcard)
- [ ] Set `INTERNAL_API_KEY` for worker communication
- [ ] Set strong `SESSION_SECRET` (32+ chars)
- [ ] Configure SMTP for alert emails
- [ ] Set up database backups
- [ ] Configure monitoring/alerting
- [ ] Set resource limits on containers
- [ ] Enable TLS/HTTPS via ingress
- [ ] Review rate limit settings
- [ ] Set `LOG_SAMPLE_RATE` appropriately (0.1 for normal traffic)
- [ ] Consider managed PostgreSQL and Redis for production
- [ ] Set up network policies (K8s)
