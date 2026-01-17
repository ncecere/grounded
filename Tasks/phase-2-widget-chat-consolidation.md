# Phase 2: Widget chat consolidation

Objective
- Unify widget /chat and /chat/stream handlers into a shared streaming function.

Scope
- Extract shared SSE setup, RAG streaming, and response assembly.

Targets
- apps/api/src/routes/widget.ts

Notes
- Keep route behavior identical while reducing duplication.
