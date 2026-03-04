# Data Model

All database schemas are defined in `packages/db/src/schema/` using [Drizzle ORM](https://orm.drizzle.team/).

## Entity Relationship Overview

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────┐
│   tenants    │──1:N──│ tenantMemberships │──N:1──│     users       │
│              │       └──────────────────┘       │                 │
│  • id        │                                  │  • id           │
│  • name      │       ┌──────────────────┐       │  • primaryEmail │
│  • slug      │──1:N──│  knowledgeBases  │       │  • disabledAt   │
│  • deletedAt │       │                  │       └────────┬────────┘
└──────┬───────┘       │  • id            │                │
       │               │  • name          │       ┌────────┴────────┐
       │               │  • isGlobal      │       │  userIdentities │
       │               │  • embeddingModel│       │  (OIDC/local)   │
       │               └────────┬─────────┘       └─────────────────┘
       │                        │
       │               ┌───────┴────────┐
       │               │                │
       │        ┌──────┴──────┐  ┌──────┴──────┐
       │        │   sources   │  │  agentKbs   │ (junction)
       │        │             │  └──────┬──────┘
       │        │ • type      │         │
       │        │ • config    │  ┌──────┴──────┐
       │        └──────┬──────┘  │   agents    │
       │               │         │             │
       │        ┌──────┴──────┐  │ • systemPr. │
       │        │  sourceRuns │  │ • ragType   │
       │        │             │  │ • llmModel  │
       │        │ • status    │  └──────┬──────┘
       │        │ • stage     │         │
       │        │ • stats     │    ┌────┴─────────┐
       │        └──────┬──────┘    │              │
       │               │     ┌─────┴─────┐ ┌─────┴──────────┐
       │        ┌──────┴─────┐│retrieval  │ │agentWidget     │
       │        │sourceRun   ││Configs    │ │Configs         │
       │        │Pages       │└───────────┘ └────────────────┘
       │        └──────┬─────┘
       │               │
       │        ┌──────┴──────┐
       │        │  kbChunks   │ ←── text chunks for retrieval
       │        │             │
       │        │ • content   │     ┌────────────────────┐
       │        │ • tsv (FTS) │     │  pgvector DB       │
       │        │ • heading   │     │  (embeddings)      │
       │        └─────────────┘     └────────────────────┘
       │
  ┌────┴──────────┐
  │  chatEvents   │ ←── analytics / usage tracking
  └───────────────┘
```

## Core Tables

### Tenants & Users (`packages/db/src/schema/tenants.ts`)

| Table | Purpose |
|-------|---------|
| `tenants` | Organizations. Has `name`, `slug` (unique), soft delete via `deletedAt`. |
| `users` | User accounts. Has `primaryEmail`, soft disable via `disabledAt`. |
| `userIdentities` | Links users to auth providers (OIDC issuer+subject, or local). |
| `tenantMemberships` | Many-to-many: users ↔ tenants with role (`owner`/`admin`/`member`/`viewer`). |
| `systemAdmins` | Users with system-wide admin access (manages all tenants, models, settings). |
| `userCredentials` | Password hashes for local auth (bcrypt). |
| `systemSettings` | Key-value store for global settings, categorized (`llm`, `auth`, `workers`, etc.). |
| `adminApiTokens` | System admin API tokens for programmatic access. |

### Knowledge & Ingestion (`packages/db/src/schema/knowledge.ts`)

| Table | Purpose |
|-------|---------|
| `knowledgeBases` | Container for knowledge content. Can be tenant-scoped or `isGlobal`. Tracks embedding model + dimensions. Supports reindexing when changing models. |
| `tenantKbSubscriptions` | Lets tenants subscribe to global (shared) knowledge bases. |
| `sources` | Content sources attached to a KB. Type: `web` or `upload`. Config stored as JSONB (`SourceConfig`). |
| `sourceRuns` | Execution record for a source ingestion. Tracks `status`, `stage`, `stats` (pages seen/indexed/failed). |
| `sourceRunPages` | Per-URL records within a run. Tracks HTTP status, content hash, processing status. |
| `sourceRunPageStages` | Per-stage audit trail for each page (discover → fetch → extract → chunk → embed → index). |
| `sourceRunPageContents` | Stores extracted content (HTML → clean text) with headings structure. |

**Source Configuration (`SourceConfig`):**
```typescript
{
  mode: "single" | "list" | "sitemap" | "domain",
  urls?: string[],           // For list mode
  url?: string,              // For single/sitemap/domain
  depth: number,             // Max crawl depth (1-10)
  includePatterns: string[], // URL include globs
  excludePatterns: string[], // URL exclude globs
  includeSubdomains: boolean,
  schedule: "daily" | "weekly" | null,
  firecrawlEnabled: boolean,
  respectRobotsTxt: boolean,
}
```

### Chunks & Vectors (`packages/db/src/schema/chunks.ts`)

| Table | Purpose |
|-------|---------|
| `kbChunks` | Text chunks with metadata. Key fields: `content`, `contentHash`, `heading`, `sectionPath`, `tsv` (tsvector for FTS), `tags`, `entities`, `keywords`, `summary` (enrichment fields). |
| `uploads` | File upload records. Tracks `filename`, `mimeType`, `sizeBytes`, `extractedText`, processing `status`. |

**Vector Storage** (separate pgvector DB):
```typescript
// Vectors are stored in @grounded/vector-store, NOT in the main DB
interface VectorRecord {
  id: string;          // Matches kbChunks.id
  tenantId: string;
  kbId: string;
  sourceId: string;
  embedding: number[]; // Variable dimensions per KB
}
```

### Agents (`packages/db/src/schema/agents.ts`)

| Table | Purpose |
|-------|---------|
| `agents` | AI agents with `systemPrompt`, `ragType` (simple/advanced), `llmModelConfigId`, `welcomeMessage`. |
| `agentKbs` | Junction: agent ↔ knowledge bases (an agent can search multiple KBs). |
| `agentWidgetConfigs` | Widget appearance: theme colors, button style/size/position, allowed domains. |
| `retrievalConfigs` | Per-agent retrieval tuning: `topK`, `candidateK`, `maxCitations`, `similarityThreshold`, `historyTurns`, `advancedMaxSubqueries`. |
| `widgetTokens` | Public tokens for embedding chat widget on websites. |
| `chatEndpointTokens` | Tokens for hosted chat pages and API endpoints. Type: `api` or `hosted`. |

**Retrieval Config Explained:**
```
candidateK (default: 40)    → Broad search pool from vector + FTS
topK (default: 8)           → Chunks included in LLM prompt after reranking
maxCitations (default: 3)   → Sources shown to user in the UI
similarityThreshold (0.5)   → Minimum cosine similarity to include a chunk
```

### AI Models (`packages/db/src/schema/ai-models.ts`)

| Table | Purpose |
|-------|---------|
| `modelProviders` | AI provider configs: `name`, `type` (openai/anthropic/google/openai-compatible), `apiKey`, `baseUrl`. |
| `modelConfigurations` | Specific models within a provider: `modelId`, `modelType` (chat/embedding), `maxTokens`, `temperature`, `dimensions`, `isDefault`. |

### Analytics (`packages/db/src/schema/analytics.ts`)

| Table | Purpose |
|-------|---------|
| `chatEvents` | Every chat interaction: `channel`, `latencyMs`, `promptTokens`, `completionTokens`, `retrievedChunks`, `status`. |
| `apiKeys` | Tenant API keys with `scopes` (`chat`, `read`), `keyHash`, `expiresAt`. |
| `tenantQuotas` | Per-tenant limits: `maxKbs`, `maxAgents`, `maxScrapedPagesPerMonth`, `chatRateLimitPerMinute`. |
| `tenantUsage` | Monthly usage counters: `uploadedDocs`, `scrapedPages`, `chatRequests`, tokens. |
| `tenantAlertSettings` | Alert configuration: `errorRateThreshold`, `quotaWarningThreshold`. |
| `deletionJobs` | Scheduled hard-delete jobs for soft-deleted resources (30-day retention). |

### Audit (`packages/db/src/schema/audit.ts`)

| Table | Purpose |
|-------|---------|
| `auditLogs` | Comprehensive audit trail. Tracks `action` (50+ event types), `resourceType`, `resourceId`, `actorId`, `metadata` (JSONB with change diffs), `ipAddress`. |

**Audit Actions Include:** `auth.login`, `tenant.created`, `agent.updated`, `kb.deleted`, `source.run_triggered`, `settings.updated`, `model.created`, etc.

### Tools & Agentic Features (`packages/db/src/schema/tools.ts`)

| Table | Purpose |
|-------|---------|
| `agentCapabilities` | Feature flags per agent: `agenticModeEnabled`, `toolCallingEnabled`, `multiKbRoutingEnabled`, `multiStepReasoningEnabled`. |
| `toolDefinitions` | Reusable tool configs at tenant level. Types: `api`, `mcp`, `builtin`. Each has typed config (JSONB) and parameter schemas. |
| `agentTools` | Junction: agent ↔ tools with `priority` and per-agent enable/disable. |
| `mcpConnections` | MCP server connection state: `status`, `availableTools`, `lastConnectedAt`. |

### Test Suites (`packages/db/src/schema/test-suites.ts`)

| Table | Purpose |
|-------|---------|
| `agentTestSuites` | Test suite config per agent: `scheduleType`, `llmJudgeModelConfigId`, `alertOnRegression`. |
| `testCases` | Individual test cases: `question`, `expectedBehavior` (JSONB with check types). |
| `testSuiteRuns` | Test execution records: `totalCases`, `passedCases`, `failedCases`. |
| `testCaseResults` | Per-case results: `status`, `actualResponse`, `checkResults` (JSONB). |
| `testRunExperiments` | A/B testing: baseline vs candidate prompt comparison. |
| `testRunPromptAnalyses` | AI-generated analysis of failures with suggested prompt improvements. |

**Expected Behavior Check Types:**
```typescript
{
  checks: [
    { type: "contains_phrases", phrases: ["specific text"], caseSensitive: false },
    { type: "semantic_similarity", expectedAnswer: "...", threshold: 0.8 },
    { type: "llm_judge", expectedAnswer: "...", criteria: "..." }
  ],
  mode: "all" | "any"  // All checks must pass vs any check
}
```

## Tables Requiring Extra Detail

### `uploads`

Tracks file uploads attached to a source:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `tenantId` | uuid | Owner tenant (FK → tenants) |
| `kbId` | uuid | Knowledge base (FK → knowledgeBases) |
| `sourceId` | uuid | Parent source (FK → sources) |
| `sourceRunId` | uuid | Associated run (FK → sourceRuns, nullable) |
| `filename` | text | Original filename |
| `mimeType` | text | MIME type (`application/pdf`, etc.) |
| `sizeBytes` | int | File size |
| `extractedText` | text | Extracted plain text (nullable until processed) |
| `status` | enum | `pending` → `processing` → `succeeded` / `failed` |
| `error` | text | Error message on failure |
| `createdBy` | uuid | User who uploaded |

### `deletionJobs`

Manages the soft-delete → hard-delete lifecycle:

| Column | Type | Purpose |
|--------|------|---------|
| `objectType` | enum | `kb`, `source`, `agent`, `tenant` |
| `objectId` | uuid | ID of the soft-deleted resource |
| `scheduledHardDeleteAt` | timestamptz | When to permanently delete (default: now + 30 days) |
| `status` | enum | `pending` → `running` → `succeeded` / `failed` |

**Index:** Composite on `(status, scheduledHardDeleteAt)` for efficient scanning of due jobs.

### `sourceRunPageStages`

Audit trail for each processing stage of each page:

| Column | Type | Purpose |
|--------|------|---------|
| `pageId` | uuid | FK → sourceRunPages |
| `stage` | enum | `discover`, `fetch`, `extract`, `chunk`, `embed`, `index` |
| `status` | enum | `pending`, `running`, `completed`, `failed` |
| `startedAt` / `completedAt` | timestamptz | Timing |
| `error` | text | Stage-specific error message |

### Foreign Key Relationships Summary

```
tenants ──1:N──→ tenantMemberships ←──N:1── users
tenants ──1:N──→ knowledgeBases ──1:N──→ sources ──1:N──→ sourceRuns ──1:N──→ sourceRunPages
tenants ──1:N──→ agents ──1:N──→ agentKbs ←──N:1── knowledgeBases
tenants ──1:N──→ toolDefinitions ──1:N──→ agentTools ←──N:1── agents
agents ──1:1──→ retrievalConfigs
agents ──1:1──→ agentWidgetConfigs
agents ──1:1──→ agentCapabilities
agents ──1:N──→ widgetTokens
agents ──1:N──→ chatEndpointTokens
agents ──1:N──→ agentTestSuites ──1:N──→ testCases
agentTestSuites ──1:N──→ testSuiteRuns ──1:N──→ testCaseResults
agentTestSuites ──1:N──→ testRunExperiments
knowledgeBases ──1:N──→ kbChunks
knowledgeBases ──1:N──→ tenantKbSubscriptions ←──N:1── tenants
sources ──1:N──→ uploads
modelProviders ──1:N──→ modelConfigurations
```

### Table Count

**35 tables** across 8 schema files. All use UUID primary keys and UTC timestamps.

---

## Soft Delete Pattern

Most entities use soft deletes with a `deletedAt` timestamp column:
- Records are never immediately removed from the database
- Queries filter `WHERE deleted_at IS NULL`
- Unique indexes use partial index: `.where(sql\`deleted_at IS NULL\`)`
- After 30 days, a `deletionJobs` entry schedules hard deletion
- Hard delete workers permanently remove data + associated vectors

## Database Migrations

```bash
# After modifying schema files in packages/db/src/schema/:
bun run db:generate    # Generates SQL migration in migrations/
bun run db:migrate     # Applies pending migrations

# For development only (skips migration files):
bun run db:push        # Push schema directly to DB
```

Migrations run automatically on API startup unless `SKIP_MIGRATIONS=true`.
