# Capability map: Grounded development and testing on the cluster

Status: **capability map approved** (2026-10-11). Module specs are approved one at a time: `env-complete` is **implemented**
(2026-10-11); the other three are not written yet.

> Where the code lives: the implementation is in the homelab repo (`ncecere/homelab`, private). Paths such as `tools/dev-env/...` and
> `kubernetes/platform/dev-areas/...` are relative to that repo; only the Grounded `AGENTS.md` change (T9) lands here.

## Why

Grounded is developed on a laptop: a live Postgres/Valkey/OCR stack, the pre-push CI chain, QA walks
and screenshot capture all run there. The cluster can now run a throw-away Grounded environment for any
branch (`dev-env up grounded`, proven 2026-10-11). The goal is to finish the move, so that nothing about
developing Grounded needs the laptop but the editor and `git push`:

```
laptop: code, git push  ->  GitHub: dev-<sha> images  ->  cluster: environment, tests, walks, screenshots
```

Out of scope: the v0.4.3 release (the unreleased Go security fix, issue #7, Dependabot), roadmap versions,
OCI and OMG (their own agents), production Postgres/Valkey changes, self-hosted GitHub runners and
in-cluster image builds (both rejected earlier).

## Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `env-complete` | `dev-env up grounded` can add the OCR sidecar, the fake model server and the Demo seed, so ingestion, retrieval and chat work in an environment without external services | existing `dev-env` |
| `cluster-tests` ([spec](SPEC-cluster-tests.md), draft) | The CI suites (Go tests, authorization matrix, Playwright e2e, OCR tests, manifest and dashboard validation) run as Jobs on the cluster against a branch, with logs and artifacts retrievable | `env-complete` (e2e) |
| `cluster-walks` ([spec](SPEC-cluster-walks.md), draft) | QA walks and screenshot capture run against a cluster environment (headless browser through the port-forward), replacing the laptop capture stack | `env-complete` |
| `laptop-retire` | The Grounded stack on the laptop is removed; AGENTS.md, CONTRIBUTING and the dev docs say what to do instead | `cluster-tests`, `cluster-walks` |

Build order: `env-complete` -> `cluster-tests` and `cluster-walks` (independent, either order) -> `laptop-retire`.

Specs: [`SPEC-env-complete.md`](SPEC-env-complete.md) (implemented). The other three are written one at a time,
in this order, after the previous one is approved. This file is the index of what exists.

## What the research found (so it is not lost)

**Environment** (basis of `env-complete`)
- OCR is a Kustomize component in the repo (`components/ocr-tesseract`): a Deployment, a Service and two
  NetworkPolicies, plus `OCR_TESSERACT_URL: http://grounded-ocr:8080` in `grounded-config`. With the
  overlay's name prefix that URL no longer matches the Service name: the overlay must set it.
- The fake model server is the Grounded image itself, `grounded demo --serve-fake-models` on port 8090
  (fixture: `deploy/kubernetes/test/fake-models`). `grounded demo` seeds a Demo team (two agents answering
  from the Go documentation, crawled from go.dev, about two minutes) with the built-in fake models; it is
  idempotent ("already seeded").
- `scripts/kind-smoke-ocr.sh` already has an OCR acceptance check (upload a scanned page, wait for its text).

**Tests** (basis of `cluster-tests`)
- Jobs on GitHub today: `test` (generated-code check, lint, styling policy, web type-check and unit and
  accessibility tests, Go tests with coverage, build), `authz` (`make test-authz`), `e2e` (`npx playwright
  test`, Chromium), `ocr` (Tesseract sidecar tests), `k8s` (`make k8s-validate`, `make obs-validate`),
  `k8s-smoke` (kind), then `image`, `upgrade`, `release` (they publish).
- Services they need: Postgres with pgvector (CI uses 17), Valkey, S3 (MinIO build) for `test`; Postgres and
  Valkey for `authz` and `e2e`; Tesseract for `ocr`. Toolchain: Go (pinned in `go.mod`), Node 22, Playwright
  Chromium, kustomize, kubeconform, promtool.
- Recent GitHub wall-clock for the whole workflow: about 22-30 minutes (it was about 66 earlier).
- Not runnable as a pod without privileges: `k8s-smoke` (needs kind, so Docker) and `upgrade`/`image`/`release`
  (publish). `dev-env up grounded` plus `grounded doctor` already covers what the smoke test proves on a real cluster.

**Walks** (basis of `cluster-walks`)
- The laptop capture stack is compose plus a mock gateway plus seed scripts; the environment's `DEV_AUTH`
  sign-in (`POST /auth/dev`) and the fake models replace most of it.

## Decisions needed before the module specs can be final

(Answered for `cluster-tests`: see [`SPEC-cluster-tests.md`](SPEC-cluster-tests.md), decisions D1 to D6.)

1. Do the test Jobs run **without limits** like environments (consistent with "dev yields"), or with a fixed
   4 CPU / 16 GB so timings are comparable with GitHub runners? (`cluster-tests`)
2. Is **PostgreSQL 17** for the test Jobs acceptable (what CI uses) alongside 18 for environments, or must tests
   run on 18? (`cluster-tests`)
3. Is replacing `k8s-smoke` with "`dev-env up grounded` + `grounded doctor`" acceptable, or must the smoke
   test itself be kept on GitHub only? (`cluster-tests`)
4. Where do artifacts (Playwright traces, coverage, logs) go: retrievable with `kubectl`, or uploaded to the
   area's RustFS bucket `dev-grounded-*`? (`cluster-tests`)
