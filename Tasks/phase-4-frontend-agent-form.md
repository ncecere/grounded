# Phase 4: Frontend - Agent Form Updates

## Overview
Update the agent creation/edit form to allow selecting RAG type and configuring advanced mode settings.

## Tasks

### 4.1 Update Agent API Client (`apps/web/src/lib/api/agents.ts`)
- [ ] Update `createAgent` to accept `ragType` parameter
- [ ] Update `updateAgent` to accept `ragType` parameter
- [ ] Update `getRetrievalConfig` return type for new fields
- [ ] Update `updateRetrievalConfig` to accept new fields

### 4.2 Update Agent Form Modal (`apps/web/src/components/agents/AgentFormModal.tsx`)
- [ ] Add `ragType` to form state (default: `simple`)
- [ ] Add RAG Type selector in General or new "Behavior" tab
  - Radio or Select: "Simple RAG" vs "Advanced RAG"
  - Description text explaining each mode
- [ ] Update Search tab with advanced-only settings:
  - History Turns (slider or select, 1-20, default 5)
  - Max Sub-Queries (slider or select, 1-5, default 3)
  - Show these only when `ragType === "advanced"`
- [ ] Update form submission to include `ragType`
- [ ] Update retrieval config submission with new fields

### 4.3 Update Default Values (`apps/web/src/components/agents/types.ts`)
- [ ] Add `ragType: "simple"` to `defaultAgentForm`
- [ ] Add `historyTurns: 5` to `defaultRetrievalConfig`
- [ ] Add `advancedMaxSubqueries: 3` to `defaultRetrievalConfig`

### 4.4 UI Polish
- [ ] Add info tooltips explaining:
  - What Simple RAG does
  - What Advanced RAG does (multi-step planning, query rewrite)
  - What History Turns controls
  - What Max Sub-Queries controls
- [ ] Ensure form validation works correctly

## Dependencies
- Phase 1 (schema & types)
- Phase 3 (API routing - for testing)

## Outputs
- Agent form supports RAG type selection
- Advanced mode settings visible when appropriate
- Form submits correct data to API
