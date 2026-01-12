# Architecture Overview

This document describes the high-level architecture of Grounded, including system components, data flow, and key design decisions.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Layer                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Web UI     │  │Chat Widget   │  │ Hosted Chat  │  │  REST API    │    │
│  │ (React 19)   │  │  (Preact)    │  │    Page      │  │   Clients    │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
└─────────┼──────────────────┼──────────────────┼──────────────────┼──────────┘
          │                  │                  │                  │
          └──────────────────┴──────────────────┴──────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API Layer                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       Hono API Server                                │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│  │  │   Auth   │ │ Tenants  │ │   KBs    │ │  Agents  │ │   Chat   │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│  │  │ Sources  │ │ Uploads  │ │Analytics │ │  Widget  │ │  Admin   │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────────────┐
│      PostgreSQL       │ │   Redis (Queue)   │ │      LLM Providers        │
│    (Main Database)    │ │                   │ │  ┌─────────────────────┐  │
│  ┌─────────────────┐  │ │  ┌─────────────┐  │ │  │ OpenAI / Anthropic  │  │
│  │ Drizzle ORM     │  │ │  │   BullMQ    │  │ │  │ Google / Custom     │  │
│  │ + RLS Policies  │  │ │  │   Jobs      │  │ │  └─────────────────────┘  │
│  └─────────────────┘  │ │  └─────────────┘  │ └───────────────────────────┘
└───────────────────────┘ └─────────┬─────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
┌───────────────────────────────┐ ┌───────────────────────────────────────────┐
│      Ingestion Worker         │ │            Scraper Worker                  │
│  ┌─────────────────────────┐  │ │  ┌─────────────────────────────────────┐  │
│  │ Document Processing     │  │ │  │ Web Crawling (Playwright)           │  │
│  │ Chunking & Embedding    │  │ │  │ Sitemap Discovery                   │  │
│  │ Vector Storage          │  │ │  │ Content Extraction                  │  │
│  └─────────────────────────┘  │ │  └─────────────────────────────────────┘  │
└───────────────────────────────┘ └───────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────┐
│    PostgreSQL + pgvector      │
│      (Vector Database)        │
│  ┌─────────────────────────┐  │
│  │ Embedding Storage       │  │
│  │ Similarity Search       │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
```

## Component Overview

### Applications

#### API Server (`apps/api`)
The central REST API built with Hono framework. Handles:
- Authentication (local + OIDC)
- Multi-tenant data management
- Knowledge base operations
- Agent configuration
- Chat with RAG pipeline
- Analytics and metrics

#### Web Dashboard (`apps/web`)
React 19 single-page application for administration:
- Tenant management
- Knowledge base and source configuration
- Agent setup and testing
- Analytics visualization
- System administration (for admins)

#### Ingestion Worker (`apps/ingestion-worker`)
Background job processor for document ingestion:
- File parsing (PDF, Word, Excel, etc.)
- Text chunking with metadata extraction
- Embedding generation
- Vector storage indexing

#### Scraper Worker (`apps/scraper-worker`)
Background job processor for web crawling:
- Headless browser automation (Playwright)
- Sitemap discovery and parsing
- Content extraction and deduplication
- Robots.txt compliance

### Shared Packages

| Package | Purpose |
|---------|---------|
| `@grounded/db` | Database schema, migrations, and client |
| `@grounded/shared` | Common types, utilities, and constants |
| `@grounded/queue` | BullMQ job queue abstraction |
| `@grounded/ai-providers` | Multi-provider LLM adapter |
| `@grounded/embeddings` | Text embedding generation |
| `@grounded/vector-store` | Vector database operations |
| `@grounded/llm` | RAG pipeline and response generation |
| `@grounded/crawl-state` | Web crawling state management |
| `@grounded/widget` | Embeddable chat widget (Preact) |

## Data Flow

### Knowledge Ingestion Pipeline

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Upload or  │────▶│   Queue     │────▶│  Worker     │────▶│  Database   │
│  Crawl URL  │     │   Job       │     │  Process    │     │  + Vectors  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
            ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
            │   Extract   │          │   Chunk     │          │  Generate   │
            │   Content   │          │   Text      │          │  Embeddings │
            └─────────────┘          └─────────────┘          └─────────────┘
```

1. **Source Creation**: User adds a web URL or uploads a document
2. **Job Queue**: Source run creates jobs in BullMQ
3. **Content Extraction**:
   - Web: Scraper Worker fetches and extracts text
   - Upload: Ingestion Worker parses document
4. **Chunking**: Text is split into semantic chunks with metadata
5. **Embedding**: Each chunk is converted to a vector embedding
6. **Storage**: Chunks stored in PostgreSQL, vectors in pgvector

### Chat RAG Pipeline

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   User      │────▶│   API       │────▶│  Retrieve   │────▶│  Generate   │
│   Message   │     │   Server    │     │  Context    │     │  Response   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
            ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
            │   Vector    │          │  Keyword    │          │   Rerank    │
            │   Search    │          │  Search     │          │   Results   │
            └─────────────┘          └─────────────┘          └─────────────┘
```

1. **Query Embedding**: User message is converted to a vector
2. **Hybrid Retrieval**:
   - Vector search finds semantically similar chunks
   - Full-text search finds keyword matches
3. **Reranking**: Results are scored and reordered by relevance
4. **Context Assembly**: Top chunks are assembled as context
5. **LLM Generation**: Response generated with citations
6. **Streaming**: Response streamed back to client

## Multi-Tenancy Architecture

### Data Isolation

Every tenant-specific table includes a `tenant_id` column:

```sql
CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    -- ...
);
```

Row-Level Security (RLS) policies enforce isolation:

```sql
CREATE POLICY tenant_isolation ON knowledge_bases
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### Tenant Hierarchy

```
System
├── System Admins (global access)
└── Tenants
    ├── Owner (full control)
    ├── Admins (manage team & content)
    ├── Members (create content)
    └── Viewers (read-only)
```

### Shared Resources

Some resources can be shared across tenants:
- **Global Knowledge Bases**: Created by system admins, published to all tenants
- **Model Configurations**: LLM providers configured at system level

## Authentication Architecture

### Authentication Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   API       │────▶│  Identity   │
│   Request   │     │   Server    │     │   Provider  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                    │
       │                   ▼                    │
       │           ┌─────────────┐              │
       │           │   Local     │              │
       │           │   Auth DB   │              │
       │           └─────────────┘              │
       │                   │                    │
       └───────────────────┴────────────────────┘
                           │
                           ▼
                   ┌─────────────┐
                   │    JWT      │
                   │   Token     │
                   └─────────────┘
```

### Supported Methods

1. **Local Authentication**
   - Email/password registration
   - Bcrypt password hashing
   - JWT session tokens (7-day expiry)

2. **OIDC Authentication**
   - OpenID Connect protocol
   - Automatic user provisioning
   - Identity federation

### Token Structure

```typescript
interface JWTPayload {
  userId: string;
  email: string;
  isSystemAdmin: boolean;
  iat: number;  // Issued at
  exp: number;  // Expiration
}
```

## Job Queue Architecture

### Queue Structure

```
Redis
├── grounded:source.discover  # Sitemap/URL discovery
├── grounded:source.fetch     # Content fetching
├── grounded:chunk.create     # Text chunking
├── grounded:embed.generate   # Embedding generation
└── grounded:deletion         # Soft delete cleanup
```

### Job Processing

```typescript
// Job Types
interface SourceDiscoverJob {
  sourceId: string;
  tenantId: string;
  runId: string;
}

interface EmbedGenerateJob {
  chunkId: string;
  tenantId: string;
  kbId: string;
}
```

Workers process jobs with:
- Automatic retry on failure
- Rate limiting
- Progress tracking
- Error logging

## Vector Storage Architecture

### Embedding Storage

Vectors are stored separately from relational data:

```
PostgreSQL (Main)          PostgreSQL + pgvector (Vectors)
┌──────────────────┐       ┌──────────────────┐
│ kb_chunks        │       │ embeddings       │
│ ├── id           │──────▶│ ├── id           │
│ ├── content      │       │ ├── embedding    │
│ ├── metadata     │       │ └── dimensions   │
│ └── tenant_id    │       └──────────────────┘
└──────────────────┘
```

### Search Strategy

1. **Vector Search**: Cosine similarity on embeddings
2. **Keyword Search**: PostgreSQL full-text search (tsvector)
3. **Hybrid Fusion**: Combine and deduplicate results
4. **Reranking**: Score-based reordering

## Security Architecture

### API Security

- **Authentication**: JWT tokens required for protected routes
- **Authorization**: Role-based access control per tenant
- **Rate Limiting**: Per-tenant and per-endpoint limits
- **CORS**: Configurable origin whitelist
- **Input Validation**: Zod schemas on all endpoints

### Data Security

- **Encryption at Rest**: Database-level encryption
- **Encryption in Transit**: HTTPS/TLS required
- **Secret Masking**: API keys displayed partially in UI
- **Soft Deletes**: 30-day retention before permanent deletion

### Widget Security

- **Token-based Access**: Unique tokens per widget deployment
- **Domain Whitelist**: Optional origin restrictions
- **Rate Limiting**: Per-token request limits

## Scalability Considerations

### Horizontal Scaling

- **API Servers**: Stateless, can run multiple instances
- **Workers**: Independent processes, scale based on queue depth
- **Database**: Read replicas for query scaling
- **Redis**: Cluster mode for high availability

### Performance Optimizations

- **Connection Pooling**: Database connection reuse
- **Caching**: Redis for frequently accessed data
- **Streaming**: Server-sent events for real-time responses
- **Batch Processing**: Bulk operations where possible

---

Next: [Project Structure](./project-structure.md)
