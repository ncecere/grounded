# RAG & Chat System

## Overview

Grounded implements two RAG (Retrieval-Augmented Generation) modes:

1. **Simple RAG** — Fast, single-pass retrieval + response generation
2. **Advanced RAG** — Multi-step reasoning with query rewriting, sub-query planning, and visible reasoning steps

Both modes use **hybrid search** combining vector similarity and full-text search with Reciprocal Rank Fusion (RRF).

## Hybrid Search

**File:** `apps/api/src/services/hybrid-search.ts`

The search pipeline merges two signals:

### Vector Search (pgvector)
- Generates embedding for user query via configured embedding model
- Cosine distance search against pgvector database
- Filtered by `tenantId` + `kbIds`
- Returns `candidateK` results (default: 40)
- Minimum `similarityThreshold` (default: 0.5)

### Full-Text Search (PostgreSQL)
- Uses `plainto_tsquery` against `kb_chunks.tsv` column (tsvector)
- Ranked by `ts_rank_cd` (cover density ranking)
- Filtered by `tenantId` + `kbIds`
- Returns `candidateK` results

### Reciprocal Rank Fusion (RRF)
- Merges vector and FTS results using industry-standard RRF formula:
  ```
  RRF_score(d) = Σ  1 / (k + rank_i(d))
  ```
  where `k = 60` (standard constant from Cormack et al. 2009)
- Equal weight between vector and FTS by default (`vectorWeight: 0.5`)
- Produces a unified ranked list
- Top `topK` results (default: 8) are included in the LLM prompt
- Top `maxCitations` (default: 3) are shown to the user

## Simple RAG

**File:** `apps/api/src/services/simple-rag.ts`  
**Class:** `SimpleRAGService`

### Flow
```
1. loadConfig()          — Agent config from DB (cached 60s in Redis)
2. getConversation()     — Chat history from Redis
3. searchKnowledge()     — Hybrid search pipeline
4. buildSystemPrompt()   — Inject context chunks into system prompt
5. streamText()          — Stream LLM response via Vercel AI SDK
6. addToConversation()   — Store turn in Redis
7. logUsage()            — Record to chat_events for analytics
```

### System Prompt Construction
```
{agent's custom system prompt}

CONTEXT:
[1] Title: Page Title
Chunk content here...

[2] Title: Another Page
More chunk content...
```

### Conversation History
- Stored in Redis with key pattern: `conv:{tenantId}:{agentId}:{conversationId}`
- TTL: 1 hour (`CONVERSATION_TTL_SECONDS`)
- Max turns: 20 (`MAX_CONVERSATION_TURNS`)
- Full history included in messages array sent to LLM

## Advanced RAG

**File:** `apps/api/src/services/advanced-rag.ts`  
**Class:** `AdvancedRAGService`

### 5-Step Reasoning Pipeline

Each step emits `reasoning` SSE events so the UI can show progress:

#### Step 1: REWRITE
- Uses recent conversation history (`historyTurns`, default: 5)
- LLM rewrites the user's query as a standalone question
- Resolves pronouns and references from context
- Example: "Tell me more about that" → "Tell me more about the RAG pipeline architecture"

#### Step 2: PLAN
- LLM generates sub-queries (up to `advancedMaxSubqueries`, default: 3)
- Each sub-query targets a different aspect of the question
- Uses structured output (Zod schema) for reliable parsing
- Example: "How does auth work?" → ["What authentication methods are supported?", "How are user roles defined?", "How does OIDC integration work?"]

#### Step 3: SEARCH
- Executes parallel hybrid searches for each sub-query
- Each search: embed query → vector search → FTS → RRF merge
- All results collected across sub-queries
- Embeddings cached in Redis (5min TTL)

#### Step 4: MERGE
- Deduplicates chunks across sub-query results (by chunk ID)
- Takes the best score for duplicates
- Re-ranks the combined set
- Selects top `topK` chunks for the final prompt

#### Step 5: GENERATE
- Builds system prompt with all merged context
- Streams final response via LLM
- Includes conversation history for coherent follow-ups

### Reasoning Events (SSE)
```json
{
  "type": "reasoning",
  "data": {
    "id": "step-uuid",
    "type": "rewrite|plan|search|merge|generate",
    "title": "Rewriting query...",
    "summary": "Resolved to: What authentication methods does Grounded support?",
    "status": "pending|in_progress|completed|error",
    "details": { /* step-specific data */ }
  }
}
```

## Chat Channels

Chat can happen through four channels:

| Channel | Authentication | Endpoint |
|---------|---------------|----------|
| `admin_ui` | JWT Bearer token | `POST /api/v1/chat` |
| `widget` | Widget token | `POST /api/v1/widget/chat` |
| `api` | API key or chat endpoint token | `POST /api/v1/c/chat` |
| `chat_endpoint` | Chat endpoint token | `POST /api/v1/c/chat` |

All channels use the same RAG services underneath.

## Caching Strategy

| What | Key Pattern | TTL | Purpose |
|------|------------|-----|---------|
| Agent config | `agent_config:{tenantId}:{agentId}` | 60s | Avoid DB hits per chat |
| Query embedding | `embed:{modelConfigId}:{hash(query)}` | 5min | Avoid re-embedding same query |
| Conversation | `conv:{tenantId}:{agentId}:{convId}` | 1hr | Chat history |

## Rate Limiting

- Per-tenant chat rate limit: configurable via `tenantQuotas.chatRateLimitPerMinute` (default: 60/min)
- Applied via middleware on chat endpoints

## Widget Integration

The chat widget (`packages/widget/`) is a Preact component that:

1. Loads config from `/api/v1/widget/config?token=<token>`
2. Renders a floating button (customizable style/position/icon)
3. Opens a chat panel on click
4. Streams responses via SSE from `/api/v1/widget/chat`
5. Renders in Shadow DOM to avoid CSS conflicts with host page
6. Shows reasoning steps panel for Advanced RAG agents (configurable)
7. Supports light/dark/auto color schemes

### Embedding the Widget
```html
<script src="https://your-grounded-host/widget.js"></script>
<script>
  Grounded.init({
    token: "your-widget-token",
    apiBase: "https://your-grounded-host",
    position: "bottom-right",
    colorScheme: "auto",
    showReasoning: true
  });
</script>
```

## Hosted Chat

For full-page chat experiences (no widget embed needed):
- Create a chat endpoint token with type `hosted`
- Access at `https://your-host/chat/<token>`
- Full-page HTML served by the API with embedded chat UI
