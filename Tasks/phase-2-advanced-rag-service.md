# Phase 2: Advanced RAG Service

## Overview
Create the `AdvancedRAGService` that implements multi-turn query rewriting, sub-query planning, and step-by-step retrieval with reasoning summaries.

## Tasks

### 2.1 Create Advanced RAG Service File
- [ ] Create `apps/api/src/services/advanced-rag.ts`
- [ ] Define `ReasoningStep` interface for emitted events
  ```typescript
  interface ReasoningStep {
    id: string;
    title: string;
    summary: string;
    status: "pending" | "in_progress" | "completed";
  }
  ```

### 2.2 Implement Core Pipeline
- [ ] Load agent config and retrieval settings
- [ ] Fetch last N turns from Redis conversation (`historyTurns`)
- [ ] **Step 1: Query Rewrite**
  - Use conversation history to rewrite/contextualize the user query
  - Emit `reasoning` event with step summary
- [ ] **Step 2: Plan Generation**
  - Generate multi-step plan with up to `advancedMaxSubqueries` sub-queries
  - Emit `reasoning` event with plan summary
- [ ] **Step 3: Sub-Query Retrieval**
  - Execute retrieval for each sub-query
  - Merge and dedupe results
  - Keep topK chunks for final context
  - Emit `reasoning` event per sub-query completion
- [ ] **Step 4: Final Answer Generation**
  - Build context from merged chunks
  - Stream final answer with citations (same as SimpleRAG)

### 2.3 SSE Event Types
- [ ] Define new event types in service:
  - `reasoning`: `{ type: "reasoning", step: ReasoningStep }`
  - Keep existing: `status`, `text`, `sources`, `done`, `error`

### 2.4 Prompts
- [ ] Create query rewrite prompt (uses conversation history)
- [ ] Create plan generation prompt (outputs structured sub-queries)
- [ ] Reuse existing answer generation prompt from SimpleRAG

### 2.5 Helper Methods
- [ ] `rewriteQuery(query: string, history: ConversationTurn[]): Promise<string>`
- [ ] `generatePlan(query: string): Promise<SubQuery[]>`
- [ ] `retrieveForSubQuery(subQuery: string): Promise<RetrievedChunk[]>`
- [ ] `mergeAndDedupeChunks(allChunks: RetrievedChunk[][]): RetrievedChunk[]`

## Dependencies
- Phase 1 (schema & types) must be complete

## Outputs
- `apps/api/src/services/advanced-rag.ts` with full implementation
- Exported `AdvancedRAGService` class
