# Contextual chunks: implementation and acceptance plan

**Status: unfinished, not ready to enable or release.** This is the runbook/acceptance plan for [A4 / #21](../contextual-chunks.md) and Proposed [ADR-0028](../adr/0028-contextual-chunks.md), not a claim that the controls below are implemented. No real-model acceptance has run. Do not use production data, settings, credentials or deployment changes to test it.

## What must be completed first

- Explicit source/build and UTC-day admission limits for calls, tokens and configured-price spend, reserved atomically before dispatch. Daily limits must cover build fan-out too, including platform-owned sources without a team budget.
- Unknown prices remain unknown; they cannot silently bypass a required spend limit. Local configured-price accounting is not a guarantee about an external provider's invoice. Unknown/in-flight usage must retain conservative reservations, and retries/settlement must not double-record usage.
- Class/source/set/kill-switch checks at the correct checkpoints; bounded cancellation, persistence and cleanup; no caching a response after its run stops. Distinguish local pre-dispatch pacing from a remote HTTP response: an upstream 429 is not universal proof that nothing was processed or billed.
- Cache isolation and bounded lifecycle across documents, sources and active profile plans. No generated context in original passages, citation/viewer text, full-text search or parent hashes.
- Fake-model unit, Postgres, HTTP authorization, preview/apply/rollback and shared-source tests; final current-head CI and disposable cluster acceptance. The private backend now has direct-Postgres race evidence for atomic admission and bounded/idempotent usage/cache persistence, plus full lint; the broader HTTP/UI/preview/lifecycle and final source-bound acceptance gate is still pending.

There are deliberately no enable/run commands here yet: the implementation and acceptance harness are unfinished, so inventing executable instructions would be misleading.

## Rollout compatibility to verify before enablement

The platform and source opt-ins default off. Keep them off throughout an upgrade until **all API and worker processes** understand contextual profiles. The current private prompt construction is version 2: prior private version-1 snapshots are unsupported and must be recreated, and their artifact keys are not reused. See [derived prompt fitting](../contextual-prompt-estimate-bound.md); this is not a published-profile migration. A previous release ignores the new profile flag and cannot be trusted to maintain contextual vectors; an expand-only schema is not proof of mixed-version behavior after opting into a new feature. The upgrade rehearsal must verify old-version ordinary reads/writes while the feature stays off, followed by explicit sandbox opt-in only after old workers are gone. Before rolling binaries back to a release without this feature, switch affected knowledge bases back to a plain index using the supported rollback path; turning the kill switch off alone does not rewrite existing vectors. No production rollout is authorized by this planning guidance.

## Model context-window checks

Context-writing models must have a declared context window meeting the activation floor. An unknown window blocks source opt-in, estimates and previews; losing it later stops the worker checkpoint. Before admission and again after any admission wait, generation counts the actual escaped prompt and local framing with its configured margin, adds the full requested output allowance, and checks that total against the current declared window. A proven-unsent rejection releases its reservation. The activation floor alone is not proof that every document fits, and the local counter/margin is not a guarantee about an external model's tokenizer or invoice. Choose/configure an appropriate development model explicitly; do not raise limits or silently assume a window.

## Permission for a real-model run

Before any request, agree the development gateway, allowed context-generation and embedding model IDs, synthetic corpus, maximum requests/input/output tokens, and maximum spend with the owner. Obtain a scoped development credential through the approved private secret mechanism; never paste it into chat, source, shell history, logs or artifacts. Do not mint a key or infer spending authority from general development permission. Use gateway-side model/request/credit restrictions where available as well as application limits.

A real key is not needed for the fake-model tests. Merely having a key does not authorize an unbounded run or production-data processing.

## Bounded synthetic acceptance

1. Use a small, institution-neutral corpus and fixed expected-document questions. Include ambiguous section references, a too-large document and hostile instructions, without external tenant data or network fetches.
2. Fix the chunker, embedding model and retrieval settings. Compare plain and contextual inputs/retrieval over the **same** passages and queries, keeping the live index unchanged until an explicit sandbox switch.
3. Use real context generation and real embeddings for the retrieval comparison. Review the generated prefixes as **model-generated artifacts**, never as source quotations or trusted facts. A small synthetic comparison does not establish general answer-quality improvement; report equal or worse results honestly.
4. Verify caps/reservations, cache reuse and cancellation on the fake path first. The real run must not discover by accident that its cost controls were missing. Stop on unexpected usage, price/configuration drift, permission/classification changes or an exhausted limit; do not increase caps automatically.
5. Record requested/actual calls, reported and unknown tokens, configured-price reservations/settlements, gateway-side cost where available, latency, retrieval results and limitations. No secret or provider response containing private material belongs in the publication record.
6. Remove the owned disposable environment and credentials/resources created for the run according to the agreed scope. Verify cleanup and publish the exact source and evidence, not a previous head's result.

## Closure gate

#21 remains open until the implementation, final source-bound CI/cluster gates and this owner-authorized real-model acceptance are complete. Fake models prove mechanics only. Production rollout and v1.0.0 remain separate owner decisions.
