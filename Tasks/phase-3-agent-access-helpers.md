# Phase 3: Agent access helpers

Objective
- Create a reusable helper to load agents with tenant ownership checks.

Scope
- Consolidate repeated guard clauses in agent and tool routes.

Targets
- apps/api/src/routes/agents.ts
- apps/api/src/routes/tools.ts

Notes
- Centralize error handling for missing or unauthorized agents.
