# Shared Packages

All shared packages live in `packages/` and are referenced in the monorepo as `@grounded/<name>`.

## `@grounded/db`

**Purpose:** Drizzle ORM schema definitions, database client, and migrations.

```typescript
import { db } from "@grounded/db";
import { agents, kbChunks, chatEvents } from "@grounded/db/schema";

// Type-safe queries
const agent = await db.query.agents.findFirst({
  where: and(eq(agents.id, id), isNull(agents.deletedAt)),
});

// Inserts
await db.insert(chatEvents).values({ ... });
```

**Key files:**
- `src/schema/` — All table definitions (see [Data Model](./03-data-model.md))
- `src/client.ts` — Database connection pool
- `drizzle.config.ts` — Migration config

## `@grounded/shared`

**Purpose:** Shared types, constants, Zod schemas, and utilities used across all apps and packages.

**Exports:**
- **Types:** `SourceConfig`, `RetrievalConfig`, `WidgetTheme`, `TenantRole`, `IngestionStage`, `StageStatus`, all job payload types
- **Constants:** `CHUNK_SIZE_TOKENS`, `QUEUE_NAMES`, `HTML_CONTENT_TYPES`, rate limits, TTLs
- **Zod schemas:** `sourceConfigSchema`, `widgetThemeSchema`, all job payload schemas
- **Utilities:** `getEnv()`, `extractDomainFromUrl()`, concurrency helpers
- **Job helpers:** `validateJobPayload()`, `isWebSourcePayload()`, type guards

```typescript
import { QUEUE_NAMES, IngestionStage, sourceConfigSchema, getEnv } from "@grounded/shared";
```

## `@grounded/queue`

**Purpose:** BullMQ queue definitions, job enqueuing helpers, conversation store, fairness scheduler.

**Key exports:**
- **Queues:** `sourceRunQueue`, `pageFetchQueue`, `pageProcessQueue`, `pageIndexQueue`, `embedChunksQueue`, `enrichPageQueue`, `deletionQueue`, `kbReindexQueue`
- **Connection:** `connection` (BullMQ ConnectionOptions), `redis` (ioredis client)
- **Conversation:** `getConversation()`, `addToConversation()`, `clearConversation()`
- **Fairness:** `FairnessScheduler` class for fair resource allocation

```typescript
import { pageFetchQueue, connection, getConversation, addToConversation } from "@grounded/queue";

// Enqueue a job
await pageFetchQueue.add("page-fetch", {
  tenantId: "...",
  runId: "...",
  url: "https://example.com",
  fetchMode: "auto",
});

// Get conversation history
const history = await getConversation(tenantId, agentId, conversationId);
```

## `@grounded/ai-providers`

**Purpose:** Multi-provider AI model registry. Wraps Vercel AI SDK provider packages.

**Interface:** `AIProviderRegistry`
```typescript
import { getAIRegistry } from "@grounded/ai-providers";

const registry = getAIRegistry();

// Get LLM model for chat
const model = await registry.getLanguageModel(modelConfigId);

// Get embedding model
const embedModel = await registry.getEmbeddingModel(modelConfigId);

// List all available models
const models = await registry.listModels("chat");
```

**Supported providers:**
- OpenAI (`openai`)
- Anthropic (`anthropic`)
- Google (`google`)
- OpenAI-compatible (`openai-compatible`) — Groq, Together, Ollama, etc.

Models are loaded from the `model_providers` + `model_configurations` database tables.

## `@grounded/embeddings`

**Purpose:** Embedding generation wrapper.

```typescript
import { generateEmbedding, generateEmbeddings } from "@grounded/embeddings";

// Single text
const { embedding } = await generateEmbedding("query text");

// Batch (for chunk embedding)
const results = await generateEmbeddings(["text1", "text2", ...]);
```

Uses the configured default embedding model from `@grounded/ai-providers`.

## `@grounded/vector-store`

**Purpose:** Abstract vector storage interface with pgvector implementation.

```typescript
import { getVectorStore } from "@grounded/vector-store";

const store = await getVectorStore();

// Store vectors
await store.upsert([{
  id: chunkId,
  tenantId,
  kbId,
  sourceId,
  embedding: [0.1, 0.2, ...],
}]);

// Search
const results = await store.search(queryEmbedding, {
  tenantId,
  kbIds: ["kb-1", "kb-2"],
  topK: 40,
  minScore: 0.5,
});

// Delete by metadata
await store.deleteByMetadata({ sourceId });
```

**Interface:** `VectorStore` with methods: `initialize()`, `upsert()`, `search()`, `delete()`, `deleteByMetadata()`, `healthCheck()`, `count()`, `close()`.

## `@grounded/logger`

**Purpose:** Structured logging based on pino, with wide event middleware and worker job logging.

```typescript
import { log } from "@grounded/logger";

log.info("api", "Processing request", { tenantId, agentId });
log.error("api", "Failed to embed", { error: error.message });
```

**Sub-modules:**
- `@grounded/logger/middleware` — Hono middleware for wide event logging (request/response details, timing, sampling)
- `@grounded/logger/worker` — `createWorkerLogger()`, `createJobLogger()` for BullMQ worker jobs

**Features:**
- Wide event format (single log entry per request with all context)
- Configurable sampling (`LOG_SAMPLE_RATE`)
- Always log errors and slow requests
- Service and operation tagging

## `@grounded/crawl-state`

**Purpose:** Redis-based crawl state machine for domain crawling. Tracks URL deduplication, state transitions, and progress across concurrent scraper workers.

**File:** `packages/crawl-state/src/index.ts` (350+ lines)

### State Flow

```
URL discovered → queueUrl() → urls:queued
                    ↓ (page fetched)
               markFetched() → urls:fetched
                    ↓ (content extracted & chunked)
               markProcessed() → urls:processed
                    ↓ (error during any step)
               markFailed() → urls:failed + errors hash
```

### Redis Key Structure

All keys are namespaced by source run ID: `crawl:{runId}:{suffix}`

| Key Suffix | Type | Purpose |
|------------|------|---------|
| `urls:all` | Set | All URLs ever seen (for deduplication) |
| `urls:queued` | Set | Discovered but not yet fetched |
| `urls:fetched` | Set | Downloaded but not yet processed |
| `urls:processed` | Set | Fully processed (chunks created) |
| `urls:failed` | Set | Failed URLs |
| `urls:original` | Hash | Normalized URL → original URL mapping |
| `errors` | Hash | Normalized URL → error message |
| `meta` | Hash | Crawl metadata (config, options) |

**TTL:** 24 hours (configurable), applied to all keys.

### URL Normalization

All URL operations normalize before storage to prevent duplicates:
- Removes trailing slashes (except root)
- Strips `www.` prefix
- Removes default ports (`:80`, `:443`)
- Removes `index.html`/`index.php` suffixes
- Sorts query parameters alphabetically
- Lowercases hostname

Example: `https://www.Example.com:443/docs/index.html?b=2&a=1` → `example.com/docs?a=1&b=2`

### Atomic Operations

All URL operations use Redis pipelines (`SADD` + `SREM`) for atomicity:
- `queueUrl()` — `SADD urls:all` returns 1 if new (CAS pattern)
- `queueUrls()` — Batch version with pipeline, returns only new URLs
- Maximum URL limit enforced (default: 10,000) — checked before adding

### Progress Tracking

```typescript
const progress = await crawlState.getProgress();
// { queued: 45, fetched: 12, processed: 180, failed: 3, total: 240, percentComplete: 76 }

const isComplete = await crawlState.isComplete();
// true when queued === 0 && fetched === 0
```

### Usage

```typescript
import { createCrawlState } from "@grounded/crawl-state";

const crawlState = createCrawlState(redis, sourceRunId, { maxUrls: 5000 });
const newUrls = await crawlState.queueUrls(discoveredLinks);
await crawlState.markFetched(url);
await crawlState.markProcessed(url);
await crawlState.cleanup(); // Delete all Redis keys when done
```

## `@grounded/llm`

**Purpose:** LLM interaction wrapper (thin layer over AI SDK).

## `@grounded/connectors`

**Purpose:** External service connectors (placeholder for future integrations).

## `@grounded/widget`

**Purpose:** Embeddable Preact chat widget with Shadow DOM isolation. Used for both embedded widgets and hosted chat pages.

### Architecture

```
Host page loads widget.js
  └── index.tsx: createShadowDOM() → render(<Widget />) into Shadow DOM
        ├── Widget.tsx — Floating button + expandable chat panel
        │   ├── useConfig() — Fetches agent config via /api/v1/c/:token/config
        │   └── useChat() — Manages messages, SSE streaming, conversation state
        │       ├── Message.tsx — Renders user/assistant messages with citations
        │       └── ReasoningPanel.tsx — Shows Advanced RAG reasoning steps
        │
        └── published-chat.tsx — Full-page variant (no floating button)
              └── FullPageChat.tsx — Full-screen chat interface
```

### Shadow DOM Isolation

**File:** `src/lib/shadow-dom.ts`

The widget renders inside a Shadow DOM to prevent CSS conflicts with the host page:

```typescript
createShadowDOM({
  containerId: "grounded-widget",
  colorScheme: "auto",  // "light" | "dark" | "auto"
})
// 1. Creates <div id="grounded-widget"> in document.body
// 2. Attaches shadow root (mode: "open")
// 3. Injects <style> with all widget CSS (from styles.ts)
// 4. Applies theme class based on colorScheme
// 5. For "auto": listens to prefers-color-scheme media query
```

All CSS is embedded in `styles.ts` as a string constant — no external stylesheets needed.

### `useChat` Hook

**File:** `src/hooks/useChat.ts` (295 lines)

Core chat state management with SSE parsing:

```typescript
const { messages, sendMessage, isLoading, sources, reasoningSteps } = useChat({
  token: "widget-token",
  baseUrl: "/api/v1/c",
});
```

**SSE parsing flow:**
1. `POST /:token/chat` with `{ message, conversationId }`
2. Parse response as SSE: `data: {json}\n\n`
3. Route events by `type`:
   - `status` → update loading state
   - `text` → append to current assistant message (character-by-character streaming)
   - `sources` → store source citations
   - `reasoning` → update reasoning steps display
   - `done` → save `conversationId` for follow-ups
   - `error` → show error message

**Conversation persistence:** `conversationId` is stored in state and sent with each subsequent message for multi-turn context.

### Two Entry Points

| Entry | File | Use Case |
|-------|------|----------|
| **Widget** | `src/index.tsx` | Embedded on external sites — floating button in corner |
| **Published Chat** | `src/published-chat.tsx` | Full-page hosted chat — no floating button |

Both share the same components and hooks, just different container layouts.

### Widget Initialization

```html
<!-- Embed on any page -->
<script src="https://your-instance.com/widget.js"
        data-token="YOUR_WIDGET_TOKEN"
        data-color-scheme="auto">
</script>
```

The script:
1. Reads `data-token` and `data-color-scheme` from the `<script>` tag
2. Creates a Shadow DOM container
3. Renders the `<Widget>` component with Preact

### Build

Built with Vite, outputs a single self-contained JS file:
- No external dependencies at runtime (Preact is bundled)
- CSS is inlined (no FOUC)
- ~30KB gzipped

### File Map

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.tsx` | 209 | Widget entry point, Shadow DOM setup, Preact render |
| `src/published-chat.tsx` | 102 | Published chat entry point |
| `src/components/Widget.tsx` | — | Floating button + chat panel |
| `src/components/FullPageChat.tsx` | — | Full-page chat layout |
| `src/components/Message.tsx` | — | Message bubble with citation rendering |
| `src/components/ReasoningPanel.tsx` | — | Advanced RAG step display |
| `src/components/Icons.tsx` | — | SVG icon components |
| `src/hooks/useChat.ts` | 295 | Chat state, SSE parsing, message management |
| `src/hooks/useConfig.ts` | 53 | Widget config fetching |
| `src/lib/shadow-dom.ts` | 95 | Shadow DOM creation and theme management |
| `src/styles.ts` | — | All CSS as embedded string |
| `src/types.ts` | 115 | TypeScript types for widget config and messages |
