# Spec: `cluster-tests`: Grounded's pre-push checks as Jobs on the cluster

Status: **DRAFT** (2026-10-14). Decisions D1 settled by the owner; D2-D6 are recommendations, applied unless overruled.
Part of [`SPEC.md`](SPEC.md) (module 2 of 4; needs `env-complete`, which is implemented). Tracks [#46](https://github.com/ncecere/grounded/issues/46).

> Where the code lives: the tool is in the homelab repo (`ncecere/homelab`, private): `tools/dev-env/...` and
> `kubernetes/platform/dev-areas/...`. Only `Dockerfile.ci`, its workflow, `AGENTS.md`, `CONTRIBUTING.md` and this spec land here.

## Objective

Before pushing, a developer or agent runs Grounded's checks. Today that needs the laptop: Go with Postgres, Valkey and
S3 in Docker, Node, Playwright's Chromium, Tesseract. The cluster already hosts throwaway environments; it should also
run the checks, so nothing about developing Grounded needs the laptop (the point of `SPEC.md`).

`dev-env test grounded <name> --ref <ref>` runs the repository's CI suites as Jobs against that branch, in parallel,
against fresh infrastructure, and says which passed, which failed, how long each took, and where the logs and artifacts
are. GitHub CI stays the gate: this is the fast, laptop-free pre-push loop, not a replacement for the checks that publish.

## The suites (what the `ci` workflow runs today)

| Suite | What it runs (CI job) | Needs |
|---|---|---|
| `test` | `make check-generated`, `make lint`, web styling and size checks, `make web-test`, `make test COVER=1 SKIP_AUTHZ=1`, `make web build` | Postgres with pgvector, Valkey, S3 |
| `authz` | `make test-authz` | Postgres, Valkey |
| `e2e` | `make web build`, `npx playwright test` (Chromium) | Postgres, Valkey |
| `ocr` | `go test -race ./cmd/grounded-ocr/` (real Tesseract) | Tesseract in the image |
| `k8s` | `make k8s-validate`, `make obs-validate` (kustomize, kubeconform, promtool, downloaded by the Makefile) | outbound HTTPS |

Not run: `k8s-smoke` (needs Docker and kind; see D3) and `image`, `upgrade`, `release` (they publish).

## Decisions

- **D1 (owner, 2026-10-14): no resource limits**, like environments ("dev yields"). Each Job's wall time is recorded
  and printed so it can still be compared with GitHub's.
- **D2: PostgreSQL 17 by default** (what CI and production run), `--postgres 18` to try the environments' version. The
  suites already pass on 18 (run against a cluster environment during v0.4.4), so the choice costs nothing later.
- **D3: `k8s-smoke` stays on GitHub only.** On the cluster, `dev-env up grounded <name>` + `grounded doctor` + the
  acceptance script (`tests/grounded_accept.py`) already prove a real deployment comes up, on real Kubernetes.
- **D4: artifacts go to the run's own RustFS bucket** (`artifacts/<suite>/`), fetched with `dev-env test fetch`; logs
  are also available with `kubectl logs` while the run exists. Job pods are ephemeral, so nothing relies on them. The
  reaper deletes bucket and Jobs with the run.
- **D5: the code is a plain anonymous `git clone` of the ref** (the repository is public). The Jobs test exactly what
  was pushed; nothing comes from the laptop, and no credential is stored.
- **D6: a purpose-built runner image**, `ghcr.io/ncecere/grounded-ci:<hash>`, built by GitHub from `Dockerfile.ci`
  (Go at the version `go.mod` pins, Node 22, Playwright's Chromium and its system libraries, Tesseract, `sqlc`, `make`,
  `git`, `jq`). The tag is the hash of the tested ref's `Dockerfile.ci`, as fixtures come from the ref's tree; `dev-env`
  refuses (touching nothing) if that image is not published. Go and npm download caches live on a shared volume.

## Assumptions (correct me)

1. The cluster has room for five suites at once without limits (a 4-CPU/16 GB environment's worth is the working size).
2. The suites that share a Postgres and a Valkey cannot collide: Go integration tests create a database per test; the
   suites get distinct Valkey database numbers (`test` 1, `authz` 2, `e2e` 0, as CI uses 1 and 0).
3. The S3 the `test` suite needs is the environment template's, scoped by dev-only keys.
4. Outbound HTTPS from the area is open (the Makefile downloads tools; npm and Go modules are fetched).

## Commands

```
dev-env test grounded <name> --ref <ref> [--suite test,authz,e2e,ocr,k8s] [--postgres 17|18] [--keep]
dev-env test fetch grounded <name> [--dest DIR]      # artifacts of the last run
dev-env down grounded <name>                         # removes infrastructure, Jobs and artifacts
```

Exit status 0 only if every selected suite passed. Output: one line per suite (`PASS`/`FAIL`, wall time), then where the
logs and artifacts are. A run is an environment (`dev.bitop.dev/env=<name>`, an expiry record, reaped like the others).

## Success criteria

1. On a known-good ref (`main`), all five suites pass, with the same results as GitHub's.
2. On a ref with a deliberately broken test, the matching suite fails, the others pass, and the exit status is non-zero.
3. For every suite, logs are readable with `kubectl logs`, and artifacts (coverage, Playwright report and traces, logs)
   can be fetched after the pods are gone.
4. After `down`, no object labelled with the run remains, in the namespace or the bucket.
5. Per-suite wall times are printed and kept with the artifacts.
6. A check fails when `ci.yml` gains a job that is neither mapped to a suite nor on the "not run" list, so the two
   cannot drift apart silently.
7. Nothing of OCI or OMG is touched; nothing but the area's own namespace and bucket is written.

## Boundaries

- **Always:** verify the digest of the runner image against the registry; stop early on a failing step; read real exit
  codes (a suite fails if any step of it fails); keep the homelab repo workflow of `SPEC-env-complete.md`.
- **Ask first:** changing what a suite runs (it must stay what CI runs); adding a suite; any change to GitHub's workflows
  other than the runner-image build.
- **Never:** limits or reserved capacity (D1); a stored credential; running on the production namespace; OCI or OMG.

## Testing strategy

Unit tests (no cluster) for the pieces `dev-env` computes: suite selection, the Valkey database numbers, the runner
image tag from `Dockerfile.ci`, the Job manifests (rendered and validated with a server-side dry-run), result parsing
and the CI-parity check. An acceptance script on the cluster (`tests/cluster_tests_accept.py`) runs the criteria above,
including a deliberately failing ref, and always tears down.
