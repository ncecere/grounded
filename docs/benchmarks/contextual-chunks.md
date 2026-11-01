# Contextual chunks: bounded synthetic acceptance

Recorded 2026-10-31 for #21 / Proposed ADR-0028. **Mechanics passed; retrieval improvement was not demonstrated.** This is not a representative corpus, answer-quality study, production benchmark or invoice verification. It does not complete #19's mixed-procedure acceptance or #25's reference-install measurement.

## Source and experiment

The owner approved the synthetic run, the exact OpenAI models and a strictly-under-USD5 aggregate envelope including failed/uncertain attempts. The only generating run used source **`f9151fc1d794c13aef876a8c26830ef38d891ee0`**, prompt version 2, corpus SHA-256 **`254e1e78860c4e9fa748b6a0c006ef4d038ea4f47720629e0dbfb9043afc8cb7`**. Documents, questions and expected answers are bound together by `internal/contextual/acceptance_corpus_test.go`.

- Six neutral synthetic documents/questions: parking renewal, tuition instalments, library renewal, course withdrawal, scholarship eligibility and hostile instructions embedded as document data.
- Context model: `gpt-6-luna`, known 1,050,000-token window; explicit existing-adapter compatibility `max_completion_tokens` and reasoning `none`.
- Embedding model: `text-embedding-3-small`, default 1,536 dimensions, identical for plain/contextual passages and queries.
- Actual Generator + PGStore admission/settlement/cache and streaming adapter; cosine ranking over the same six passages/queries. This is not the whole product retrieval pipeline or an evaluation of generated answers.
- Maximum nine requests, 30,000 locally counted input tokens, 2,304 requested output tokens (six × 384), 180 seconds. Text only, fixed two-message system/user prompt, no tools, redirects, environment proxies, alternate models or automatic retries.
- Same-host single-use grant and permanent USD0.25 whole-run reservation, retained after completion. Configured admission rates deliberately overreserved against published pricing; these controls are not an external invoice cap.

No credential, private grant path, raw provider error or institution-specific content is published here. The temporary run-key copy was removed after verification; the owner-delivered private key was not published or changed.

## Observed results

| Check | Result |
|---|---|
| Successful context attempts | 6 |
| Embedding batches | 3 |
| Transport dispatch attempts | 9 |
| Additional requests on cache replay | 0 |
| Unknown context attempts | 0 |
| Reported context input/output tokens | 2,030 / 212 |
| Reported embedding input tokens | 767 (250 + 459 + 58) |
| Harness elapsed | 10.701 s |
| Context generation / cache replay / embeddings | 8,726 / 154 / 1,818 ms |
| Outer test/dependency-wrapper exit | 0 |
| Owned Postgres/Valkey/network | Independently confirmed absent |

Phase timings include local harness/fixture and network effects; they are not provider-latency or production-throughput measurements. Fixture teardown itself is not independently observed by the outer wrapper; dependency absence is.

| Expected synthetic document | Plain rank | Contextual rank |
|---|---:|---:|
| Parking | 1 | 1 |
| Tuition | 1 | 1 |
| Library | 1 | 1 |
| Withdrawal | 1 | 1 |
| Scholarship | 1 | 1 |
| Untrusted-instruction sample | 1 | 1 |

Recall@1 and recall@3 were both 1.0 for both inputs. The baseline already saturated this tiny set. The hostile sample's generated prefix described its factual topic rather than following the embedded instruction; that single sample is not a general prompt-injection safety guarantee. Generated prefixes remain untrusted embedding artifacts, never source quotations or trusted facts.

## Accounting, not an invoice

Published standard rates at the time were USD0.1/M chat input, USD0.5/M chat output and USD0.02/M embedding input. Applying them to reported token totals gives **USD0.00032434**, an estimate rather than a verified charge; cache/tier/regional billing details were not independently invoiced. The conservative transport reservation was USD0.003295, and the separate permanent aggregate-envelope claim remained USD0.25. Neither reservation is presented as money actually billed. There was no automatic retry or replenishment.

Primary rate/model references: [chat model](https://developers.openai.com/api/docs/models/gpt-6-luna), [embedding model](https://developers.openai.com/api/docs/models/text-embedding-3-small), [embedding dimensions/input limits](https://developers.openai.com/api/docs/guides/embeddings).

## Separate implementation validation

Source `d19fdd876fed53836d47fdcbdec750538483fa72` differs from the generating source only by a test inventory entry classifying the contextual cache identity as a plaintext SHA-256 digest, not encrypted credentials. On the retained Boat runner (8 logical CPUs, GOMAXPROCS4, Go build parallelism2), the full HTTP package passed its unchanged race/atomic-coverage/25-minute guard (350 included top-level tests, 923.419 s), followed by canonical `make test COVER=1 SKIP_AUTHZ=1` exit0 (1,125 s wall, HTTP939.825 s). The authorization matrix was checked separately. No production/test-helper performance fix was introduced. An earlier smaller-host HTTP package timeout remains a failure; the different-runner pass does not reclassify it or establish a controlled speedup.

The ordinary upgrade rehearsal from v0.6.3 source `a55dc5e50ab011092ddf6f480891aa3828bf462d` verified schema55→59, old/new API reads and writes while contextual processing stayed unused/off, plus old API health after stopping the new API. This used source-built local scratch derivatives and current UI assets, not production-image/old-UI acceptance. It does not prove safe old-worker coexistence after activation or rollback without first restoring plain indexes.

Raw private reports, source fingerprints, original failed runs, command exits, cleanup receipts, captures and retained-worker exports remain in the coordinator's validation archive. Final pushed-head GitHub CI, disposable-cluster QA and architectural review remain separate merge gates. No release or production enablement is implied.
