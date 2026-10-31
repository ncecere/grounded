# Private issue21 acceptance entry

Test-only scaffolding, not a product/API/schema change or spending authority.
ADR0028 remains Proposed. Fake evidence is not real-provider or representative
retrieval acceptance. No real spending was authorized to this worker.

## Required parent inputs

Independently review/test the final clean committed implementation. Obtain explicit
owner approval, the exact development HTTPS gateway and permitted chat/embedding
IDs, known context window/dimensions, known USD per-million rates, whole-run
bounds, and a privately delivered scoped credential. Do not reuse Codex OAuth.
Where available impose gateway-side model/request and aggregate billing restrictions
strictly under USD5 including failures. No discovery, retry, provider/model switch
or budget increase is implemented.

Create a 0700 directory outside the checkout and private regular 0600 grant/key
files without symlink components or hard links. The test-only acceptanceGrant
schema in acceptance_authority_test.go requires:

- ID: canonical v4 UUID; Purpose: exactly issue21-synthetic-acceptance;
  DevelopmentOnly: true.
- SourceSHA: final clean committed implementation, NOT a baked-in base;
  CorpusSHA256: exact digest of documents AND questions/expected answers.
- Expires: future RFC3339 timestamp within 24 hours.
- KeyFile and ReportFile: absolute canonical paths; report must not exist.
- Config: Endpoint, Currency (USD), Dimensions (1..4000), ContextWindow (known
  sufficient), Seconds (1..300), Limits.
- Optional Config.ChatCompat: strictly typed `maxTokensField` (empty/default,
  `max_tokens`, or `max_completion_tokens`) and `thinkingOff` (empty/default or
  `reasoning_effort_none`). These configure only the disposable catalog model
  through the existing adapter, are recorded in evidence, and do not select a
  model or authorize arbitrary provider JSON. For an explicitly approved modern
  OpenAI model supporting these modes, use `max_completion_tokens` and
  `reasoning_effort_none`; output remains capped at 384 tokens, including reasoning.
  Only exact `reasoning_effort: "none"` is accepted by the context transport;
  reasoning options are forbidden in embedding requests.
- Limits: Requests, InputTokens, OutputTokens, Amount, ContextModel,
  EmbeddingModel, InputPrice, OutputPrice, EmbeddingPrice. Prices and amounts
  are bounded decimal strings, never exponents/floats. No spending defaults.

The nonsecret grant is nevertheless private because it contains local paths.
Never publish it or put credentials in arguments. After approval the parent runs:

    cd /path/to/grounded
    python3 tools/issue21/outer.py --grant /absolute/private/grant.json --artifacts /absolute/private/artifacts

This invokes the source-versioned `tools/issue21/deps.sh` with a unique RUN_ID,
Go1.26.10 (go.mod), GOMAXPROCS=4, GOFLAGS=-p=2, race and count=1. Go's original
10-minute default test timeout is not increased. The outer 660-second bound
terminates the entire owned test process group on timeout/interruption; failed
or unknown cleanup still fails the receipt. No live environment flag is needed.
Without -issue21-grant the live test skips; explicit invalid authority fails,
never falls back to fake. A direct diagnostic command (NO independent outer
receipt) is:

    RUN_ID="issue21-$(python3 -c 'import uuid; print(uuid.uuid4())')" GOMAXPROCS=4 GOFLAGS=-p=2 tools/issue21/deps.sh go test -race -count=1 ./internal/contextual -run '^TestIssue21LiveAcceptance$' -args -issue21-grant /absolute/private/grant.json

Do not treat a harness pass without a successful outer receipt as an overall pass.

## State and security boundary

Real entry uses `<OS-account-home>/.local/state/grounded-issue21`, resolving the
executing UID's account database entry, not HOME/XDG, the working directory,
grant path or an environment override. Tests alone inject roots. Execute every
real attempt on the same coordinator host and retain this ledger; separate
coding workers/snapshots are not independent spending authorities.
Nonblocking flock serializes admission; O_EXCL grant-ID files permanently reserve
the entire approved run amount before credential bytes are read. Every prior
claim counts across IDs; totals >=5 USD fail. Corrupt/partial/nonprivate claims
poison admission rather than restoring headroom. Claim files and containing
directories are synced. Copying/renaming grants, -count and reruns do not replenish
the envelope. No refund/removal tool is supplied. Parent must retain this state.

This is a local same-user filesystem control, NOT an owner signature verifier,
distributed ledger, tamper-proof accounting, external invoice cap, or protection
against a malicious local owner, restored snapshots or another host/root.
Parent coordination must prohibit parallel hosts/state resets and independently
reconcile all prior attempts. Gateway billing restrictions remain necessary.
Reservations are NOT actual billed cost.

Descriptor-relative O_NOFOLLOW traversal rejects symlinks. Immediate parent
directories must be owner-private 0700, files regular 0600 owned by this UID with
one link. Ancestors may be normal home directories but not symlinks. Outputs are
exclusive, bounded and synced. Failures retain claims. Reports exclude paths,
credentials and raw provider errors; echoed credentials in untrusted prefixes
are redacted, including their JSON-escaped forms.

The six-context/three-embedding plan is preflighted before claim/key/network.
The actual Generator/PGStore/streaming adapter is reused, with the same guard
at dispatch, source/expiry/cancellation checks, direct cloned transport without
implicit proxy, no redirects, and bounded response reader. Local counters,
margins and configured prices cannot guarantee external provider charges.

## Reports and cleanup

The report is exclusively created and synced before credentials or dispatch,
so a conflicting output cannot cause unreported paid work. Its nonsecret grant
UUID links evidence to the permanent claim. Private evidence records fake/real
mode, source/corpus digests, rates/limits,
preflight and dispatch reservations, PG known/unknown attempts, embedding usage,
stage timing, actual plain/contextual ranks (including equal/worse), limitations
and fixed local failure codes. Invalid authority produces no output or claim.

The harness always says pending_outer_receipt: a running Go test cannot observe
its own completed cleanup. The wrapper separately records process exit and
independent one-shot Docker container/network absence checks after the dependency
wrapper returns. Fixture teardown is explicitly not independently observed.
Query failure is not absence. Failed/unknown cleanup cannot pass even if the
private harness succeeded. Timeout fails closed; parent must investigate and
remediate owned resources manually, never silently rerun a spent grant.
No cloud/account/worker lifecycle operations are performed.
