# Shared Package Conventions

## Purpose
The shared package (`packages/shared`) centralizes DTOs, enums, errors, and
contracts that are used across the API, workers, web app, and widget. The goal
is to keep these contracts consistent and avoid duplicate definitions while
preserving stable import paths for consumers.

## Export Conventions
- Public shared exports must flow through `packages/shared/src/index.ts`.
- Domain submodules live in `packages/shared/src/types/` and should be referenced
  via export map paths such as `@grounded/shared/types/api`.
- Use compatibility re-exports in legacy locations and annotate with
  `@deprecated` when a type moves into shared.
- Add new shared DTOs in the smallest domain submodule (api/workers/queue/widget,
  analytics/admin) and re-export from `packages/shared/src/types/index.ts` if a
  root barrel is still needed.

## Import Rules
- Prefer `@grounded/shared` or `@grounded/shared/types/<domain>` over deep paths
  like `packages/shared/src/...`.
- Avoid cross-domain imports inside shared; use a domain boundary and re-export
  through the root if a type is used by multiple domains.
- Keep app-specific helper types in their owning app until they are required in
  another domain.

## Backward Compatibility and Deprecation
- When moving a type, keep a compatibility export in the old module until the
  deprecation timeline and removal criteria are satisfied.
- Record the move in `docs/refactor/migration-log.md` and update the adoption
  plan in `tasks/phase-5-shared-packages-docs.md`.
- Use `@deprecated` JSDoc with the new shared import path to guide updates.

## Validation Checklist
- `bun test packages/shared/src/exports-map.test.ts` ensures export map coverage.
- `bun test apps/web/src/lib/api/types/types-imports.test.ts` guards against
  legacy web API type imports.
- Update `docs/refactor/ownership.md` if ownership or escalation paths change.

## References
- `tasks/phase-5-shared-packages-docs.md`
- `docs/refactor/architecture.md`
- `docs/refactor/ownership.md`
