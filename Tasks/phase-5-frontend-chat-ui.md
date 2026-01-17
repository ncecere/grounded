# Phase 5: Frontend - Chat UI Updates

## Overview
Update the chat UI to display reasoning steps for advanced RAG agents in a collapsible panel.

## Tasks

### 5.1 Update Chat API Client (`apps/web/src/lib/api/chat.ts`)
- [ ] Update `simpleChatStream` to handle `reasoning` events
- [ ] Add `onReasoning` callback parameter:
  ```typescript
  onReasoning?: (step: ReasoningStep) => void
  ```
- [ ] Parse and forward `reasoning` events to callback

### 5.2 Create Reasoning Steps Component
- [ ] Create `apps/web/src/components/chat/ReasoningSteps.tsx`
- [ ] Props: `steps: ReasoningStep[]`, `isExpanded: boolean`, `onToggle: () => void`
- [ ] Display:
  - Collapsible header with step count (e.g., "Reasoning (3 steps)")
  - List of steps with title, summary, and status indicator
  - Subtle styling (muted colors, smaller text)
- [ ] Animation for expand/collapse

### 5.3 Update Chat Page (`apps/web/src/pages/Chat.tsx`)
- [ ] Add state for reasoning steps: `reasoningSteps: ReasoningStep[]`
- [ ] Add state for panel visibility: `showReasoning: boolean` (default: false)
- [ ] Pass `onReasoning` callback to stream function
- [ ] Clear reasoning steps on new message
- [ ] Render `ReasoningSteps` component above assistant message when steps exist
- [ ] Show toggle button only for advanced agents

### 5.4 Update Message Bubble Component
- [ ] Optionally show reasoning steps inline with message
- [ ] Or show as separate collapsible above the response
- [ ] Handle streaming state for reasoning (show spinner for in-progress steps)

### 5.5 Styling
- [ ] Add CSS/Tailwind classes for reasoning panel
- [ ] Ensure it doesn't disrupt chat flow
- [ ] Mobile-responsive design
- [ ] Match existing chat UI aesthetics

## Dependencies
- Phase 2 (advanced RAG service - for event format)
- Phase 3 (API routing - for testing)

## Outputs
- Chat UI displays reasoning steps for advanced agents
- Steps are collapsed by default
- User can expand to see reasoning details
