# Docker Deployment

This guide walks you through deploying Grounded using Docker and Docker Compose.

## Prerequisites

- **Docker** 20.0 or later
- **Docker Compose** 2.0 or later
- **4GB RAM** minimum (8GB recommended)
- **20GB disk space** minimum

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/ncecere/grounded.git
cd grounded
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Database credentials (change these!)
POSTGRES_USER=grounded
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=grounded

# Vector database
VECTOR_DB_USER=grounded_vectors
VECTOR_DB_PASSWORD=your_vector_password_here
VECTOR_DB_NAME=vectors

# Security (generate a random 32+ character string)
SESSION_SECRET=your_random_session_secret_here

# Initial admin user (optional but recommended)
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_PASSWORD=YourSecurePassword123!

# CORS - set to your frontend domain
CORS_ORIGINS=https://yourdomain.com
```

### 3. Build and Start

```bash
# Build all images
docker compose build

# Start all services
docker compose up -d
```

### 4. Verify Deployment

Check that all services are running:

```bash
docker compose ps
```

You should see:
- `grounded-postgres` - Main database
- `grounded-postgres-vector` - Vector database
- `grounded-redis` - Job queue
- `grounded-api` - API server
- `grounded-web` - Web dashboard
- `grounded-ingestion` - Ingestion worker
- `grounded-scraper` - Scraper worker

### 5. Access the Dashboard

Open your browser to `http://localhost:8088` (or your configured domain).

Log in with the admin credentials you set in `.env`.

## Production Configuration

### Environment Variables

For production, ensure you set these critical variables:

```env
# Strong passwords
POSTGRES_PASSWORD=<generated-32-char-password>
VECTOR_DB_PASSWORD=<generated-32-char-password>
SESSION_SECRET=<generated-64-char-secret>

# Disable registration if using SSO
# Configure in admin settings after first login

# Production API URL (if different from web)
API_URL=https://api.yourdomain.com

# CORS for your domain
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

### Reverse Proxy Setup

For production, place Grounded behind a reverse proxy (Nginx, Traefik, etc.) with SSL.

**Example Nginx configuration:**

```nginx
server {
    listen 443 ssl http2;
    server_name grounded.yourdomain.com;

    ssl_certificate /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    # Web dashboard
    location / {
        proxy_pass http://localhost:8088;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API endpoints
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # SSE support for streaming
        proxy_buffering off;
        proxy_cache off;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name grounded.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

### Resource Limits

The default `docker-compose.yml` includes resource limits:

| Service | CPU | Memory |
|---------|-----|--------|
| API | 1 core | 1GB |
| Web | 0.25 core | 128MB |
| Ingestion Worker | 0.5 core | 512MB |
| Scraper Worker | 1 core | 2GB |

Adjust these in `docker-compose.yml` based on your workload:

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: "2"
          memory: 2G
```

### Persistent Data

Data is stored in Docker volumes:

| Volume | Purpose |
|--------|---------|
| `postgres_data` | Main database |
| `postgres_vector_data` | Vector embeddings |
| `redis_data` | Queue state |

**Backup your volumes regularly!**

```bash
# Backup PostgreSQL
docker exec grounded-postgres pg_dump -U grounded grounded > backup.sql

# Backup all volumes
docker run --rm -v postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_data.tar.gz /data
```

## Scaling

### Horizontal Scaling

For high traffic, scale the API and workers:

```bash
# Scale API to 3 instances
docker compose up -d --scale api=3

# Scale workers
docker compose up -d --scale ingestion-worker=2 --scale scraper-worker=2
```

When scaling the API, add a load balancer (like Nginx or HAProxy).

### Database Scaling

For large deployments:
1. Use managed PostgreSQL (AWS RDS, GCP Cloud SQL, etc.)
2. Configure read replicas for query scaling
3. Use connection pooling (PgBouncer)

Update `DATABASE_URL` and `VECTOR_DB_URL` to point to your managed databases.

## Upgrading

### Standard Upgrade

```bash
# Pull latest code
git pull

# Rebuild images
docker compose build

# Restart with new images
docker compose up -d
```

### Database Migrations

If the upgrade includes database changes:

```bash
# Run migrations
docker compose exec api bun run db:migrate
```

Check release notes for migration instructions.

## Troubleshooting

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f ingestion-worker
```

### Common Issues

**API won't start:**
```bash
# Check database connection
docker compose exec api ping postgres

# Check logs
docker compose logs api
```

**Database connection errors:**
```bash
# Verify PostgreSQL is running
docker compose exec postgres pg_isready

# Check credentials
docker compose exec postgres psql -U grounded -c "SELECT 1"
```

**Workers not processing jobs:**
```bash
# Check Redis connection
docker compose exec redis redis-cli ping

# View queue status
docker compose exec api bun run queue:status
```

**Out of memory:**
```bash
# Check memory usage
docker stats

# Increase limits in docker-compose.yml
```

### Reset Everything

**Warning: This deletes all data!**

```bash
# Stop and remove containers, networks, volumes
docker compose down -v

# Rebuild and start fresh
docker compose up -d --build
```

## Next Steps

After deployment:

1. [Initial Setup](../administration/getting-started.md) - Configure your first tenant
2. [Model Configuration](../administration/model-configuration.md) - Add LLM providers
3. [Create Knowledge Bases](../tenant-guide/knowledge-bases.md) - Start adding content

---

Next: [Kubernetes Deployment](./kubernetes.md)
