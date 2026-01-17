# Phase 7: Testing & Documentation

## Overview
Add tests for the advanced RAG service and update documentation.

## Tasks

### 7.1 Unit Tests for Advanced RAG Service
- [ ] Create `apps/api/src/services/__tests__/advanced-rag.test.ts`
- [ ] Test query rewriting with conversation history
- [ ] Test plan generation (mock LLM responses)
- [ ] Test sub-query retrieval and merging
- [ ] Test event emission order and format
- [ ] Test error handling

### 7.2 Integration Tests
- [ ] Test admin chat endpoint with advanced agent
- [ ] Test widget endpoint with advanced agent
- [ ] Test public API endpoint with advanced agent
- [ ] Verify reasoning events in SSE stream
- [ ] Verify reasoningSteps in non-streaming response

### 7.3 E2E Tests (if applicable)
- [ ] Create agent with advanced RAG mode
- [ ] Send message and verify reasoning steps appear
- [ ] Verify answer quality with multi-turn context

### 7.4 Update CLAUDE.md
- [ ] Document new `ragType` agent setting
- [ ] Document advanced RAG behavior
- [ ] Document new retrieval config fields

### 7.5 API Documentation (if applicable)
- [ ] Document new agent fields in API
- [ ] Document new SSE event types
- [ ] Document non-streaming response changes

### 7.6 Manual Testing Checklist
- [ ] Create simple RAG agent - verify normal behavior
- [ ] Create advanced RAG agent - verify reasoning steps
- [ ] Test multi-turn conversation with advanced agent
- [ ] Test agent edit - switch between RAG types
- [ ] Test widget with both agent types
- [ ] Test public API with both agent types

## Dependencies
- All previous phases

## Outputs
- Test suite for advanced RAG
- Updated documentation
- Verified functionality across all endpoints
