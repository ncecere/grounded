# Spec: `env-complete`: OCR, fake models and the Demo seed in Grounded environments

Status: **IMPLEMENTED** (2026-10-11), as amended: the three plan findings D1-D3 and the crawl default were accepted (see `tasks/plan.md`). Verification below.
Part of [`SPEC.md`](SPEC.md) (module 1 of 4, no dependencies).

> Where the code lives: the implementation is in the homelab repo (`ncecere/homelab`, private). Paths such as `tools/dev-env/...` and
> `kubernetes/platform/dev-areas/...` are relative to that repo; only the Grounded `AGENTS.md` change (T9) lands here.

## Objective

`dev-env up grounded <name>` today gives a running Grounded (API, worker, Postgres 18 + pgvector, Valkey,
S3, mail catcher) that signs in and passes `grounded doctor`, but it cannot ingest a scanned document, has
no model to answer with, and has no content. A developer or agent cannot exercise ingestion, retrieval or
chat, which is most of what a branch changes.

Add two opt-in pieces, each matching what the repository's own `test/smoke` fixture and `compose.demo.yaml`
already do:

- **`--demo`:** the built-in fake model gateway and the Demo seed, which are one process in the repository
  (`grounded demo --serve-fake-models`): chat and embeddings work with canned answers and no external keys, and a Demo
  team with two agents answers about the Go documentation (crawled from go.dev unless `--no-crawl`). There is no seed
  that registers the fake models without the Demo team, so they are one flag (amendment D1).
- **`--ocr`:** the `grounded-ocr` Tesseract sidecar, **switched on** (amendment D3), so scanned PDFs and images are read.

Users: a developer or agent testing a branch by hand; `cluster-walks` (needs content to walk through);
`cluster-tests` e2e (may use the same pieces). Without any flag the behaviour and the roughly 30-second
start-up stay exactly as they are today.

## Assumptions (correct me)

1. The OCR image and the Grounded image come from the `branch-images` workflow (`dev-<sha12>`), already built
   for every branch; releases use their release tags.
2. The fake gateway needs no image of its own (it is the Grounded image) and no secrets beyond the
   environment's.
3. `grounded demo` crawling go.dev from inside the cluster is acceptable (the area allows HTTPS egress to the
   internet); a flag can turn the crawl off if it proves slow or flaky.
4. These pieces are added through the same Kustomize overlay as the rest of the environment, from the base and
   components **of the ref being tested**, so a change to the manifests is tested too.

## Tech stack

Python 3 (stdlib and PyYAML) in `tools/dev-env/devenv/grounded.py`; `kubectl kustomize`; the repository's
`deploy/kubernetes/components/ocr-tesseract` and `test/fake-models`; Kubernetes 1.36, CNPG, the dev-areas base.

## Commands

```sh
dev-env up grounded <name> --ref <branch>                    # unchanged: no OCR, no models, no content
dev-env up grounded <name> --ref <branch> --ocr              # + the OCR sidecar, switched on
dev-env up grounded <name> --ref <branch> --demo             # + fake model gateway and Demo seed; crawls go.dev
dev-env up grounded <name> --ref <branch> --demo --no-crawl  # same, without crawling go.dev
dev-env down grounded <name>                                 # removes everything, as today
kubectl -n dev-grounded exec deploy/<name>-grounded-api -c api -- /grounded doctor
```

Acceptance (Grounded only): `tools/dev-env/tests/grounded_accept.py --ref v0.4.2 <plain|demo|demo-nocrawl|ocr|ocr-demo>`.
Scope rule (owner, 2026-10-11): this work touches Grounded only. OCI and OMG environments are never brought up, and
`oci.py`, `omg.py`, `common.py` and the shared templates are not edited.

## Project structure

```
tools/dev-env/devenv/grounded.py                 flags, overlay (components, patches), seed Job
kubernetes/platform/dev-areas/templates/         shared templates (not changed unless unavoidable)
tools/dev-env/README.md                          the `grounded` row of the project table
<grounded repo>/AGENTS.md                        the flags and what each gives you (separate PR there)
```

## Code style

Same as the existing modules: small functions, one docstring saying why, `die()` with an actionable message,
no secrets printed, every object labelled `dev.bitop.dev/env=<name>` and applied with `-n dev-grounded`.
Example of the pattern to follow (overlay patches are data, not string templates):

```python
def _delete(api_version, kind):
    return {"target": {"kind": kind},
            "patch": yaml.safe_dump({"$patch": "delete", "apiVersion": api_version, "kind": kind,
                                     "metadata": {"name": "x"}})}
```

## Testing strategy

Real runs on the cluster, as for the existing modules; there is no mock of Kubernetes.

| Level | What | How |
|---|---|---|
| Render | the overlay builds with and without each flag; objects prefixed and labelled; selectors carry the env label; the component's NetworkPolicies are dropped | `dev-env up ... --dry-run`; a small script that inspects the built YAML |
| Environment | each flag's pods are ready with 0 restarts; images are the intended digests | `up`, then `kubectl get pods`, compare `imageID` |
| Behaviour | OCR reads an uploaded scanned page (the repo's `kind-smoke-ocr.sh` check); the Demo agent answers with "Demo model:" and citations | API calls through the port-forward |
| Teardown | `down` leaves 0 labelled objects, 0 pods, 0 PVs | as today |
| Baseline | the no-flag environment is unchanged | `grounded_accept.py plain`, and unit tests of the shared `up` parser (no cluster) |

## Boundaries

- **Always:** apply only into `dev-grounded`; label everything with the environment name (the reaper and
  `down` depend on it); take OCR and fake-model manifests from the tested ref, not from a copy; pin images by
  tag or digest; keep the no-flag path byte-for-byte as fast and as small as today.
- **Ask first:** changing `common.py`, the Postgres/Redis/Mailpit/S3 templates or `dev-env`'s CLI in a way the
  OCI and OMG modules see; adding a new image; a seed that needs an external service other than go.dev.
- **Never:** touch the `grounded` namespace or production data; use real model keys or real OIDC; expose the
  environment beyond the port-forward; leave a seeded environment running without an expiry.

## Success criteria

1. `up grounded x` with no flag: same pods as today, ready in the same time (about 30-45 s), `doctor` passes.
2. `--ocr`: `<name>-grounded-ocr` ready with 0 restarts; the API and worker config points at the prefixed Service
   (`OCR_TESSERACT_URL`); OCR reads as switched on (`GET /v1/admin/parsing`: `ocrEnabled`, backend `tesseract`).
3. `--demo`: the fake gateway Deployment is ready with 0 restarts and has logged "Serving the fake model gateway" (the
   seed is done; amendment D2: it is a Deployment, not a Job); the Demo team and agents `go-docs` and `go-docs-signed-in`
   exist; the model connections use the prefixed gateway Service; `doctor`'s models line is no longer skipped. After the
   crawl indexes, a question to the Go docs assistant returns an answer that starts with "Demo model:" and carries a citation.
4. `--demo --no-crawl`: the team and agents exist and nothing fetches go.dev.
5. A scanned page read end to end: on `--ocr --demo --no-crawl`, the repository's `internal/ocr/sample.png` uploaded to a
   new source reaches `ready` and its passages contain "quick brown fox".
6. `down` after each variant leaves nothing (0 objects, 0 pods, 0 PVs); the reaper does the same at expiry. The shared `up`
   parser still accepts OCI's and OMG's arguments unchanged (unit tests; their environments are not brought up).
7. Documented: the `grounded` row of `tools/dev-env/README.md` and the flags in Grounded's `AGENTS.md`.

## Decisions (all settled 2026-10-11)

1. Flag shape: `--ocr`, `--demo`, `--no-crawl`; no `--models fake` (D1).
2. The crawl is on under `--demo`; `--no-crawl` skips it.
3. `--ocr` also switches OCR on (D3).
4. Release refs: `v0.4.2` and `main` both contain the OCR component, the `test/fake-models` fixture, `kind-smoke-ocr.sh` and
   the `--serve-fake-models` flag, so the flags work for the deployed release as well as for branches. For any older ref
   whose tree lacks them, `up` fails with a clear message.
5. How the app finds the fake gateway: the fixture sets `DEMO_FAKE_ADDR=0.0.0.0:8090` and `DEMO_FAKE_URL`; the overlay
   overrides the URL with the prefixed Service (a literal, not renamed by the name prefix; confirmed by a render).

## Verification (2026-10-11)

All on v0.4.2 on the bitop-talos cluster, with `tools/dev-env/tests/grounded_accept.py <variant>` (homelab repo). Final sweep on the
last code: `plain` 59 s, `demo` 158 s, `demo-nocrawl` 54 s, `ocr` 61 s, `ocr-demo` 80 s, all passing, with nothing left in the cluster.

| # | Criterion | Evidence |
|---|---|---|
| 1 | No flag: unchanged | `plain` passes after every task: 6 pods ready with 0 restarts, `doctor` 0 failed, sign-in 200, clean `down` (about 30-60 s) |
| 2 | `--ocr` | `ocr` passes: 7 pods, 0 restarts; `OCR_TESSERACT_URL` names the environment's own sidecar; it runs the registry's `grounded-ocr:v0.4.2` digest (`sha256:87a46039...`); `GET /v1/admin/parsing` reports OCR on with Tesseract (set by a setup Job; a re-run reports "already on") |
| 3 | `--demo` | `demo` passes: the gateway ready with 0 restarts and "Serving the fake model gateway" logged; the Demo team and both agents exist; `doctor` reaches the models at the prefixed Service; after indexing (12-14 documents) the Go docs assistant answers with 3 citations, from the demo model. 5 runs in a row after a first-contact routing race was fixed |
| 4 | `--demo --no-crawl` | `demo-nocrawl` passes twice: the team, agents and connections exist, the source points at `https://docs.example.edu/doc/` |
| 5 | A scanned page read end to end | `ocr-demo` passes: `sample.png` reaches `ready` and its passages say "quick brown fox". The negative control `ocr-off-control` fails in 54 s with the API's own reason, `ocr_off: Images need OCR, which is off for this source` |
| 6 | Clean teardown; shared parser unchanged for OCI and OMG | every variant's `down` left 0 objects, 0 pods, 0 volumes; the reaper removed an `--ocr` environment (Job and ConfigMap included) at expiry; `common.py`, `oci.py`, `omg.py` and the shared templates have no diff, and no OCI or OMG environment was brought up; 143 unit tests |
| 7 | Documented | `tools/dev-env/README.md` (homelab repo); Grounded's `AGENTS.md` in PR #14 |

Found while verifying, and fixed: a 1-2 second window right after `up` in which the API cannot yet reach a new gateway pod ("no route to host"), so
`up` now waits until the API's own `doctor` reaches the models; and an acceptance negative control that waited 180 s and said nothing useful, because
it ignored the upload reply, which says `rejected` at once.

