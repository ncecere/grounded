# Phase 5: Auth middleware split

Objective
- Split auth middleware into focused modules and re-export a unified middleware.

Scope
- Separate bearer/JWT, API key, admin token, and OIDC auth flows.

Targets
- apps/api/src/middleware/auth.ts

Notes
- Keep the public middleware interface unchanged.
