# KCB Kubernetes Deployment

## Prerequisites

- Kubernetes cluster (1.25+)
- kubectl configured
- Container registry access
- Nginx Ingress Controller installed

## Quick Start

### 1. Build and Push Images

```bash
# Set your registry
export REGISTRY=your-registry.com

# Build images
docker build -f Dockerfile.api -t $REGISTRY/kcb-api:latest .
docker build -f Dockerfile.web --build-arg VITE_API_URL="" -t $REGISTRY/kcb-web:latest .
docker build -f Dockerfile.ingestion -t $REGISTRY/kcb-ingestion-worker:latest .
docker build -f Dockerfile.scraper -t $REGISTRY/kcb-scraper-worker:latest .

# Push to registry
docker push $REGISTRY/kcb-api:latest
docker push $REGISTRY/kcb-web:latest
docker push $REGISTRY/kcb-ingestion-worker:latest
docker push $REGISTRY/kcb-scraper-worker:latest
```

### 2. Configure Secrets

Edit `secrets.yaml` with your actual values:

```bash
# Generate a session secret
openssl rand -base64 32

# Update secrets.yaml with:
# - POSTGRES_PASSWORD
# - DATABASE_URL (update password)
# - SESSION_SECRET
# - EMBEDDING_API_KEY
# - LLM_API_KEY
# - OIDC credentials (optional)
```

### 3. Configure Ingress

Edit `ingress.yaml`:
- Change `kcb.example.com` to your domain
- Uncomment TLS section for HTTPS

### 4. Update Kustomization

Edit `kustomization.yaml`:
- Update image registry paths

### 5. Deploy

```bash
# Using kustomize
kubectl apply -k k8s/

# Or apply individually
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/api.yaml
kubectl apply -f k8s/web.yaml
kubectl apply -f k8s/ingestion-worker.yaml
kubectl apply -f k8s/scraper-worker.yaml
kubectl apply -f k8s/ingress.yaml
```

### 6. Initialize Database

```bash
# Port-forward to postgres
kubectl port-forward -n kcb svc/postgres 5432:5432 &

# Run init script
psql -h localhost -U kcb -d kcb < packages/db/init.sql

# Restart API to run migrations
kubectl rollout restart -n kcb deployment/api
```

## Scaling

```bash
# Scale API
kubectl scale -n kcb deployment/api --replicas=4

# Scale workers
kubectl scale -n kcb deployment/ingestion-worker --replicas=4
kubectl scale -n kcb deployment/scraper-worker --replicas=2
```

## Monitoring

```bash
# Check pod status
kubectl get pods -n kcb

# View logs
kubectl logs -n kcb -l app=api -f
kubectl logs -n kcb -l app=ingestion-worker -f

# Describe resources
kubectl describe -n kcb deployment/api
```

## Architecture

```
                    ┌─────────────────┐
                    │     Ingress     │
                    │  (nginx/traefik)│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
         ┌────────┐    ┌──────────┐   ┌─────────┐
         │  /api  │    │    /     │   │ /widget │
         └────┬───┘    └────┬─────┘   └────┬────┘
              │             │              │
              ▼             ▼              │
         ┌────────┐    ┌────────┐          │
         │  API   │    │  Web   │          │
         │Service │    │Service │          │
         └────┬───┘    └────────┘          │
              │                            │
              ├────────────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐
│Postgres│ │ Redis │ │Workers│
└───────┘ └───────┘ └───────┘
```

## Production Considerations

1. **Database**: Consider using managed PostgreSQL (RDS, Cloud SQL)
2. **Redis**: Consider managed Redis (ElastiCache, Memorystore)
3. **TLS**: Enable cert-manager for automatic certificates
4. **Secrets**: Use external secrets (Vault, AWS Secrets Manager)
5. **Monitoring**: Add Prometheus/Grafana for observability
6. **Autoscaling**: Configure HPA for API and workers
