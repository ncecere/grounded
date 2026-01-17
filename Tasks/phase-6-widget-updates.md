# Phase 6: Widget Updates

## Overview
Update the embeddable chat widget to support reasoning events for advanced RAG agents.

## Tasks

### 6.1 Update Widget Types (`packages/widget/src/types.ts` or similar)
- [ ] Add `ReasoningStep` type
- [ ] Add `reasoning` event type to SSE event union

### 6.2 Update Widget Chat Service
- [ ] Parse `reasoning` events from SSE stream
- [ ] Store reasoning steps in state
- [ ] Expose reasoning data to widget UI

### 6.3 Update Widget UI
- [ ] Create collapsible reasoning panel component (Preact)
- [ ] Show panel only when reasoning steps exist
- [ ] Collapsed by default
- [ ] Minimal styling to fit widget aesthetic
- [ ] Configurable via widget theme (optional: hide reasoning entirely)

### 6.4 Widget Config Extension (Optional)
- [ ] Add `showReasoning: boolean` to widget config
- [ ] Allow hosts to disable reasoning display
- [ ] Default: true (show reasoning when available)

### 6.5 Testing
- [ ] Test widget with simple RAG agent (no reasoning shown)
- [ ] Test widget with advanced RAG agent (reasoning shown)
- [ ] Test expand/collapse behavior
- [ ] Test on mobile viewport

## Dependencies
- Phase 2 (advanced RAG service)
- Phase 3 (API routing)

## Outputs
- Widget displays reasoning steps for advanced agents
- Collapsible panel matches widget theme
- Optional config to hide reasoning
