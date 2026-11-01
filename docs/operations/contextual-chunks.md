# Contextual chunks: rollout and acceptance

**Status: shipped in v0.7.0, default off.** This is the runbook for [A4 / #21](../contextual-chunks.md) and [ADR-0028](../adr/0028-contextual-chunks.md). Two explicitly owner-authorized real synthetic runs passed; [results, exact source and limitations](../benchmarks/contextual-chunks.md). This does not enable an install, prove representative retrieval improvement, authorize future spending or permit production changes.

## Implemented controls to preserve

- Atomic explicit source/build and source/UTC-day call, token and configured-price reservation before dispatch, including build fan-out/shared profiles/platform sources. Missing prices/currency mismatches fail closed. Local configured accounting is not a provider invoice guarantee.
- Unknown/in-flight/partial usage retains conservative reservations. First-terminal CAS settlement commits usage/cache at most once with bounded persistence grace. Remote429 is not proof of unsent/unbilled work; only proven-unsent refusal releases admission. Paid attempts survive content deletion without cache resurrection.
- Current source/set/kill-switch/model/connection/classification checks around calls, waits, cache returns and publication. No DB lock held across network work. Bounded cancellation, unit planning, prompt fitting, output cleaning and response transport.
- Current document/profile/version plans retain their bounded union; deletion/opt-out/snapshot cleanup prunes only permitted artifacts. Generated context never changes original passages, keyword text, citation/viewer text or parent hashes.
- Regression evidence includes unit/PG races, HTTP/authz, full UI, desktop/phone fake browser consent/estimate/held-preview/switch/switch-back, the guarded real check and an ordinary feature-unused upgrade rehearsal. Earlier failed/incomplete wrappers and smaller-host timeouts remain failures. The merged head passed full GitHub CI and exact-source disposable-cluster acceptance.

The guarded test-only entry and private outer receipt protocol are documented in [issue21-live-entry.md](issue21-live-entry.md). Without an explicit single-use source/corpus-bound grant, the live test skips. It never gets authority from the mere presence of a key or environment flag.

## Rollout compatibility

Platform and source opt-ins default off. Keep them off until **all API and worker processes** understand contextual profiles. Prompt construction is version2: earlier private version1 snapshots must be recreated and their artifact keys are not reused. See [derived prompt fitting](../contextual-prompt-estimate-bound.md); this is not a published-profile migration.

A previous release ignores the new profile flag and cannot be trusted to maintain contextual vectors. An additive schema is not proof of mixed-version behavior after opting into a new feature. The source-bound ordinary v0.6.3/schema55→59 rehearsal passed old/new reads and writes with the feature unused/off; it does not validate old workers against active contextual indexes. Only after old workers are gone should an operator explicitly opt in within a disposable sandbox and inspect the held candidate before switching.

**Before rolling back to a binary without this feature**, switch affected knowledge bases back to a retained plain index through the supported rollback path; alternatively build and explicitly switch a noncontextual preview before downgrading. Then disable source/platform opt-ins and stop/drain contextual jobs. Turning the kill switch off alone does not rewrite existing vectors. If a suitable plain index is unavailable, do not downgrade first and assume old workers will repair it. No automatic down SQL or data restore is promised.

## Model context-window checks

The context-writing model must have a declared sufficient window. Unknown windows block source opt-in, estimates and previews; losing one stops worker checkpoints. Before admission and after waits, generation counts the actual escaped prompt and local framing/margin, adds the full requested output allowance and checks the current declared window. Proven-unsent rejection releases its reservation. The activation floor alone is not proof that every document fits; local counters/margins are not an external tokenizer/invoice guarantee. Configure the model explicitly; do not raise caps or silently assume a window.

## Any future real-model run

The completed owner-authorized synthetic check is not a standing grant for retries, another issue or production data. Agree the development endpoint, exact chat/embedding IDs, corpus, known prices/window/dimensions and aggregate request/token/spend limits first. Privately deliver a scoped credential; never put it in chat/source/history/logs/reports or reuse coding-subscription OAuth. Do not mint keys or change accounts/billing. Use provider-side restrictions where available as well as local controls. Retain all permanent claims, including failed/uncertain attempts, on the same coordinator host; never reset the ledger via another checkout/worker.

Before dispatch, validate the strict private grant, clean committed source and corpus digest, preflight all planned requests, permanently claim the allowance and exclusively claim the report. Reuse the real Generator/PGStore/streaming path and exact transport guard. No redirects, proxies, tools, images, alternate models or automatic retries. Explicit modern compatibility may select bounded `max_completion_tokens` and reasoning `none`; it must not enable arbitrary provider JSON.

Report known/unknown usage, reservations versus invoice estimates, actual equal/worse retrieval results, timing and limitations. A small neutral synthetic comparison is not reference-install or answer-quality evidence. After the test, require the separate successful outer receipt, independently verify owned dependencies absent and remove temporary run credentials. Source drift, uncertain cleanup, report failure or missing authority stops the run; it is not a reason to silently retry or replenish a grant.

## Closure gate

#21 stays open until implementation/architectural review, final source-bound GitHub and disposable-cluster gates, and the required owner-authorized real-model check are accepted. The last of those has a successful bounded checkpoint, not a waiver of the other gates. Production rollout and v1.0 remain separate owner decisions.
