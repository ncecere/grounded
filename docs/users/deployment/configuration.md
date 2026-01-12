# Configuration Reference

Complete reference for all Grounded configuration options.

## Environment Variables

### Database Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string for main database |
| `VECTOR_DB_TYPE` | No | `pgvector` | Vector store type (`pgvector`) |
| `VECTOR_DB_URL` | Yes* | - | PostgreSQL+pgvector connection string |
| `POSTGRES_USER` | No | `grounded` | PostgreSQL username (for Docker) |
| `POSTGRES_PASSWORD` | No | - | PostgreSQL password (for Docker) |
| `POSTGRES_DB` | No | `grounded` | PostgreSQL database name (for Docker) |

*Required if using vector search

**Connection String Format:**
```
postgres://username:password@host:port/database
```

**Examples:**
```env
# Local development
DATABASE_URL=postgres://grounded:password@localhost:5432/grounded

# AWS RDS
DATABASE_URL=postgres://admin:password@mydb.123456.us-east-1.rds.amazonaws.com:5432/grounded

# With SSL
DATABASE_URL=postgres://admin:password@host:5432/grounded?sslmode=require
```

### Redis Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | Yes | - | Redis connection string |

**Connection String Format:**
```
redis://[[username]:password@]host[:port][/database]
```

**Examples:**
```env
# Local
REDIS_URL=redis://localhost:6379

# With password
REDIS_URL=redis://:password@redis-host:6379

# AWS ElastiCache
REDIS_URL=redis://my-cluster.cache.amazonaws.com:6379
```

### Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | Yes | - | JWT signing secret (32+ characters) |
| `ADMIN_EMAIL` | No | - | Initial admin user email |
| `ADMIN_PASSWORD` | No | - | Initial admin user password |

**Session Secret:**
Generate a secure random string:
```bash
openssl rand -base64 48
```

### OIDC Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OIDC_ISSUER_URL` | No | - | OpenID Connect issuer URL |
| `OIDC_CLIENT_ID` | No | - | OIDC client ID |
| `OIDC_CLIENT_SECRET` | No | - | OIDC client secret |
| `OIDC_REDIRECT_URI` | No | - | Callback URL for OIDC flow |

**Example OIDC Setup:**
```env
# Okta
OIDC_ISSUER_URL=https://your-org.okta.com
OIDC_CLIENT_ID=0oa1234567890abcdef
OIDC_CLIENT_SECRET=your-client-secret
OIDC_REDIRECT_URI=https://grounded.yourdomain.com/api/v1/auth/oidc/callback

# Azure AD
OIDC_ISSUER_URL=https://login.microsoftonline.com/your-tenant-id/v2.0
OIDC_CLIENT_ID=your-app-id
OIDC_CLIENT_SECRET=your-secret
OIDC_REDIRECT_URI=https://grounded.yourdomain.com/api/v1/auth/oidc/callback

# Google
OIDC_ISSUER_URL=https://accounts.google.com
OIDC_CLIENT_ID=your-client-id.apps.googleusercontent.com
OIDC_CLIENT_SECRET=your-secret
OIDC_REDIRECT_URI=https://grounded.yourdomain.com/api/v1/auth/oidc/callback
```

### API Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | API server port |
| `NODE_ENV` | No | `development` | Environment (`development`, `production`) |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins |
| `API_URL` | No | - | Public API URL (for web frontend) |

**CORS Examples:**
```env
# Single origin
CORS_ORIGINS=https://grounded.yourdomain.com

# Multiple origins
CORS_ORIGINS=https://grounded.yourdomain.com,https://app.yourdomain.com

# Allow all (development only!)
CORS_ORIGINS=*
```

### External Services

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIRECRAWL_API_KEY` | No | - | Firecrawl API key for enhanced scraping |

### Email Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | No | - | SMTP server host |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_USER` | No | - | SMTP username |
| `SMTP_PASSWORD` | No | - | SMTP password |
| `SMTP_FROM` | No | - | From address for emails |

**Example:**
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
SMTP_FROM=noreply@yourdomain.com
```

## System Settings

These settings are configured through the admin UI after deployment.

### Authentication Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `auth.localRegistrationEnabled` | Allow email/password registration | `true` |
| `auth.oidcEnabled` | Enable OIDC authentication | `false` |
| `auth.requireEmailVerification` | Require email verification | `false` |

### Quota Defaults

| Setting | Description | Default |
|---------|-------------|---------|
| `quotas.defaultMaxKnowledgeBases` | Max KBs per tenant | `10` |
| `quotas.defaultMaxAgents` | Max agents per tenant | `5` |
| `quotas.defaultMaxMonthlyUploads` | Max uploads per month | `100` |
| `quotas.defaultMaxMonthlyCrawls` | Max crawl runs per month | `50` |
| `quotas.defaultChatRateLimitPerMinute` | Chat requests per minute | `60` |
| `quotas.quotaWarningThreshold` | Warning at % of quota | `80` |

### Health Check Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `health.checkIntervalMinutes` | Health check frequency | `5` |
| `health.alertEmail` | Email for alerts | - |
| `health.databaseLatencyThresholdMs` | DB latency alert | `1000` |
| `health.vectorStoreLatencyThresholdMs` | Vector latency alert | `2000` |
| `health.llmLatencyThresholdMs` | LLM latency alert | `10000` |

## AI Model Configuration

AI models are configured through the admin UI.

### Supported Providers

| Provider | Capabilities |
|----------|--------------|
| OpenAI | Chat, Embeddings, Tool Use |
| Anthropic | Chat, Tool Use |
| Google AI | Chat, Embeddings |
| OpenAI-Compatible | Chat (varies by provider) |

### Model Configuration Options

| Option | Description |
|--------|-------------|
| `displayName` | Friendly name shown in UI |
| `modelId` | Provider's model identifier |
| `contextWindow` | Maximum tokens in context |
| `maxOutputTokens` | Maximum response tokens |
| `temperature` | Response randomness (0-2) |
| `supportsStreaming` | Enable streaming responses |
| `supportsToolUse` | Enable function calling |
| `isDefault` | Use as default model |

### Common Model IDs

**OpenAI:**
- `gpt-4o` - Latest GPT-4
- `gpt-4o-mini` - Faster, cheaper GPT-4
- `gpt-4-turbo` - Previous GPT-4
- `text-embedding-3-small` - Embeddings (1536 dim)
- `text-embedding-3-large` - Embeddings (3072 dim)

**Anthropic:**
- `claude-sonnet-4-20250514` - Latest Claude
- `claude-3-5-haiku-20241022` - Fast Claude
- `claude-3-5-sonnet-20241022` - Balanced Claude

**Google:**
- `gemini-1.5-pro` - Gemini Pro
- `gemini-1.5-flash` - Fast Gemini
- `text-embedding-004` - Embeddings

## Retrieval Configuration

Per-agent RAG settings:

| Setting | Description | Default | Range |
|---------|-------------|---------|-------|
| `topK` | Chunks sent to LLM | `8` | 1-20 |
| `candidateK` | Initial retrieval pool | `40` | 10-100 |
| `maxCitations` | Citations shown to user | `3` | 1-10 |
| `rerankerEnabled` | Enable result reranking | `true` | - |
| `rerankerType` | Reranking algorithm | `heuristic` | `heuristic`, `cross-encoder` |

## Widget Configuration

Per-agent widget settings:

### Theme Options

| Option | Description | Default |
|--------|-------------|---------|
| `primaryColor` | Main accent color | `#2563eb` |
| `backgroundColor` | Widget background | `#ffffff` |
| `textColor` | Text color | `#1f2937` |
| `borderRadius` | Corner roundness | `16` |

### Button Options

| Option | Description | Default |
|--------|-------------|---------|
| `position` | Screen position | `bottom-right` |
| `style` | Button shape | `circle` |
| `size` | Button size in pixels | `56` |
| `iconType` | Icon style | `chat` |

### Access Control

| Option | Description | Default |
|--------|-------------|---------|
| `isPublic` | Allow public access | `true` |
| `allowedDomains` | Domain whitelist | `[]` |
| `requireAuth` | Require OIDC auth | `false` |

## Complete .env.example

```env
# =============================================================================
# Grounded Configuration
# =============================================================================

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------
# Main PostgreSQL database
DATABASE_URL=postgres://grounded:your_password@localhost:5432/grounded

# Vector database (pgvector)
VECTOR_DB_TYPE=pgvector
VECTOR_DB_URL=postgres://grounded_vectors:your_password@localhost:5433/vectors

# For Docker Compose (creates these users/databases)
POSTGRES_USER=grounded
POSTGRES_PASSWORD=your_password
POSTGRES_DB=grounded
VECTOR_DB_USER=grounded_vectors
VECTOR_DB_PASSWORD=your_password
VECTOR_DB_NAME=vectors

# -----------------------------------------------------------------------------
# Redis
# -----------------------------------------------------------------------------
REDIS_URL=redis://localhost:6379

# -----------------------------------------------------------------------------
# Security
# -----------------------------------------------------------------------------
# JWT signing secret (generate with: openssl rand -base64 48)
SESSION_SECRET=your_64_character_random_string_here

# -----------------------------------------------------------------------------
# Authentication
# -----------------------------------------------------------------------------
# Initial admin user (created on first startup)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=SecurePassword123!

# OIDC Configuration (optional)
OIDC_ISSUER_URL=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=

# -----------------------------------------------------------------------------
# API Configuration
# -----------------------------------------------------------------------------
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://grounded.yourdomain.com
API_URL=https://grounded.yourdomain.com

# -----------------------------------------------------------------------------
# External Services (optional)
# -----------------------------------------------------------------------------
# Firecrawl for enhanced web scraping
FIRECRAWL_API_KEY=

# Email (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# =============================================================================
# Note: LLM API keys are configured in the admin UI, not environment variables
# =============================================================================
```

---

Next: [Initial Setup](../administration/getting-started.md)
