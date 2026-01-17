# Phase 3: API Routing & Integration

## Overview
Update all chat endpoints to route to either `SimpleRAGService` or `AdvancedRAGService` based on the agent's `ragType` setting.

## Tasks

### 3.1 Update Admin Chat Route (`apps/api/src/routes/chat.ts`)
- [ ] Import `AdvancedRAGService`
- [ ] Load agent's `ragType` from database
- [ ] Route to appropriate service based on `ragType`
- [ ] Pass through `reasoning` events in SSE stream

### 3.2 Update Widget Chat Helper (`apps/api/src/services/widget-chat-helpers.ts`)
- [ ] Import `AdvancedRAGService`
- [ ] Update `handleWidgetChatStream` to check `agent.ragType`
- [ ] Instantiate correct service and iterate events

### 3.3 Update Chat Endpoint Route (`apps/api/src/routes/chat-endpoint.ts`)
- [ ] Import `AdvancedRAGService`
- [ ] Update streaming handler to check `agent.ragType`
- [ ] Update non-streaming handler to:
  - Collect reasoning steps during execution
  - Include `reasoningSteps` array in JSON response for advanced agents

### 3.4 Update Agent CRUD Routes (`apps/api/src/routes/agents.ts`)
- [ ] Update create endpoint to accept and store `ragType`
- [ ] Update update endpoint to accept and modify `ragType`
- [ ] Update get/list endpoints to return `ragType`
- [ ] Update retrieval config endpoints for new fields

### 3.5 Shared Event Types
- [ ] Create shared SSE event type definitions if not already present
- [ ] Ensure `reasoning` event type is documented

## Dependencies
- Phase 1 (schema & types)
- Phase 2 (advanced RAG service)

## Outputs
- All chat endpoints support both RAG modes
- Agent API supports `ragType` field
- Retrieval config API supports new fields
