# Development Environment Setup

This guide walks you through setting up a complete development environment for Grounded.

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| [Bun](https://bun.sh) | 1.0+ | JavaScript runtime and package manager |
| [Docker](https://www.docker.com) | 20.0+ | Container runtime for infrastructure |
| [Docker Compose](https://docs.docker.com/compose/) | 2.0+ | Multi-container orchestration |
| [Git](https://git-scm.com) | 2.0+ | Version control |

### Optional but Recommended

| Software | Purpose |
|----------|---------|
| [VS Code](https://code.visualstudio.com) | Recommended IDE with TypeScript support |
| [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview) | Database GUI (included via `bun run db:studio`) |

## Installation Steps

### 1. Install Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (via PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# Verify installation
bun --version
```

### 2. Clone the Repository

```bash
git clone https://github.com/ncecere/grounded.git
cd grounded
```

### 3. Install Dependencies

```bash
bun install
```

This installs dependencies for all packages in the monorepo using Bun's workspace feature.

### 4. Start Infrastructure Services

The project requires PostgreSQL (main database), PostgreSQL with pgvector (vector storage), and Redis (job queue).

```bash
# Start all infrastructure services
bun run docker:dev
```

This starts:
- **PostgreSQL** on port `5432` (main database)
- **PostgreSQL + pgvector** on port `5433` (vector storage)
- **Redis** on port `6379` (job queue and caching)

Verify services are running:
```bash
docker ps
```

You should see three containers: `grounded-postgres-dev`, `grounded-postgres-vector-dev`, and `grounded-redis-dev`.

### 5. Configure Environment

```bash
# Copy example environment file
cp .env.example .env
```

Edit `.env` with your settings. The defaults work for local development:

```env
# Database (matches docker-compose.dev.yml)
DATABASE_URL=postgres://grounded:grounded_dev_password@localhost:5432/grounded

# Vector Database
VECTOR_DB_TYPE=pgvector
VECTOR_DB_URL=postgres://grounded_vectors:grounded_vectors_dev_password@localhost:5433/vectors

# Redis
REDIS_URL=redis://localhost:6379

# Session Security (change in production!)
SESSION_SECRET=development_secret_change_in_production

# Initial Admin User (optional - for first-time setup)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=AdminPassword123!

# CORS (for local development)
CORS_ORIGINS=http://localhost:5173
```

### 6. Initialize the Database

Push the database schema:

```bash
bun run db:push
```

This creates all tables in both the main database and vector database.

### 7. Start Development Servers

```bash
# Start all services with hot reload
bun run dev
```

This starts:
- **API Server** at `http://localhost:3000`
- **Web UI** at `http://localhost:5173`
- **Ingestion Worker** (background process)
- **Scraper Worker** (background process)

Alternatively, start services individually:

```bash
bun run dev:api        # API only
bun run dev:web        # Web UI only
bun run dev:ingestion  # Ingestion worker only
bun run dev:scraper    # Scraper worker only
```

### 8. Access the Application

Open `http://localhost:5173` in your browser.

If you configured `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`, you can log in with those credentials. Otherwise, use the registration form to create an account.

## Project Scripts

### Development

| Command | Description |
|---------|-------------|
| `bun run dev` | Start all services with hot reload |
| `bun run dev:api` | Start API server only |
| `bun run dev:web` | Start web UI only |
| `bun run dev:ingestion` | Start ingestion worker only |
| `bun run dev:scraper` | Start scraper worker only |
| `bun run docker:dev` | Start infrastructure containers |

### Database

| Command | Description |
|---------|-------------|
| `bun run db:generate` | Generate migrations from schema changes |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:push` | Push schema directly (development only) |
| `bun run db:studio` | Open Drizzle Studio GUI |

### Build & Quality

| Command | Description |
|---------|-------------|
| `bun run build` | Build all packages for production |
| `bun run lint` | Run ESLint across all packages |
| `bun run test` | Run test suite |
| `bun run typecheck` | TypeScript type checking |

### Docker (Production)

| Command | Description |
|---------|-------------|
| `bun run docker:build` | Build all Docker images |
| `bun run docker:up` | Start full production stack |
| `bun run docker:down` | Stop all containers |
| `bun run docker:logs` | View container logs |

## IDE Setup

### VS Code

Recommended extensions:
- **TypeScript and JavaScript Language Features** (built-in)
- **ESLint** - Linting
- **Tailwind CSS IntelliSense** - CSS autocomplete
- **Prettier** - Code formatting
- **Thunder Client** or **REST Client** - API testing

Recommended settings (`.vscode/settings.json`):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.preferences.importModuleSpecifier": "relative",
  "tailwindCSS.experimental.classRegex": [
    ["cva\\(([^)]*)\\)", "[\"'`]([^\"'`]*).*?[\"'`]"]
  ]
}
```

## Troubleshooting

### Port Conflicts

If you see "port already in use" errors:

```bash
# Check what's using the port
lsof -i :5432  # PostgreSQL
lsof -i :5433  # pgvector
lsof -i :6379  # Redis
lsof -i :3000  # API
lsof -i :5173  # Web

# Kill the process or change ports in docker-compose.dev.yml
```

### Database Connection Issues

```bash
# Verify containers are running
docker ps

# Check container logs
docker logs grounded-postgres-dev
docker logs grounded-postgres-vector-dev

# Test connection
psql postgres://grounded:grounded_dev_password@localhost:5432/grounded
```

### Redis Connection Issues

```bash
# Check Redis is running
docker logs grounded-redis-dev

# Test connection
redis-cli -h localhost -p 6379 ping
# Should return: PONG
```

### Clean Restart

If things get into a bad state:

```bash
# Stop all containers and remove volumes
docker compose -f docker-compose.dev.yml down -v

# Remove node_modules
rm -rf node_modules
rm bun.lockb

# Fresh install
bun install

# Restart infrastructure
bun run docker:dev

# Re-initialize database
bun run db:push
```

### TypeScript Errors

```bash
# Rebuild TypeScript
bun run typecheck

# If errors persist, restart TypeScript server in VS Code:
# Cmd/Ctrl + Shift + P -> "TypeScript: Restart TS Server"
```

## Environment Variables Reference

See `.env.example` for all available configuration options. Key variables:

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `VECTOR_DB_URL` | pgvector connection string |
| `REDIS_URL` | Redis connection string |
| `SESSION_SECRET` | JWT signing secret (32+ characters) |

### Optional

| Variable | Description |
|----------|-------------|
| `ADMIN_EMAIL` | Initial admin user email |
| `ADMIN_PASSWORD` | Initial admin user password |
| `OIDC_ISSUER_URL` | OpenID Connect issuer URL |
| `OIDC_CLIENT_ID` | OIDC client ID |
| `OIDC_CLIENT_SECRET` | OIDC client secret |
| `FIRECRAWL_API_KEY` | Firecrawl API key for enhanced scraping |
| `CORS_ORIGINS` | Comma-separated allowed origins |

---

Next: [Architecture Overview](./architecture.md)
