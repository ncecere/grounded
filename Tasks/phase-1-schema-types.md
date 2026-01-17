# Phase 1: Schema & Types

## Overview
Add database schema changes and update all type definitions to support Advanced RAG mode.

## Tasks

### 1.1 Database Schema Changes
- [ ] Add `rag_type` column to `agents` table
  - Type: `text` with check constraint `simple` | `advanced`
  - Default: `simple`
  - Location: `packages/db/src/schema/agents.ts`

- [ ] Add columns to `retrieval_configs` table
  - `history_turns` (integer, default 5, min 1, max 20)
  - `advanced_max_subqueries` (integer, default 3, min 1, max 5)
  - Location: `packages/db/src/schema/agents.ts`

- [ ] Generate and apply migration
  - Run `bun run db:generate`
  - Review generated SQL
  - Run `bun run db:migrate`

### 1.2 Shared Types (`packages/shared/src/types/index.ts`)
- [ ] Add `RagType` enum: `{ SIMPLE: "simple", ADVANCED: "advanced" }`
- [ ] Update `Agent` interface to include `ragType: RagType`
- [ ] Update `RetrievalConfig` type to include `historyTurns` and `advancedMaxSubqueries`

### 1.3 Web API Types (`apps/web/src/lib/api/types.ts`)
- [ ] Update `Agent` interface to include `ragType`
- [ ] Update retrieval config types for `historyTurns` and `advancedMaxSubqueries`

### 1.4 Web Component Types (`apps/web/src/components/agents/types.ts`)
- [ ] Update `AgentFormData` to include `ragType`
- [ ] Update `RetrievalConfig` to include `historyTurns` and `advancedMaxSubqueries`
- [ ] Update `defaultAgentForm` and `defaultRetrievalConfig`

### 1.5 API Zod Schemas (`apps/api/src/routes/agents.ts`)
- [ ] Update `createAgentSchema` to include `ragType`
- [ ] Update `updateAgentSchema` to include `ragType`
- [ ] Update retrieval config schemas for new fields

## Dependencies
- None (this is the first phase)

## Outputs
- Updated database schema with new columns
- Migration file applied
- All type definitions updated across packages
