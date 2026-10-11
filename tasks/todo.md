# Task list: `env-complete`

Plan: [`tasks/plan.md`](plan.md). Spec: `docs/specs/cluster-testing/SPEC-env-complete.md`. Status: **APPROVED 2026-10-11; in progress** (see the Evidence section at the end for what is done).
> Where the code lives: the implementation is in the homelab repo (`ncecere/homelab`, private). Paths such as `tools/dev-env/...` and
> `kubernetes/platform/dev-areas/...` are relative to that repo; only the Grounded `AGENTS.md` change (T9) lands here.

D1-D3 and the crawl default are accepted: flags are `--demo`, `--no-crawl`, `--ocr`; the crawl is on under `--demo`.

**Scope rule (owner, 2026-10-11): this work touches Grounded only.** OCI and OMG belong to other agents: no environment of theirs is
created or brought up (not even for a regression check), and `oci.py`, `omg.py`, `common.py` and the shared templates are not edited.

Conventions used in every task:
- Local checks: `python3 -m unittest discover -s tools/dev-env/tests -v` (needs `kubectl`, PyYAML and the Grounded clone; no cluster).
- Acceptance (live, Grounded only): `tools/dev-env/tests/grounded_accept.py --ref v0.4.2 <variant>` (created in T1, extended per variant); it brings an environment up, checks it, and always removes it.
- Never bring up an OCI or OMG environment, not even to check a shared change (see the scope rule).
- Cluster hygiene after any live run: 0 objects labelled `dev.bitop.dev/env=<name>`, 0 pods named `<name>-*`, 0 PVs for that namespace/name, in `dev-grounded` and not in `default`.
- Code commits go to `main` of the homelab repo (Flux does not read `tools/` or `docs/`); fetch right before pushing. The owner's own checkout of that repo has uncommitted work and is only ever fast-forwarded.

---

## Phase 1: Safety net and plumbing

### Task 1: Grounded acceptance harness with the `plain` baseline

**Description:** Create `tools/dev-env/tests/grounded_accept.py` with the framework every later variant uses (always tears down, prints the environment's pod logs on
failure, refuses to start if its own environment name already exists) and the stdlib client `devenv/grounded_api.py` (development sign-in only for now). Its first
variant, `plain`, checks today's no-flag Grounded environment, so every later change has a baseline to be compared with (spec success criterion 1). Grounded only.

**Acceptance criteria:**
- [x] `grounded_accept.py --ref v0.4.2 plain` exits 0: every pod Running and ready with 0 restarts, `grounded doctor` reports no failed check, development sign-in as admin returns 200, `down` leaves nothing.
- [x] A ref that does not exist exits non-zero and still removes whatever was created.
- [x] If its environment name already exists it refuses and touches nothing.

**Verification:**
- [x] Run `plain` on `v0.4.2`: PASS lines per check; hygiene check afterwards (`dev-env list` empty; `dev-grounded` has no `ga-*` objects, pods or PVs).
- [x] Run it with `--ref nonexistent`: non-zero exit, no leftovers.

**Dependencies:** None

**Files likely touched:** `tools/dev-env/tests/grounded_accept.py`, `tools/dev-env/devenv/grounded_api.py`

**Estimated scope:** Small (2 files, new)

### Task 2: Per-project flags in `dev-env up`

**Description:** Add `--ocr`, `--demo` and `--no-crawl` to the shared `up` parser. A flag is accepted only when the project module lists it in `FLAGS`
(`getattr(proj, "FLAGS", frozenset())`, so `oci.py` and `omg.py` are untouched); `--no-crawl` requires `--demo`. `grounded.py` declares the three flags and keeps them
on `env.options`; they do nothing yet except appear in the dry-run summary.

**Acceptance criteria:**
- [x] The flag check runs first, before the cluster or any project code is contacted: `up oci x --ocr` and `up omg x --demo` would exit non-zero with a message naming the project and the unsupported flag (proved by unit tests; **not** by running them).
- [x] `up grounded x --no-crawl` exits non-zero ("--no-crawl needs --demo"); `up grounded x --ocr --demo --no-crawl --dry-run` prints the options and creates nothing.
- [x] Without flags, `up grounded` and `up oci` behave exactly as before.

**Verification:**
- [x] Unit tests of the flag rules (pure Python, no cluster; project modules are only imported, never run): `python3 -m unittest discover -s tools/dev-env/tests -v`
- [x] `git diff --stat -- tools/dev-env/devenv/oci.py tools/dev-env/devenv/omg.py tools/dev-env/devenv/common.py` is empty.
- [x] Manual: the two Grounded dry runs above, and `grounded_accept.py --ref v0.4.2 plain` still passes (the shared CLI changed).

**Dependencies:** Task 1

**Files likely touched:** `tools/dev-env/dev-env`, `tools/dev-env/devenv/grounded.py`, `tools/dev-env/tests/test_flags.py`

**Estimated scope:** Small (3 files)

### Checkpoint 1: after Tasks 1-2
- [x] Unit tests pass and `grounded_accept.py plain` passes
- [x] The diff shows no edits to `oci.py`, `omg.py`, `common.py` or the shared templates
- [ ] Review with the owner; confirm decisions D1-D3 and the crawl default before Phase 2

---

## Phase 2: `--demo`

### Task 3: `--demo`: the fake gateway and the Demo seed run, with no restarts

**Description:** With `--demo`, the overlay adds the tested ref's `test/fake-models`, overrides `DEMO_FAKE_URL` with the prefixed Service, gives it small requests and no
limits, and the tool applies its Deployment and Service only after the API and worker have rolled out, then waits for the log line "Serving the fake model gateway".
`resolve` refuses a ref whose tree lacks the fixture. The environment then has the Demo team, its source and two agents, and real (fake-backed) model connections.

**Acceptance criteria:**
- [x] `up grounded x --demo --ref v0.4.2`: `x-grounded-fake-models` ready with **0 restarts**; team `demo` and agents `go-docs` and `go-docs-signed-in` exist (checked through the API).
- [x] The registered model connections use `http://x-grounded-fake-models:8090/v1`; `grounded doctor`'s models line is no longer skipped.
- [x] No fixture NetworkPolicies, no `limits`, selectors carry the env label (render test); the no-flag object list is unchanged.
- [x] A ref without the fixture fails with a clear message; `down` leaves nothing.

**Verification:**
- [x] Render test: `python3 -m unittest discover -s tools/dev-env/tests -v` (prefixed URL, no limits, no NetworkPolicy, unchanged no-flag output)
- [x] Live: `up grounded x --demo --ref v0.4.2`; `kubectl -n dev-grounded get pods`; `exec ... /grounded doctor`; `down`; hygiene check
- [x] `grounded_accept.py plain` still passes at the end of the task (the no-flag path is unchanged).

**Dependencies:** Task 2

**Files likely touched:** `tools/dev-env/devenv/grounded.py`, `tools/dev-env/tests/test_grounded_render.py`

**Estimated scope:** Medium (2 files, the logic is the size)

### Task 4: Acceptance: the Go docs assistant answers with citations

**Description:** Extend the Task 1 harness and client (`grounded_accept.py`, `devenv/grounded_api.py`) with CSRF, JSON and SSE helpers and a `demo` variant.
Variant `demo`: bring up `--demo`, open a port-forward, wait for the Demo source to finish indexing (the repository says about two minutes), ask
`POST /v1/agents/demo/go-docs/chat` a starter question, and check that the answer starts with "Demo model:" and carries a citation. Always tears down; prints the
environment's logs on failure.

**Acceptance criteria:**
- [x] `grounded_accept.py --ref v0.4.2 demo` exits 0: an answer beginning "Demo model:" with at least one citation marker.
- [x] On timeout or failure it says which step failed (crawl, embedding, answer) and shows the relevant pod log tail; the environment is still removed.
- [x] Running it twice in a row passes both times (idempotent seed, nothing left behind).

**Verification:**
- [x] Run twice as above; hygiene check after each.
- [x] Break it on purpose (a non-resolving crawl site) and confirm the failure message names the crawl.

**Dependencies:** Task 1, Task 3

**Files likely touched:** `tools/dev-env/tests/grounded_accept.py`, `tools/dev-env/devenv/grounded_api.py`

**Estimated scope:** Small (2 files)

### Task 5: `--no-crawl`

**Description:** `--no-crawl` sets `DEMO_SITE_URL=https://docs.example.edu/doc/` on the fake-gateway Deployment, the same mechanism the repository's own smoke test uses, so the
Demo team and agents exist but nothing fetches go.dev.

**Acceptance criteria:**
- [x] `up grounded x --demo --no-crawl`: team and both agents exist; the source's URL is the placeholder, not go.dev; ready as fast as `--demo` or faster.
- [x] `--no-crawl` without `--demo` is still rejected (Task 2).

**Verification:**
- [x] Render test asserts the variable; `grounded_accept.py --ref v0.4.2 demo-nocrawl` (a new variant checking team, agents and the source URL) exits 0.

**Dependencies:** Task 3 (and the client from Task 4 for the variant)

**Files likely touched:** `tools/dev-env/devenv/grounded.py`, `tools/dev-env/tests/grounded_accept.py`

**Estimated scope:** XS (2 files, a few lines)

### Checkpoint 2: after Tasks 3-5
- [x] Unit tests pass; `grounded_accept.py demo` and `demo-nocrawl` pass twice; `plain` still passes
- [x] Spec criteria 3-4 (merged) demonstrably met
- [ ] Review with the owner before Phase 3

---

## Phase 3: `--ocr`

### Task 6: `--ocr`: the sidecar runs and is wired

**Description:** With `--ocr`, the overlay adds the tested ref's `components/ocr-tesseract`, overrides `OCR_TESSERACT_URL` with the prefixed Service, pins
`ghcr.io/ncecere/grounded-ocr` to the same tag as the app (the image check covers it; releases and `dev-` builds both have it), and drops its limits and its 500m CPU request.

**Acceptance criteria:**
- [x] `up grounded x --ocr --ref v0.4.2`: `x-grounded-ocr` ready, 0 restarts, running the `v0.4.2` OCR image (digest compared with the registry).
- [x] API and worker configuration contain `OCR_TESSERACT_URL=http://x-grounded-ocr:8080`.
- [x] No component NetworkPolicies, no `limits`, small requests (render test); no-flag output unchanged; `down` leaves nothing.
- [x] A ref without the component fails with a clear message.

**Verification:**
- [x] Render test; live `up`/inspect/`down`; hygiene check.

**Dependencies:** Task 2

**Files likely touched:** `tools/dev-env/devenv/grounded.py`, `tools/dev-env/tests/test_grounded_render.py`

**Estimated scope:** Small (2 files)

### Task 7: `--ocr` switches OCR on (setup Job)

**Description:** After rollout, a setup Job (the pinned `python:3.13-alpine`, script and `grounded_api.py` mounted from a ConfigMap, labelled with the env) signs in as the
development admin from inside the cluster (`Host` and `Origin` = `APP_URL`) and sets `{"ocrEnabled":true,"backend":"tesseract","visionModelId":null,"languages":"eng"}` on
`/v1/admin/parsing` with the current `If-Match` revision. **First step: a one-off probe of exactly that sign-in from a Job** (the plan's highest-risk item); if it is
refused, fall back to doing the call from the laptop through a temporary port-forward and say so in the task notes.

**Acceptance criteria:**
- [ ] After `up grounded x --ocr`, `GET /v1/admin/parsing` reports `ocrEnabled: true` and `backend: tesseract`.
- [ ] The Job completes, is removed by `down` and by the reaper, and re-running it is harmless.
- [ ] The Job's failure (for example the API not answering) fails `up` with its log, not a silent timeout.

**Verification:**
- [ ] `grounded_accept.py --ref v0.4.2 ocr` (new variant: reads the parsing settings through the port-forward) exits 0; hygiene check; reaper path checked once with `renew --ttl 1m`.

**Dependencies:** Task 6, Task 4 (the client)

**Files likely touched:** `tools/dev-env/devenv/grounded.py`, `tools/dev-env/devenv/grounded_api.py`, `tools/dev-env/tests/grounded_accept.py`

**Estimated scope:** Medium (3 files)

### Task 8: Acceptance: a scanned page is read end to end

**Description:** Variant `ocr-demo`: bring up `--ocr --demo --no-crawl` (no go.dev dependency), create an upload source copying the Demo source's classification and
embedding profile, upload `internal/ocr/sample.png` taken from the tested ref's tree, and wait for the document to reach `ready`; its passages must contain
"quick brown fox". This is a port of the repository's `kind-smoke-ocr.sh` using the same endpoints.

**Acceptance criteria:**
- [ ] `grounded_accept.py --ref v0.4.2 ocr-demo` exits 0 within a few minutes; the document status is `ready`, read with OCR, and the text matches.
- [ ] A failed document reports its `errorCode` and `errorMessage` and the OCR pod's log tail; the environment is removed either way.

**Verification:**
- [ ] Run twice; hygiene check; break it on purpose by omitting `--ocr` and confirm the failure names OCR being off.

**Dependencies:** Task 3, Task 5, Task 7

**Files likely touched:** `tools/dev-env/tests/grounded_accept.py`

**Estimated scope:** Small (1 file)

### Checkpoint 3: after Tasks 6-8
- [ ] Unit tests pass; all acceptance variants (`demo`, `demo-nocrawl`, `ocr`, `ocr-demo`) pass; `plain` still passes
- [ ] Spec criteria 2-5 met with the evidence recorded below
- [ ] Review with the owner before the docs hand-off

---

## Phase 4: Hand-off

### Task 9: Docs: tool README, Grounded `AGENTS.md`, spec status

**Description:** Document what each flag gives you and what it does not (the fake model is canned; OCR stays a single Tesseract sidecar; `--demo` crawls go.dev unless
`--no-crawl`): the `grounded` row of `tools/dev-env/README.md`; the `creds` text for Grounded (the Demo agents); a short section in Grounded's `AGENTS.md` (docs-only PR to
`ncecere/grounded`, merged when its checks are clean); mark the spec's success criteria with the evidence.

**Acceptance criteria:**
- [ ] README and `creds` output describe `--demo`, `--no-crawl`, `--ocr` accurately (checked by running them).
- [ ] Grounded `AGENTS.md` on `main` lists the flags and the acceptance command; the PR's checks are green.
- [ ] Each of the spec's 7 success criteria has a one-line evidence note in this file or the spec.

**Verification:**
- [ ] Read-through against the actual flags; `dev-env up grounded x --help`-level check that flags are listed; Grounded PR merged on a clean state.

**Dependencies:** Tasks 1-8

**Files likely touched:** `tools/dev-env/README.md`, `tools/dev-env/devenv/grounded.py` (the `creds` text), `docs/specs/cluster-testing/SPEC-env-complete.md`; in the Grounded repo: `AGENTS.md`

**Estimated scope:** Small (4 files across two repos)

### Checkpoint: Complete
- [ ] All spec success criteria met, with evidence
- [ ] All acceptance variants (`plain`, `demo`, `demo-nocrawl`, `ocr`, `ocr-demo`) pass on the final `main`
- [ ] `dev-grounded` holds no environment records, objects or PVs (the other areas were never touched)
- [ ] Homelab `main` pushed and the owner's checkout fast-forwarded (its uncommitted files unchanged); scratch worktrees removed
- [ ] Ready for the next module's spec (`cluster-tests`)

## Evidence (filled in as tasks complete)

- **Task 1** (homelab repo `a054c86`): `grounded_accept.py --ref v0.4.2 plain` passed in 62 s: 6 pods ready with 0 restarts, `doctor` 10 checks 0 failed,
  development sign-in as admin 200 with a CSRF token, `down` left 0 objects, 0 pods, 0 volumes. A missing ref exited 1 and still cleaned up; a taken name exited 2 and
  left the existing environment alone. 26 unit tests pass; the one for `me()` was mutation-checked (it fails when the check is removed).
- **Task 2** (homelab repo `d625214`): 45 unit tests pass (19 new). `up grounded x --no-crawl` is refused ("--no-crawl needs --demo") before any cluster call; the real oci, omg and
  grounded modules were only imported (oci and omg declare no flags and would reject all three). The dry run with all three flags prints the options and "not implemented yet, ignored"
  and creates nothing; the no-flag dry run is unchanged. `grounded_accept.py plain` passed again (65 s, 6 pods, 0 restarts, doctor 0 failed, clean teardown). `git diff` of `oci.py`,
  `omg.py`, `common.py` and `kubernetes/` is empty.
- **Task 3** (homelab repo `faf9530`): `grounded_accept.py --ref v0.4.2 demo` passed in 127 s: 7 pods ready with 0 restarts (the gateway applied after the API and worker), `doctor` reaches
  `http://ga-demo-grounded-fake-models:8090/v1` (2 models), the Demo team and agents `go-docs` and `go-docs-signed-in` exist, a model connection points at the prefixed gateway, `down` left nothing.
  `plain` still passes. `--demo` on v0.4.0 (no fixture) is refused before anything is created. 68 unit tests; the NetworkPolicy and URL-override render tests were mutation-checked.
- **Task 4** (homelab repo `93a731d`, fixes `ff0ab9e`): `grounded_accept.py --ref v0.4.2 demo` waits for the Demo source (12-14 documents ready) and asks the Go docs assistant; the answer comes from the demo model with 3 citations. Passed 3 of 3 runs in a
  row after a race was fixed: the first doctor after `up` could fail with "no route to host" for 1-2 s (reproduced in 2 of 3 probes), so `up` now waits until the API reaches the models. `--index-timeout 1` fails, names the crawl, shows the worker log and still cleans up. 84 unit tests.
- **Task 5** (homelab repo `fce7c8c`): `grounded_accept.py --ref v0.4.2 demo-nocrawl` passed twice (78 s and 67 s, against about 130-160 s with the crawl): team, agents and connections as with `--demo`, and the Demo source points at `https://docs.example.edu/doc/`, not go.dev. `plain` still passes. 92 unit tests.
- **Task 6** (homelab repo `f478e82`): `grounded_accept.py --ref v0.4.2 ocr` passed twice (60-63 s): 7 pods ready with 0 restarts; the config's `OCR_TESSERACT_URL` is the environment's own sidecar (`http://ga-ocr-grounded-ocr:8080`, not the component's unprefixed literal: mutation-checked); the sidecar runs `grounded-ocr:v0.4.2` at the registry's digest `sha256:87a46039...`. `--ocr` on v0.1.0 (no component) is refused with 0 records. `plain` still passes. 109 unit tests.
