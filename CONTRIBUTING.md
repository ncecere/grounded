# Contributing

Thanks for helping. This file covers how to set up, test and submit changes. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [`SECURITY.md`](SECURITY.md), not in issues.

## Before you start

- For anything larger than a small fix, open an issue first and describe the problem and the change you have in mind.
- Read [`docs/DESIGN.md`](docs/DESIGN.md) for the part you're changing, and the ADRs it cites.
- A change to a design decision needs an ADR (see "Design decisions" below).

## Development setup

Requires Go 1.26+, Node 22+ and Docker. `make generate` also needs [sqlc](https://sqlc.dev) (CI uses 1.31.1) on your `PATH` or in `~/go/bin`.

```sh
make deps-up     # Postgres (pgvector) + Valkey via docker compose, on loopback ports
make web         # build the UI (embedded into the binary)
make run         # builds bin/grounded, creates .env from .env.example if needed, runs `grounded serve`
make fake-proxy  # optional: a fake OpenAI-compatible gateway on :8090 (key sk-dev-fake)
make fake-mcp    # optional: a fake remote MCP server on :8091/mcp (docs/mcp-client.md)
make dev-up      # optional, instead of deps-up and fake-proxy: both, with the fake gateway in Docker
make web-dev     # optional: Vite with hot reload on :5173, proxying the API to :8080
make mail-up     # optional: Mailpit catches notification email (inbox http://127.0.0.1:8025)
```

- Open http://localhost:8080 and choose a development persona: `admin` (platform admin), `auditor` (platform auditor), or `user`, `alex`, `blair` and `casey` (no platform role; add them to teams). Development sign-in is refused unless `APP_URL` is a loopback address. Never expose it.
- **Models without a real gateway:** run `make fake-proxy`, then in the admin portal add a connection with base URL `http://127.0.0.1:8090/v1` and key `sk-dev-fake`. It offers `gpt-oss-120b` (chat), `nomic-embed-text-v1.5` (768 dimensions) and `sfr-embedding-mistral` (4096 dimensions). To get sample data instead, seed the demo ([`docs/demo.md`](docs/demo.md), "Seeding an existing install").
- **Hot reload:** run `make run` and `make web-dev` together and open http://localhost:5173.
- **Email:** with `make mail-up`, set `SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_TLS=none` in `.env`.
- **After a Docker or machine restart:** the compose services have `restart: unless-stopped`, so Postgres, Valkey, the OCR sidecar, Mailpit and the Docker fake gateway come back by themselves once Docker is running (the first `make deps-up` after updating `compose.yaml` recreates the containers; the data is kept). `make deps-up` also starts the OCR sidecar (compose profile `ocr`, built on first use) when `.env` sets `OCR_TESSERACT_URL=http://127.0.0.1:58080`. `make fake-proxy` runs in your terminal and doesn't come back; `make dev-up` runs the same fake gateway in Docker (compose profile `fake`: this checkout's code, compiled when it starts, so the first start takes a minute), so stop `make fake-proxy` first, or set `FAKE_PROXY_PORT` for another port.
- `make deps-down` stops the dependencies, the OCR sidecar, the Docker fake gateway and Mailpit, and keeps their data. `make help` lists every target.

Settings come from environment variables (optionally layered over a YAML file named by `GROUNDED_CONFIG_FILE`); [`.env.example`](.env.example) describes each one.

Never commit `.env`, `ai.env` (credentials for a real model gateway) or anything else that holds a secret. Both are in `.gitignore`.

## Tests

| Command | What it runs |
|---|---|
| `make test` | All Go tests with `-race`, including integration tests against the compose Postgres and Valkey. **Run `make deps-up` first.** |
| `make test-authz` | The authorization matrix alone (`TestAuthorizationMatrix*` in `internal/httpapi`): every API operation as every kind of caller. `make test SKIP_AUTHZ=1` runs everything else. |
| `make test-unit` | Go tests that need no infrastructure (integration tests skip) |
| `make web-test` | UI type-check and vitest tests, including axe accessibility checks on every page |

- Integration tests find the dependencies through `GROUNDED_TEST_DATABASE_URL` and `GROUNDED_TEST_VALKEY_URL`; the Makefile points them at the compose services.
- S3 blob tests run when `GROUNDED_TEST_S3_*` is set. Start a local S3-compatible store with `docker compose --profile s3 up -d minio minio-init`; the variables are listed in `internal/blob/s3_test.go`.
- Tests against a real model gateway are opt-in (`GROUNDED_LIVE_LLM=1`) and never required. Use the fake gateway (`cmd/fakeproxy`, `testutil.FakeProxy`) instead.
- Add or update tests with every behaviour change. Bug fixes come with a test that fails without the fix.

CI's `test` job runs, in order: `make check-generated`, `make lint`, `npm run check:styling` (in `web/`), `make web-test`, `make test SKIP_AUTHZ=1` and `make web build`; the `authz` job runs `make test-authz` alongside it. Run the same (or plain `make test`, which includes the matrix) before opening a pull request. The required checks on `main` are `test`, `authz`, `e2e`, `k8s` and `k8s-smoke`.

## Code style

- **Go:** `gofmt` (`make fmt`). `make lint` runs gofmt, `go vet`, staticcheck, govulncheck and the size and complexity guards below, and must pass.
- **Web:** TypeScript strict, `npm run typecheck` in `web/`. The styling policy (`npm run check:styling`) allows Base UI components, CSS Modules and design tokens only: no Tailwind, no CSS-in-JS, no literal colours. Details in [`web/README.md`](web/README.md#styling-policy).
- Follow the patterns around the code you change. Prefer small packages with clear responsibilities (ADR-0001).
- Comments explain why, and cite the DESIGN section or ADR the code implements (for example `DESIGN.md §5.5`).

## Code size and complexity

Keep files and functions small enough to read in one go. `make lint` (and so CI) enforces hard limits on non-generated Go code:

| | Target | Lint fails above |
|---|---|---|
| Lines per file | ~500 | 600 (test files: 1200) |
| Lines per function | ~80 | 100 (test functions: no limit) |
| Cyclomatic complexity per function ([gocyclo](https://github.com/fzipp/gocyclo)) | ≤ 20 | 20 (tests exempt) |

- Generated code (`internal/store/dbgen`, `internal/httpapi/apitypes`, `*.gen.go`, files marked `Code generated ... DO NOT EDIT.`) is exempt.
- The file and function limits are checked by `tools/checksize`; run `go run ./tools/checksize -file 500 -func 80 cmd internal tools` to see what is over the targets.
- When a file grows, split it by responsibility into files in the same package (for example `agents`: `chat.go`, `history.go`, `answer.go`, `record.go`). When a function grows, extract named steps; for long validation, use one small validator per section and keep error codes, messages and field paths unchanged.
- HTTP handlers share the small helpers in `internal/httpapi/respond.go` (`decodeRevised`, `failed`, `writeRevised`, `writeList`, `writeOK`) instead of repeating the decode, precondition and response plumbing.
- A parser ported from another project may exceed the complexity limit only if splitting it would hurt readability: mark it `//gocyclo:ignore` with a comment on the line above saying why, and keep it at 30 or below. There are none at the moment.

## Generated code

`make generate` regenerates:
- sqlc queries: `internal/store/queries/*.sql` → `internal/store/dbgen`
- Go API types: `api/openapi.yaml` → `internal/httpapi/apitypes` (oapi-codegen)
- TypeScript API types: `api/openapi.yaml` → `web/src/api/schema.gen.ts` (openapi-typescript)

Commit generated files with the change that caused them, and never edit them by hand. CI fails if they are stale (`make check-generated`).

## API changes: OpenAPI first

1. Change [`api/openapi.yaml`](api/openapi.yaml) first: paths, schemas, error codes and examples.
2. Run `make generate`.
3. Implement the handler and the UI against the generated types.

- A test fails if the routes the server serves and the spec differ.
- Success responses are `{"data": …}`; errors are `{"error": {"code", "message"}}`.
- Admin writes take a revision precondition (`If-Match`): missing is 428, stale is 412.
- Examples use `example.edu` and a generic OpenAI-compatible gateway, never a real institution or vendor (ADR-0018).

## Database

- Queries live in `internal/store/queries/*.sql`; sqlc generates the Go.
- Migrations live in `migrations/`. They are forward-only and **expand/contract** (ADR-0013): each release's schema must work with both the previous and the new code, and destructive steps ship one release later.
- Migrations create structure, not deployment data. Starting data belongs to first-run configuration (ADR-0018).
- Changes are audited in the same transaction as the change itself. `audit_log` is append-only.

## UI components

UI components come from the [bitop-ui](web/README.md#ui-components-bitop-ui) registry and are installed into `web/src/components/ui` with the shadcn CLI.
- Don't edit files in `web/src/components/ui` by hand. Fix or extend the component in bitop-ui, then re-install it.
- Grounded-specific components live in `web/src/components/` or next to their page in `web/src/pages/`.
- [`web/README.md`](web/README.md) explains how to serve the registry locally and update components.

## Accessibility

The bar is **WCAG 2.1 AA** for every page and component.
- Every page has a vitest test with axe. New pages need one.
- Everything works with the keyboard, focus is visible and managed (dialogs, sending a message), and streaming content isn't announced token by token.
- Check colour contrast against the tokens, including the agent accent colours.
- For UI changes, include screenshots in the pull request and say how you checked keyboard and screen-reader use.

## Keep it institution-neutral

The product names no institution, gateway vendor or jurisdiction in code, migrations, default configuration, UI text or examples (ADR-0018). The repository holds no institution-specific profiles, themes, fixtures, test data or evaluation sets (ADR-0023): tests use `example.edu`, "Example University" and similar names. If a feature needs an institution-specific value, add a setting with a neutral default; each install records its value in its own [deployment profile](docs/deployments/README.md), kept outside the repository.

## Design decisions (ADRs)

Significant decisions are recorded in [`docs/adr/`](docs/adr/README.md), which explains the format and process:
1. Copy the format into the next free number, with status `Proposed`, and open a pull request.
2. Set it to `Accepted` once agreed, and add it to the index.
3. Update `DESIGN.md` in the same pull request if the design changes. DESIGN.md and the ADRs must agree.

Accepted ADRs are historical records: don't rewrite their substance. To change a decision, write a new ADR that supersedes the old one.

## Dependency updates (Dependabot)

Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) opens one grouped pull request per ecosystem each week: Go modules, npm (`web/`), GitHub Actions and Docker base images. It updates the open group in place, so there is at most one per ecosystem. Security updates arrive as separate pull requests. A maintainer handles them as follows:

- **CI must be green.** Every required check has to pass, the same as for any other pull request. Don't merge a red update to fix it later.
- **Routine updates are merged in a batch at each milestone,** not one by one. Before a milestone merges to the release branch, bring each group up to date, check that CI is green and merge them together. Record anything notable in the CHANGELOG.
- **Security updates are merged promptly,** without waiting for the milestone: within days for high or critical findings. The same applies to fixes for findings from `govulncheck` (`make lint`) or the image scan. A fix that affects a released version ships as a patch release ([`SECURITY.md`](SECURITY.md)).
- **If one package in a group breaks the build,** fix it on the pull request if that's quick. Otherwise add an `ignore` entry for that package, with a comment and an issue, and merge the rest of the group so it doesn't hold everything up.
- **Major versions** (and Go or Node toolchain bumps) need their changelogs read. If they change behaviour or need code changes, move them to their own pull request.
- **Pinned actions:** Dependabot updates the commit SHA and the version comment together. Check that they still match.
- **Before a release,** regenerate the dependency and licence tables with `make deps-inventory` ([`docs/security/dependencies.md`](docs/security/dependencies.md)).

## Commits and pull requests

- Keep pull requests focused on one change. Separate refactors from behaviour changes.
- Commit subjects are short and say what changed, optionally prefixed by the area (`web: …`, `docs: …`, `agents: …`).
- The pull request description says what changed and why, how you tested it, and which issue, ADR or DESIGN section it relates to.
- CI must pass, generated code must be current, and docs (DESIGN.md, phase specs, `.env.example`, deployment profiles) must match the change.
- A maintainer reviews every pull request before it is merged.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE), the project's licence.
