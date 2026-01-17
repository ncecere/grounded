# Phase 1: Shared source logic

Objective
- Extract shared helpers used by sources and shared-kbs routes.

Scope
- Focus on source CRUD validation, update merging, stats queries, and run creation logic.

Targets
- apps/api/src/routes/sources.ts
- apps/api/src/routes/admin/shared-kbs.ts

Notes
- Create a shared module (e.g., apps/api/src/routes/helpers/source-helpers.ts).
- Ensure behavior and error handling stay consistent between routes.
