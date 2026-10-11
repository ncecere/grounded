# Implementation Plan: `env-complete` (OCR, fake models and the Demo seed in Grounded environments)

Status: **APPROVED** (2026-10-11): decisions D1-D3 and the crawl default accepted; implementation in progress, Checkpoint 1 next. Spec: [`docs/specs/cluster-testing/SPEC-env-complete.md`](../docs/specs/cluster-testing/SPEC-env-complete.md)
(module 1 of the capability map in [`SPEC.md`](../docs/specs/cluster-testing/SPEC.md)). Tasks and checkpoints: [`tasks/todo.md`](todo.md)
(no external tracker is designated, so the default target applies).

**Scope rule (owner, 2026-10-11): this work touches Grounded only.** OCI and OMG belong to other agents: no environment of theirs is
created or brought up (not even for a regression check), and `oci.py`, `omg.py`, `common.py` and the shared templates are not edited.

> Where the code lives: the implementation is in the homelab repo (`ncecere/homelab`, private). Paths such as `tools/dev-env/...` and
> `kubernetes/platform/dev-areas/...` are relative to that repo; only the Grounded `AGENTS.md` change (T9) lands here.

Scope: this plan covers **only `env-complete`**. `cluster-tests`, `cluster-walks` and `laptop-retire` each get their own spec and plan after this
module is done, as the capability map says. Everything is in the homelab repo (`tools/dev-env/`), plus one docs PR in the Grounded repo.

## Overview

`dev-env up grounded <name>` gives a running Grounded that signs in and passes `grounded doctor`, but it has no model, no content and no OCR.
Add `--demo` (the fake model gateway plus the Demo team, from the repository's own fixture and `grounded demo` command), `--no-crawl`, and `--ocr`
(the Tesseract sidecar, switched on), with an acceptance script that proves chat with citations and a scanned page read by OCR. With no flag the
environment stays exactly as it is today.

## What reading the code found (these drive the plan)

1. **The fake gateway and the Demo seed are one process.** The repository's fixture (`deploy/kubernetes/test/fake-models`) is a long-running
   *Deployment* running `grounded demo --serve-fake-models`: it opens the gateway port, seeds, logs "Serving the fake model gateway on ..." and keeps serving.
   The seed registers the model connections with the URL in `DEMO_FAKE_URL`. There is no seed that registers models without also creating the Demo team,
   its source, knowledge base and two agents (`go-docs`, `go-docs-signed-in`; team slug `demo`).
2. **Literal URLs are not renamed by the name prefix** (confirmed with a throwaway render): `OCR_TESSERACT_URL` (`http://grounded-ocr:8080`) and
   `DEMO_FAKE_URL` (`http://grounded-fake-models:8090/v1`) keep their unprefixed names, so both must be overridden with `<env>-...`.
3. **The OCR image keeps a placeholder tag** (`pin-a-digest-in-your-overlay`), and the OCR component requests 500m CPU with limits (2 CPU, 1Gi); the fixture
   has limits too. Both must follow the "no limits, no reserved capacity" policy.
4. **Good news, confirmed by the same render:** the existing overlay patch already drops the component's and the fixture's NetworkPolicies, the fixture's
   secret/config references follow the prefix, and the env label reaches their selectors. The dev area's same-namespace policy covers API to OCR and API to gateway.
5. **OCR is off until an admin turns it on** (Admin > Parsing: `PUT /v1/admin/parsing`, with `If-Match` the current revision). The repository's `kind-smoke-ocr.sh`
   does exactly this and then uploads `internal/ocr/sample.png`; that script is the model for our acceptance check.
6. **The repository's smoke test avoids the go.dev crawl** by setting `DEMO_SITE_URL=https://docs.example.edu/doc/` (a host that does not resolve): a documented
   mechanism for `--no-crawl`.
7. `v0.4.2` and `main` both contain the component, the fixture, the sample image and the demo flags, and the `v0.4.2` images are published: acceptance can use
   `--ref v0.4.2` repeatedly without building anything.

## Spec deviations found while planning (accepted 2026-10-11; the spec is amended)

| # | Spec says | Reality | Proposed amendment |
|---|---|---|---|
| D1 | Flags `--ocr`, `--models fake`, `--demo` are independent; criterion 3 gives chat connections with `--models fake` alone | Fake connections only exist as part of the Demo seed (finding 1) | Drop `--models fake`. Flags: **`--demo`** (fake gateway + Demo seed), **`--no-crawl`**, **`--ocr`**. Criteria 3 and 4 merge. |
| D2 | "the seed Job completes" | It is a Deployment that keeps serving; the seed is done at the log line "Serving the fake model gateway" | Use that line as the done signal (the repository's smoke test does too). |
| D3 | `--ocr` leaves "an uploaded scanned page's text" readable | The sidecar alone does nothing until OCR is switched on; and a page can only be indexed with a team, a source and an embedding profile, which only `--demo` creates | `--ocr` also **switches OCR on** (a setup Job). The behaviour check (scanned page read) runs on `--ocr --demo --no-crawl`; `--ocr` alone is checked by "pod ready, config points at it, OCR reads as enabled". |

## Architecture decisions

- **Extend the existing overlay, do not fork it.** `grounded.py`'s `_overlay()` gets `components` (`../../components/ocr-tesseract`) and a resource
  (`../../test/fake-models`) *from the tree of the ref under test*, so a manifest change in a branch is tested too. Overrides for the literal URLs, the
  OCR image tag, and resources (small requests, `limits: null`) are patches in the same overlay.
- **Late apply for the fake gateway.** Its Deployment and Service are applied after the API and worker have rolled out (the API's init container migrates
  the schema). Applied together, the seed can start before the schema exists and the pod restarts once; the same ordering already fixed OCI's worker and OMG's gateway.
- **Setup by an in-cluster Job, not by the laptop.** Turning OCR on is an API call that needs a development sign-in whose `Host` and `Origin` equal `APP_URL`
  (`http://localhost:<port>`). A Job running the already-pinned `python:3.13-alpine` (stdlib only, labelled with the env so `down` and the reaper remove it) can
  set those headers against the Service, so nothing depends on a laptop port-forward. The same stdlib client (`devenv/grounded_api.py`) is used by the laptop-side
  acceptance script.
- **Flags are per project, declared by the project module.** The shared parser gets `--ocr/--demo/--no-crawl`; `dev-env` rejects a flag the project's module
  does not list in `FLAGS`, read with `getattr(...)` so **`oci.py` and `omg.py` are not edited** (they belong to other agents' work).
- **Real runs, no Kubernetes mocks.** Fast local checks (a render test: `kubectl kustomize` is client-side) plus live acceptance on the cluster, as for the existing modules.
- **Grounded-only verification.** A committed acceptance script (`tests/grounded_accept.py`) with a baseline `plain` variant (the no-flag environment) guards
  Grounded's existing behaviour. The one shared edit, the `up` parser in `dev-env` (T2), is covered by unit tests that need no cluster and never bring up an OCI or
  OMG environment; `common.py`, `oci.py`, `omg.py` and the shared templates are not edited at all.

## Dependency graph

```
grounded_accept.py, `plain` baseline (T1) ──► guards Grounded's no-flag path for every later task
flags in dev-env CLI (T2: unit-tested only)
        │
        ├──► --demo: fixture + URL override + late apply (T3)
        │         ├──► chat-with-citations acceptance (T4, extends the T1 client)
        │         └──► --no-crawl (T5) ─────────────────────────────────┐
        │                                                               │
        └──► --ocr: component + URL + image tag + resources (T6)        │
                  └──► OCR switched on by a setup Job (T7, reuses T4's client)
                            └──► scanned page read end to end (T8, needs T3 + T5 + T7)
docs, hand-off (T9) needs everything
```

Sequential on `grounded.py` (every task edits it): no parallel implementation. The only safe parallel work is drafting the Grounded `AGENTS.md`
text (T9) while a long acceptance run executes.

## Task list (order; details, acceptance criteria and verification are in `tasks/todo.md`)

### Phase 1: Safety net and plumbing
1. T1 Grounded acceptance harness with the `plain` baseline
2. T2 Per-project flags in `dev-env up`
- Checkpoint 1

### Phase 2: `--demo` (riskiest first: the seed, the ordering, the crawl)
3. T3 `--demo`: fake gateway and Demo seed run, no restarts
4. T4 Acceptance: the Go docs assistant answers with citations
5. T5 `--no-crawl`
- Checkpoint 2

### Phase 3: `--ocr`
6. T6 `--ocr`: the sidecar runs and is wired
7. T7 `--ocr` switches OCR on (setup Job)
8. T8 Acceptance: a scanned page is read end to end
- Checkpoint 3

### Phase 4: Hand-off
9. T9 Docs: tool README, Grounded `AGENTS.md`, spec status
- Checkpoint: Complete

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Seed starts before the schema exists, so the pod restarts | Med | Late apply (T3); acceptance asserts 0 restarts |
| Literal service names not prefixed (confirmed) | High | Overrides in the overlay; the render test asserts both URLs |
| OCR/fixture limits or the 500m request break "no limits, no reserved capacity" | Med | Patch to small requests and `limits: null`; the render test asserts it |
| Development sign-in from the setup Job refused (Host/Origin/CSRF) | High | First step of T7 is a one-off probe of exactly that call; fallback: do it from the laptop through a temporary port-forward |
| go.dev crawl slow, blocked or flaky from the cluster | Med | T4 reports crawl state and times out clearly; `--no-crawl` (T5) is the deterministic path; T8 uses it |
| The shared `up` parser change affects OCI or OMG environments | Med | The new flags are rejected for them before anything is contacted; `oci.py`, `omg.py`, `common.py` are not edited; unit tests (no cluster) prove their no-flag arguments parse as before; no environment of theirs is created |
| An old ref lacks the component or fixture | Low | `resolve` checks the ref's tree when a flag needs it and fails with a clear message (v0.4.2 and main both have them) |

## Open questions

None open. Decided 2026-10-11: (1) drop `--models fake`, use `--demo` (D1); (2) crawl go.dev by default under `--demo`, `--no-crawl` skips it;
(3) `--ocr` also switches OCR on (D3).
