# Grounded web app

React 19 + TypeScript + Vite, with TanStack Router and TanStack Query. `npm run build` writes `dist/`, which `embed.go` embeds in the Go binary (`make web && make build` from the repository root).

```bash
npm ci
npm run dev             # Vite on http://127.0.0.1:5173, proxies /v1, /auth, /healthz to Grounded on :8080
npm run typecheck       # tsc --noEmit
npm test                # vitest: page tests with axe
npm run check:styling   # styling policy (scripts/check-styling.mjs), also run in CI
npm run check:size      # file size limits (scripts/check-size.mjs), also run in CI
npm run build           # type-check + production build into dist/
npm run gen             # regenerate src/api/schema.gen.ts from ../api/openapi.yaml
npm run e2e             # Playwright end-to-end tests against a real server (see "End-to-end tests")
```

## Layout

```
src/
├─ components/ui/   bitop-ui components, installed with the bitop CLI (don't edit by hand, see below)
│  ├─ styles/       bitop.css (entry), tokens.css, global.css, popup.module.css
│  └─ themes/       neutral.css
├─ components/      Grounded-specific shared components
│  ├─ layout/       the app shell: shell, sidebar, team switcher, mode switch, breadcrumbs, command palette
│  └─ …             query-view (loading/error/empty + Load more), confirm-dialog, form-dialog,
│                   person-cell, members, audit, errors
├─ lib/             bitop-utils.ts (installed with the core) and Grounded helpers (use-form-state, limits, …)
├─ pages/           one folder per area, one folder per feature inside it
│                   (e.g. admin/models/{connections,models,profiles}.tsx, team/kbs/, sources/, agents/configure/)
└─ test/            page tests (vitest + testing-library + axe) and unit tests of pure helpers
```

A feature folder keeps its page, dialogs, hooks, pure helpers (`*-form.ts`, tested in `src/test`) and CSS Modules side by side. When a folder holds several routed pages, its `routes.ts` re-exports them and `router.tsx` imports that, so they share one lazy chunk (each extra lazy import adds to the main bundle).

Shared building blocks in `src/components/`:

- **Page templates** in `templates/` (see [its README](src/components/templates/README.md)): `DetailPage`, `SettingsPage` (one sticky save bar and an unsaved-changes guard), `ListPage` (filters in the URL), `RecordSheet` (`?record=`) and `DateRangeFilter`. Build new pages on them.
- Words come from `src/lib/terms.ts` (Discover agents, Passages, Signed-in users, Danger zone…), so the sidebar, titles and breadcrumbs agree.

- `QueryView` renders a query's loading spinner, padded error alert, empty state or content (`<Card flush><QueryView …>`); `LoadMore` is the paging button under an infinite query.
- `ConfirmMutationDialog` is an `AlertDialog` bound to a chosen item and a mutation (busy, error, reset on close).
- `FormDialog` is a dialog with a form, Cancel and a submit button; `useFormState` (`src/lib`) holds a flat form object with a typed `set(field, value)`.

Import components by item, e.g. `import { Button } from "@/components/ui/button/button";` (`@/` is `src/`, configured in `tsconfig.json` and `vite.config.ts`). There is no barrel file, so pages only pull in what they use.

`src/main.tsx` imports `@/components/ui/styles/bitop.css`, which includes the neutral theme, the only theme Grounded ships. Institution branding comes from `INSTANCE_NAME`, `ORG_NAME` and `UI_LOGO_URL`, not from themes in this repository. `UI_THEME` stays as a setting so generic themes can be added later: Grounded writes it into `index.html` as `<html data-brand="…">` (and `INSTANCE_NAME` into `<title>`) when it serves the page, so there is no flash of the wrong theme. Under `npm run dev`, Vite serves its own `index.html`; `src/lib/instance.ts` applies the same values once `GET /v1/auth/config` loads.

Light or dark is the person's (VI-38, [`docs/personal-settings.md`](../docs/personal-settings.md)): `index.html` loads `public/color-mode.js` in `<head>`, which sets `<html data-theme>` from the stored choice or `prefers-color-scheme` before the body is parsed (a file, because the CSP allows no inline script; it must equal bitop-ui's `colorModeScript`, which `src/test/theme.test.tsx` checks). `ColorModeSync` (`components/layout/theme.tsx`) follows the system setting and other tabs while the app is open; the account menu's **Theme** group sets System, Light or Dark (bitop-ui `color-mode`). Pages use tokens only, so both themes come from the theme file; check a page in dark with the system setting or `data-theme="dark"`.

## UI components: bitop-ui

The UI library is [bitop-ui](https://github.com/ncecere/bitop-ui), a copy-and-own component library (Base UI + CSS Modules + CSS variables, no Tailwind). It is the single source of truth: component docs, behaviour tests and accessibility tests live there, and Grounded copies the files in with bitop-ui's CLI, [`@bitop-dev/cli`](https://www.npmjs.com/package/@bitop-dev/cli) (a pinned dev dependency, so `npm ci` installs it). `components.json` maps the aliases (`ui` → `src/components/ui`, `lib` → `src/lib`) and says where items come from; its other fields are left over from the shadcn CLI and ignored. `bitop-lock.json` records a hash of every installed file, which is how the CLI tells upstream changes apart from local edits. Commit both.

### Where components come from (until bitop-ui is hosted)

There is no hosted registry yet, so `components.json` points at a bitop-ui checkout, relative to `web/`:

```json
"registries": { "@bitop": "../../../typescript/bitop-ui" }
```

That matches `~/projects/golang/grounded` next to `~/projects/typescript/bitop-ui`. If your checkout lives elsewhere, pass `--registry <path>` or edit the path. The CLI reads the checkout directly: nothing to build or serve. Pull the checkout first to get the latest components. Once bitop-ui is hosted, set the source to its URL (`https://…/r/{name}.json`).

### Adding or updating components

From `web/` (run it as `npx @bitop-dev/cli`, not `npx bitop`, which is a different npm package):

```bash
npx @bitop-dev/cli add <name>      # add a component (its dependencies come too)
npx @bitop-dev/cli diff            # how every installed item differs from the registry (writes nothing)
npm run ui:check                   # same, but exit 1 on any difference
npx @bitop-dev/cli update          # refresh every installed item; files edited here are skipped and listed
npx @bitop-dev/cli list            # what the registry offers (* = installed)
```

`ui:check` needs the bitop-ui checkout, so it isn't in CI yet; add it there once the registry is hosted.

Then:

1. **Pin new npm dependencies exactly.** Packages Grounded already lists keep their versions, but a *new* dependency is installed with a `^` range. Grounded pins exact versions: use `--no-install`, then `npm install --save-exact` the packages it prints.
2. Run `npm run typecheck && npm test && npm run check:styling && npm run build`.
3. Commit the changed files under `src/components/ui` and `src/lib`, plus `bitop-lock.json`, together with any page changes they need.

Rules:

- **Don't edit files in `src/components/ui` by hand.** Fix or extend the component in bitop-ui (with a docs page and tests), then run `update`. `update` skips files edited here and `diff --check` reports them, but `--overwrite` replaces them.
- `bar-chart` (and the other chart items) come from bitop-ui like every other item.
- **Nothing Grounded-specific goes in `src/components/ui`.** A component that only makes sense for Grounded lives in `src/components/` or next to its page in `src/pages/`. If Grounded needs a generic component bitop-ui doesn't have, add it to bitop-ui first.
- `react-markdown` loads on demand: chat renders `LazyResponse` (from `response/response-lazy`), so Markdown parsing is its own chunk, loaded only on the chat page and the agent editor's Test tab. Keep it that way (don't import `response/response` from shell code).

## End-to-end tests

`e2e/` is a [Playwright](https://playwright.dev) suite that drives the built app in Chromium against a real Grounded, with axe on every page. CI runs it in the `e2e` job; image publishing waits for it.

```bash
make deps-up                       # once: Postgres and Valkey (the compose stack)
make e2e                           # builds the UI and bin/grounded, installs Chromium, runs the suite
make e2e E2E_ARGS="--ui"            # Playwright's UI mode: pick, watch and step through specs
cd web && npx playwright test admin.e2e.ts -g "break-glass"   # after `make web build`: one spec or test
```

**How it runs.** Playwright's `webServer` starts [`tools/e2eserver`](../tools/e2eserver/main.go), which:

- creates its own database, `grounded_e2e` (`E2E_DB_NAME`, which must start with `grounded_e2e`), on the Postgres at `E2E_DATABASE_URL` (default: the compose stack on 127.0.0.1:55432), and drops it when the run ends;
- uses Valkey at `E2E_VALKEY_URL` (default: the compose stack) under a per-run key prefix, deleted at the end;
- serves the fake model gateway on 127.0.0.1:18490 (`E2E_FAKE_ADDR`; `internal/testutil.FakeProxy`, as `make fake-proxy`);
- runs `bin/grounded serve` (`E2E_GROUNDED_BIN`; build it with the UI: `make web build`) on http://127.0.0.1:18480 (`E2E_PORT`) with development sign-in, logging to `e2e-output/server.log`.

Nothing reaches the internet: sources are uploads, and the widget's host pages are served by the spec itself on other loopback ports. It never touches the development server on :8080 or the `grounded` database.

**Projects.** `seed` (`e2e/seed.setup.ts`) signs every development persona in (saving each one's browser state in `e2e-output/.auth/`) and gives the platform the fake models, a default embedding profile, a public moderation policy and public access. `chromium` runs the specs in parallel. `platform` runs `e2e/platform/` afterwards, one test at a time: specs that change the whole platform, such as maintenance mode. Firefox and WebKit are optional locally: `E2E_BROWSERS=firefox,webkit npx playwright test --project=firefox` (after `npx playwright install firefox webkit`).

**Debugging.** A failed test leaves a trace, a screenshot and the page's accessibility snapshot in `e2e-output/test-results/`, and an HTML report in `e2e-output/report/` (`npx playwright show-report e2e-output/report`; `npx playwright show-trace <trace.zip>`). Locally, add `--trace on` to record traces of passing tests too, `--headed` or `--debug` to watch. To keep a server between runs (fast iterations, `--ui`), start it yourself from the repository root, `go run ./tools/e2eserver`, and Playwright reuses it; Ctrl+C stops it and drops its database. CI uploads `e2e-output/` (without the signed-in states) as the `e2e-output` artifact when the job fails.

**Adding a spec.** Add `e2e/<area>.e2e.ts` (`*.e2e.ts`, so vitest doesn't pick it up) and import `test` and `expect` from `./support/fixtures`:

- `as("alex")` opens a signed-in page for a persona (admin, auditor, user, alex, blair, casey) in its own browser context; the plain `page` is signed out.
- Specs run in parallel, so each arranges its own state in its own team: `createTeam(admin, owner, { prefix, members })` and the other helpers in `support/arrange.ts` call the API (`support/api.ts`) as the right persona. Use the UI for what the spec is about, the API for the rest.
- Call `await a11y(page)` on every page once it has rendered, and again for dialogs and sheets worth checking. It runs axe with the WCAG 2.1 A and AA rules and fails on any violation. Each path (plus its `?tab=`) a page visits must be checked at least once, and every page is checked again when the test ends; the fixture fails the test otherwise.
- Wait on what the user would see (`expect(locator).toBeVisible()`, `toHaveURL`, `page.waitForResponse`), never on timers.
- A spec that changes platform-wide state goes in `e2e/platform/` and puts it back in an `afterEach`.
- `npm run typecheck` checks the specs too (`e2e/tsconfig.json`).

## File size

`npm run check:size` (`scripts/check-size.mjs`, run in CI) fails when a file under `src/` is longer than 400 lines, or a test file longer than 700. bitop-ui's `components/ui` and the generated `api/schema.gen.ts` are skipped. Aim for about 350 lines per file and 120 per component: split a growing page into a feature folder (subcomponents, a hook for its queries and mutations, pure helpers with unit tests) before it reaches the limit.

## Styling policy

`npm run check:styling` (`scripts/check-styling.mjs`, adapted from bitop-ui's check, run in CI) applies bitop-ui's rules to all of `src/`, pages included:

- No Tailwind, Radix, CSS-in-JS, `clsx`/`cva`-style utilities or other component kits.
- CSS Modules only: every stylesheet is a `*.module.css`, except bitop-ui's `components/ui/styles` and `components/ui/themes`.
- Tokens only: no literal colours (hex, `rgb()`, `hsl()`, `oklch()`…) in `.ts`, `.tsx` or `.module.css`, no `--palette-*` reads outside the ui folder, no undefined `var(--…)`, and no px or numeric lengths in inline styles (percentages and custom properties are fine).
  Colour *data* is the one exception: values stored per record, such as the agent accent presets and default, live in `*.colors.ts` files (`src/pages/agents/accents.colors.ts`), which may hold literal colours and nothing that renders.
- Behaviour comes from Base UI: every ui item is built on `@base-ui/react`, and pages never hand-roll popups (`role="dialog"`/`menu`/`listbox`/`tooltip`/`tab`, `aria-haspopup`, portals); use the bitop-ui components. Plain show/hide buttons with `aria-expanded` are fine.

Tests (`src/test`) and the generated API schema are not checked.
