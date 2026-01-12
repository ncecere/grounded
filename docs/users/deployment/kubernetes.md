# Kubernetes Deployment

This guide covers deploying Grounded to a Kubernetes cluster for production use.

## Prerequisites

- Kubernetes cluster (1.24+)
- `kubectl` configured for your cluster
- Container registry access (Docker Hub, GCR, ECR, etc.)
- Persistent volume provisioner
- Ingress controller (nginx-ingress recommended)
- cert-manager (for automatic SSL)

## Architecture Overview

```
                    ┌─────────────────┐
                    │    Ingress      │
                    │  (SSL/Routing)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │   Web    │  │   API    │  │  Chat    │
        │ (nginx)  │  │  (Hono)  │  │ Endpoint │
        └──────────┘  └────┬─────┘  └──────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐
   │PostgreSQL│     │  Redis   │     │ Workers  │
   │(StatefulSet)   │(Deployment)    │(Deployment)
   └──────────┘     └──────────┘     └──────────┘
```

## Deployment Steps

### 1. Create Namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

Or create manually:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: grounded
```

### 2. Configure Secrets

Edit `k8s/secrets.yaml` with your credentials:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: grounded-secrets
  namespace: grounded
type: Opaque
stringData:
  # Database (use strong passwords!)
  POSTGRES_PASSWORD: "your-secure-password-32chars"
  DATABASE_URL: "postgres://grounded:your-secure-password-32chars@postgres:5432/grounded"

  # Session security
  SESSION_SECRET: "your-64-character-random-string-here-make-it-long"

  # OIDC Authentication (optional)
  OIDC_ISSUER_URL: "https://your-idp.com"
  OIDC_CLIENT_ID: "grounded-client"
  OIDC_CLIENT_SECRET: "your-oidc-secret"
  OIDC_REDIRECT_URI: "https://grounded.yourdomain.com/api/v1/auth/oidc/callback"

  # Initial admin (optional)
  ADMIN_EMAIL: "admin@yourcompany.com"
  ADMIN_PASSWORD: "SecureAdminPassword123!"

  # Firecrawl (optional, for enhanced web scraping)
  FIRECRAWL_API_KEY: ""
```

Apply secrets:

```bash
kubectl apply -f k8s/secrets.yaml
```

### 3. Configure ConfigMap

Edit `k8s/configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grounded-config
  namespace: grounded
data:
  NODE_ENV: "production"
  POSTGRES_USER: "grounded"
  POSTGRES_DB: "grounded"
  VECTOR_DB_TYPE: "pgvector"
  VECTOR_DB_USER: "grounded_vectors"
  VECTOR_DB_NAME: "vectors"
  CORS_ORIGINS: "https://grounded.yourdomain.com"
```

Apply:

```bash
kubectl apply -f k8s/configmap.yaml
```

### 4. Deploy Database

Deploy PostgreSQL with pgvector:

```bash
kubectl apply -f k8s/postgres.yaml
```

This creates:
- StatefulSet with persistent volume
- Service for internal access
- Health checks

Wait for PostgreSQL to be ready:

```bash
kubectl -n grounded wait --for=condition=ready pod -l app=postgres --timeout=120s
```

### 5. Deploy Redis

```bash
kubectl apply -f k8s/redis.yaml
```

### 6. Build and Push Images

Build images and push to your registry:

```bash
# Set your registry
export REGISTRY=your-registry.com/grounded

# Build and push
docker build -f docker/Dockerfile.api -t $REGISTRY/api:latest .
docker build -f docker/Dockerfile.web -t $REGISTRY/web:latest .
docker build -f docker/Dockerfile.ingestion -t $REGISTRY/ingestion:latest .
docker build -f docker/Dockerfile.scraper -t $REGISTRY/scraper:latest .

docker push $REGISTRY/api:latest
docker push $REGISTRY/web:latest
docker push $REGISTRY/ingestion:latest
docker push $REGISTRY/scraper:latest
```

### 7. Update Image References

Edit the deployment files to use your registry:

```yaml
# k8s/api.yaml
spec:
  containers:
    - name: api
      image: your-registry.com/grounded/api:latest
```

### 8. Deploy Applications

```bash
kubectl apply -f k8s/api.yaml
kubectl apply -f k8s/web.yaml
kubectl apply -f k8s/ingestion-worker.yaml
kubectl apply -f k8s/scraper-worker.yaml
```

### 9. Configure Ingress

Edit `k8s/ingress.yaml` with your domain:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: grounded-ingress
  namespace: grounded
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
spec:
  tls:
    - hosts:
        - grounded.yourdomain.com
      secretName: grounded-tls
  rules:
    - host: grounded.yourdomain.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 3000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
```

Apply:

```bash
kubectl apply -f k8s/ingress.yaml
```

### 10. Verify Deployment

```bash
# Check all pods are running
kubectl -n grounded get pods

# Check services
kubectl -n grounded get svc

# Check ingress
kubectl -n grounded get ingress

# View logs
kubectl -n grounded logs -f deployment/api
```

## Production Recommendations

### High Availability

**API Replicas:**
```yaml
# k8s/api.yaml
spec:
  replicas: 3
```

**Pod Disruption Budget:**
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
  namespace: grounded
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: api
```

### Resource Requests and Limits

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "2Gi"
    cpu: "1000m"
```

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: grounded
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

### Database Considerations

For production, consider:

1. **Managed Database**: Use AWS RDS, GCP Cloud SQL, or Azure Database
2. **Connection Pooling**: Deploy PgBouncer
3. **Backups**: Configure automated backups
4. **Monitoring**: Set up database monitoring

Update your secrets to use external database:

```yaml
DATABASE_URL: "postgres://user:pass@your-rds-instance.region.rds.amazonaws.com:5432/grounded"
```

### Monitoring

**Prometheus Metrics:**

Add annotations to services:

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3000"
    prometheus.io/path: "/metrics"
```

**Health Endpoints:**

- `/health` - Basic health check
- `/health/ready` - Readiness check
- `/health/live` - Liveness check

## Troubleshooting

### Pod Issues

```bash
# Describe pod for events
kubectl -n grounded describe pod <pod-name>

# View logs
kubectl -n grounded logs <pod-name>

# Shell into pod
kubectl -n grounded exec -it <pod-name> -- /bin/sh
```

### Database Connectivity

```bash
# Test from API pod
kubectl -n grounded exec -it deployment/api -- nc -zv postgres 5432
```

### Ingress Issues

```bash
# Check ingress controller logs
kubectl -n ingress-nginx logs -l app.kubernetes.io/name=ingress-nginx

# Verify TLS certificate
kubectl -n grounded get certificate
kubectl -n grounded describe certificate grounded-tls
```

### Common Problems

**ImagePullBackOff:**
- Check registry credentials
- Verify image exists

**CrashLoopBackOff:**
- Check logs for errors
- Verify environment variables
- Check database connectivity

**Pending Pods:**
- Check resource availability
- Verify PVC can be provisioned

## Using Kustomize

For environment-specific configurations, use Kustomize:

```bash
# Development
kubectl apply -k k8s/overlays/development

# Production
kubectl apply -k k8s/overlays/production
```

Example overlay structure:

```
k8s/
├── base/
│   ├── kustomization.yaml
│   └── *.yaml
└── overlays/
    ├── development/
    │   ├── kustomization.yaml
    │   └── patches/
    └── production/
        ├── kustomization.yaml
        └── patches/
```

## Helm Chart (Coming Soon)

A Helm chart for simplified deployment is planned. Check the repository for updates.

---

Next: [Configuration Reference](./configuration.md)
