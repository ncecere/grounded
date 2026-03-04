# Kubernetes Deployment

Grounded ships with a complete Kubernetes deployment using Kustomize. This document walks through every manifest.

## Directory Structure

```
k8s/
├── kustomization.yaml        ← Entry point — lists all resources, image overrides
├── namespace.yaml             ← Creates "grounded" namespace
├── configmap.yaml             ← Non-secret environment variables
├── secrets.yaml               ← Credentials (DATABASE_URL, SESSION_SECRET, etc.)
├── postgres.yaml              ← StatefulSet + Service (pgvector)
├── redis.yaml                 ← Deployment + Service
├── api.yaml                   ← Deployment + Service (2 replicas)
├── web.yaml                   ← Deployment + Service (nginx serving SPA)
├── ingestion-worker.yaml      ← Deployment (1 replica)
├── scraper-worker.yaml        ← Deployment (1 replica)
├── ingress.yaml               ← Ingress (nginx controller + TLS)
└── network-policies.yaml      ← Network segmentation (5 policies)
```

## Quick Start

```bash
# 1. Edit secrets
vi k8s/secrets.yaml    # Set DATABASE_URL, SESSION_SECRET, ADMIN_EMAIL, etc.

# 2. Edit ingress
vi k8s/ingress.yaml    # Set your domain (replace grounded.example.com)

# 3. Override image names in kustomization.yaml
vi k8s/kustomization.yaml    # Point to your container registry

# 4. Deploy
kubectl apply -k k8s/
```

---

## Manifest Walkthrough

### Namespace

Creates a dedicated `grounded` namespace with a label for network policy targeting.

### ConfigMap (`grounded-config`)

Non-sensitive environment variables shared by all pods:

| Key | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | production | |
| `PORT` | 3000 | API server port |
| `POSTGRES_DB` | grounded | Database name |
| `POSTGRES_USER` | grounded | Database user |
| `REDIS_URL` | redis://redis:6379 | In-cluster Redis |

AI model config (API keys, model names) is managed via the Admin UI, not env vars.

### Secrets (`grounded-secrets`)

| Key | Purpose | Notes |
|-----|---------|-------|
| `POSTGRES_PASSWORD` | DB password | **Change from default** |
| `DATABASE_URL` | Full Postgres connection string | Includes password |
| `SESSION_SECRET` | JWT signing key | Random string, 32+ chars |
| `OIDC_ISSUER_URL` | SSO issuer URL | Optional |
| `OIDC_CLIENT_ID` | SSO client ID | Optional |
| `OIDC_CLIENT_SECRET` | SSO client secret | Optional |
| `OIDC_REDIRECT_URI` | SSO callback URL | Optional |
| `ADMIN_EMAIL` | Initial admin user | Only needed on first deploy |
| `ADMIN_PASSWORD` | Initial admin password | Only needed on first deploy |
| `INTERNAL_API_KEY` | Worker → API auth | Set for production |

> **Security:** In production, use Sealed Secrets, External Secrets, or a vault instead of plain `stringData`.

### PostgreSQL (StatefulSet)

- **Image:** `pgvector/pgvector:pg16` — PostgreSQL 16 with pgvector extension
- **Replicas:** 1 (single-node; for HA, use a managed database service)
- **Storage:** 10Gi PVC via `volumeClaimTemplates`
- **Probes:** `pg_isready -U grounded` (liveness: 30s delay, readiness: 5s delay)
- **Resources:** 256Mi–1Gi RAM, 250m–1000m CPU

> **Note:** This K8s manifest uses a single Postgres instance for both the main DB and vector storage (with pgvector extension). The dev setup uses two separate instances.

### Redis (Deployment)

- **Image:** `redis:7-alpine`
- **Persistence:** `appendonly yes` on `emptyDir` (data lost on pod restart)
- **Resources:** 64Mi–256Mi RAM, 50m–250m CPU
- **Probes:** `redis-cli ping`

> **Production:** For persistence, replace `emptyDir` with a PVC or use a managed Redis.

### API (Deployment)

- **Replicas:** 2 (for availability)
- **Security context:** Non-root (UID 1000), drop all capabilities
- **Env:** ConfigMap + Secrets (DATABASE_URL, SESSION_SECRET, OIDC, ADMIN creds)
- **Resources:** 256Mi–1Gi RAM, 250m–1000m CPU
- **Probes:** `GET /health` (liveness: 30s, readiness: 5s)
- **Port:** 3000

### Web (Deployment)

- **Replicas:** 2
- **Image:** nginx serving the built React SPA
- **Port:** 80
- **Resources:** 64Mi–256Mi RAM, 50m–250m CPU
- **Probes:** `GET /` on port 80

### Ingestion Worker (Deployment)

- **Replicas:** 1 (scale based on queue depth)
- **Env:** Same as API (needs DATABASE_URL, REDIS_URL, INTERNAL_API_KEY)
- **Resources:** 256Mi–1Gi RAM, 250m–1000m CPU
- **No probes** (background worker, no HTTP endpoint)

### Scraper Worker (Deployment)

- **Replicas:** 1
- **Special:** Needs Playwright browsers; uses larger resource limits
- **Resources:** 512Mi–2Gi RAM, 500m–2000m CPU
- **No probes**

### Ingress

- **Controller:** nginx ingress class
- **TLS:** Let's Encrypt via cert-manager (`cluster-issuer: letsencrypt-prod`)
- **Annotations:**
  - `proxy-body-size: 50m` — For file uploads
  - `proxy-read-timeout: 3600` — For SSE streaming (1 hour)
  - `proxy-buffering: off` — Required for SSE
  - `ssl-redirect: true` — Force HTTPS
  - `HSTS` header — 1 year with subdomains
- **Routes:**
  - `/api/*` → `api:3000`
  - `/*` (catch-all) → `web:80`

### Network Policies (5 policies)

Default-deny with explicit allow rules:

```
┌──────────────────────────────────┐
│     Ingress Controller           │
│   (external traffic)             │
└──────┬───────────┬──────────────┘
       │           │
       ▼           ▼
   ┌──────┐   ┌──────┐
   │  API │   │ Web  │
   │ :3000│   │ :80  │
   └──┬───┘   └──────┘
      │
      ├─────────────┐
      ▼             ▼
  ┌────────┐   ┌───────┐
  │Postgres│   │ Redis │
  │ :5432  │   │ :6379 │
  └────────┘   └───────┘
      ▲             ▲
      │             │
  ┌───┴────────┐ ┌──┴──────────┐
  │ Ingestion  │ │  Scraper    │
  │  Worker    │ │  Worker     │
  └────────────┘ └─────────────┘
```

| Policy | Source → Target |
|--------|----------------|
| `default-deny-ingress` | Block all ingress by default |
| `allow-api-ingress` | Ingress controller + workers → API |
| `allow-web-ingress` | Ingress controller → Web |
| `allow-postgres-ingress` | API + workers → Postgres |
| `allow-redis-ingress` | API + workers → Redis |

---

## Customizing for Production

### 1. Image Registry

Edit `kustomization.yaml` to point to your registry:

```yaml
images:
  - name: grounded-api
    newName: your-registry.com/grounded-api
    newTag: v1.2.3
```

### 2. Scaling

```yaml
# api.yaml — Increase replicas for more API capacity
replicas: 4

# ingestion-worker.yaml — Scale for faster ingestion
replicas: 3

# scraper-worker.yaml — Scale for faster scraping
replicas: 2
```

### 3. External Database

Replace `postgres.yaml` with a managed database (RDS, Cloud SQL, etc.):
1. Remove `postgres.yaml` from `kustomization.yaml`
2. Update `DATABASE_URL` in `secrets.yaml` to point to the managed instance
3. Ensure pgvector extension is installed

### 4. External Redis

Replace `redis.yaml` with ElastiCache, Cloud Memorystore, etc.:
1. Remove `redis.yaml` from `kustomization.yaml`
2. Update `REDIS_URL` in `configmap.yaml`

### 5. HPA (Horizontal Pod Autoscaler)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

---

## Deployment Checklist

- [ ] All secrets changed from defaults
- [ ] Domain set in `ingress.yaml`
- [ ] cert-manager installed for TLS
- [ ] Image names point to your registry
- [ ] `INTERNAL_API_KEY` set (secures worker → API)
- [ ] Network policies applied
- [ ] PVC storage class appropriate for your cluster
- [ ] Resource limits tuned for your workload
- [ ] Monitoring/logging configured (Prometheus, Grafana, etc.)

---

## Related Docs

- [13 — Deployment & Operations](./13-deployment.md) — Docker Compose, startup sequence, monitoring
- [14 — Security](./14-security.md) — Secrets management, access control
- [15 — Workers & Fairness](./15-workers-and-fairness.md) — Worker scaling considerations
