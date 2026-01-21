# Refactor Overview

## Goals
- Improve maintainability without changing behavior.
- Reduce file size and cross-module coupling.
- Make ownership boundaries clearer (API, ingestion, scraper, web).
- Increase testability and make future changes cheaper.

## Principles
- Refactor in phases with small, reviewable diffs.
- Move code before rewriting logic; preserve runtime behavior.
- Centralize shared patterns (logging, error handling, validation).
- Avoid infra/config changes unless required.
- Validate each phase with focused tests and smoke checks.

## Phases (High Level)
### Phase 0: Baseline and Inventory
- Map critical flows and dependencies.
- Identify hotspots (large files, repeated patterns, cross-cutting logic).
- Capture current behavior expectations and test coverage.

### Phase 1: API Structure and Domain Modules
- Split app assembly into startup, middleware, routes, and app wiring.
- Create domain modules per feature area (routes, schema, service, repo).
- Extract shared helpers for RLS, audit logging, and errors.

### Phase 2: Ingestion Worker Modularization
- Separate queue registration from job handlers.
- Split stage manager into config, progress, transitions, cleanup.
- Move heavy helpers (robots, extraction) into focused services.

### Phase 3: Scraper Worker Modularization
- Extract fetch strategies into dedicated modules.
- Create a browser pool helper.
- Align settings/fairness handling with a shared worker utility.

### Phase 4: Web App Structure
- Add a page registry for labels, routing, and sidebar mapping.
- Introduce providers for auth/tenant/selection state.
- Split API types by domain and keep a stable public API entry.

### Phase 5: Shared Packages and Documentation
- Move shared DTOs/enums/errors into a shared package.
- Add short architecture notes and ownership guidance.
- Clean up dead code and redundant utilities where safe.

## Phase Deliverables
- Each phase gets a dedicated plan in `tasks/` with:
  - Scope and goals
  - Step-by-step tasks (checklist)
  - File moves and module boundaries
  - Risks and validation steps
- Phase files will be created before execution begins.

## Validation (Per Phase)
- `bun run typecheck`
- `bun run lint` (if available per workspace)
- Targeted tests for touched areas
- Manual smoke checks for API and worker startup when relevant
