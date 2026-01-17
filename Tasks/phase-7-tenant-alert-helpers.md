# Phase 7: Tenant alert helpers

Objective
- Move tenant alert validation and defaulting into a helper module.

Scope
- Extract parsing, validation, and defaulting logic used by tenant routes.

Targets
- apps/api/src/routes/tenants.ts

Notes
- Keep the route handler slim and consistent.
