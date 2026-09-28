# Load tests: 2× the sizing estimates (Phase 5 P7)

Status: **passed, 2026-09-27.** At twice the DESIGN §1 estimates, the Kubernetes shape (2 api, 2 worker, single Postgres) ran chat, retrieval, the OpenAI-compatible API, uploads and page reads together for 10 minutes. There were no errors and every threshold held. The tests found two things:

- **Ingest ran in 5-second bursts. Fixed:** throughput is 8.7× higher, 2,400 documents/min against 279.
- **Retrieval is bound by Postgres CPU:** about 45 requests/s at the example's 2-CPU limit and about 95/s at 4 CPUs. That is 9× the 2× target, but past it latency grows without limit and nothing is shed.

Every answer and embedding came from the demo's fake model gateway, so these figures measure Grounded itself. A real model is slower by orders of magnitude (see "Real models" below).

Reproduce with `make k8s-load` ([`deploy/loadtest/`](../../deploy/loadtest/README.md)).

## 1. Setup

- **Host:** an Apple M4 Pro laptop (12 CPUs, 48 GB), Docker Desktop with 12 CPUs and 7.75 GiB. Everything shares those 12 CPUs: the cluster, the fake gateway and k6. Other agents' containers were running on the same Docker at the same time, so treat the numbers as indicative, as phase 5 §1 item 9 says of home hardware.
- **Cluster:** one kind node (`kindest/node` v1.37.0) running [`deploy/kubernetes/test/load`](../../deploy/kubernetes/test/load/kustomization.yaml). That is the example-small shape from the real manifests, with their resource limits:

  | Workload | Replicas | CPU limit | Memory limit |
  |---|---:|---:|---:|
  | api | 2 | 2 | 1 Gi |
  | worker | 2 | 2 | 2 Gi |
  | Postgres 17 + pgvector 0.8.6 (`postgres-single`) | 1 | 2 | 2 Gi |
  | Valkey, an S3 test server, `grounded demo --serve-fake-models` | 1 each | | |

  Changes from an example install: `REQUESTS_PER_MINUTE` is raised, and the API is reached on a node port (no ingress). k6 runs in a container on the kind network.
- **Data:** the demo's crawl of go.dev/doc (about 100 pages), plus 5,000 synthetic Markdown documents (16,426 chunks) uploaded by `setup.js` into team `load`. It also creates a KB over them, a published agent, a personal API key (chat, stored conversations) and a service key (retrieval, OpenAI-compatible, uploads). The team's query, token, concurrency and resource limits are raised through the admin API (DESIGN §11). `concurrent_ingest_jobs` stays at its default of 8.
- **The fake model:** `--fake-word-delay` paces its answers. At 20 ms a word, an answer of about 165 words streams for 3.7 s (scenarios a and c). At 80 ms it streams for 14.4 s, like the one-GPU Spark model at home (scenario e). Embeddings are instant.
- **Commit** `5029a43`, the whole run (`deploy/loadtest/run.sh`, 45 minutes). k6 v2.3.0 (`grafana/k6`, pinned by digest).

**The 2× targets** (DESIGN §1: 5,000 daily users, 50 concurrent chats, 20,000 queries a day, a backfill of 1M documents in two weeks at 10–40 chunks/s):

| Dimension | Estimate | 2× target |
|---|---|---|
| Concurrent chats | 50 | 100 answers streaming |
| Queries | 20,000/day | 40,000/day: 1.4/s over an 8-hour day, about 5/s at the peak |
| Daily users | 5,000 | 10,000; about 10 page reads/s |
| Backfill | 10–40 chunks/s | 80 chunks/s; 100 documents/min |

## 2. Results

**Time to first token.** k6 records the time to the stream's first byte. Grounded holds every SSE event until the model starts answering, so that is the time to the first token, less one word delay. The server's own figures (`message_events.first_token_ms`, until the first text delta) are shown next to them.

### (a) Chat over SSE

Each level ramps up over 10 s, then holds for 60 s. Its users ask one question after another as one person. 30% of answers get a follow-up in the same conversation, which adds history and a query rewrite.

| Concurrent | Answers | Answers/s | TTFT p50 | TTFT p95 | TTFT p99 | Total p50 | Total p95 | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 | 454 | 7.0 | 30 ms | 99 ms | 100 ms | 3.72 s | 3.79 s | 0 |
| 50 | 912 | 14.0 | 28 ms | 98 ms | 100 ms | 3.71 s | 3.78 s | 0 |
| **100** | 1,822 | 28.0 | 29 ms | 98 ms | 100 ms | 3.71 s | 3.78 s | 0 |
| 200 | 3,645 | 56.1 | 30 ms | 97 ms | 100 ms | 3.71 s | 3.78 s | 0 |

- Server side over all levels: 6,833 answers, TTFT p50 48 ms and p95 116 ms, total p95 3.78 s.
- Throughput grows linearly with concurrency, and latency does not move up to 200 concurrent answers, twice the target.
- The p95 of about 100 ms is the follow-ups. Their query rewrite is a model call of 4 words (4 × 20 ms), before the answer's first word.
- Peak CPU: api 313m and 251m, Postgres 1,184m, workers 90m. Memory: api ≤ 70 MiB.

**All users at once.** An earlier run started each level's users in the same second (no ramp). The first answers then waited in the database pool: TTFT p95 was 0.5 s at 25, 1.2 s at 100 and 1.9 s at 200, and p99 was 5.2 s at 200. In a separate run (Postgres at 4 CPUs), the p95 of the level's first 5-second window was 1.5 s at 100 and 3.4 s at 200; every later window was 115 ms. Totals, throughput and errors (none) were the same as with the ramp. People do not all press Enter in the same second, but a deploy that drops every stream at once and a client that retries at once would look like this.

### (b) Retrieval

`POST /v1/teams/load/kbs/{kb}/retrieve`, topK 10, with the service key, at fixed arrival rates for 45 s each. The KB has 16,426 chunks, below `VECTOR_EXACT_THRESHOLD`, so it is searched exactly, plus full-text and fusion.

| Offered | Achieved | p50 | p95 | p99 | Errors |
|---:|---:|---:|---:|---:|---:|
| 10/s | 10.0/s | 27 ms | 32 ms | 33 ms | 0 |
| 25/s | 25.0/s | 24 ms | 28 ms | 29 ms | 0 |
| 50/s | 50.0/s | 24 ms | 28 ms | 30 ms | 0 |
| 100/s | 39.1/s | 12.7 s | 14.0 s | 14.5 s | 0 |
| 200/s | 40.8/s | 26.3 s | 31.5 s | 32.8 s | 0 |

- Saturation is between 40 and 50 requests/s; the earlier run saturated at 47–53/s. That is 9–10× the 2× peak.
- Postgres sat at its 2-CPU limit (2,004m), with 25 active connections (both api pools full). The api pods used about 300m each.
- **Postgres CPU is the bottleneck.** The same test with the Postgres limit raised to 4 CPUs sustained 75/s at p95 26 ms, and 95/s at 100/s offered.

### (c) OpenAI-compatible, non-streaming

`POST /v1/chat/completions`, model `agent:load/load`, service key. Each level ramps over 10 s, then holds for 60 s.

| Concurrent | Completions | Per second | p50 | p95 | p99 | Errors |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 178 | 2.7 | 3.73 s | 3.78 s | 3.79 s | 0 |
| 25 | 450 | 6.9 | 3.71 s | 3.73 s | 3.76 s | 0 |
| 50 | 897 | 13.8 | 3.71 s | 3.76 s | 3.78 s | 0 |
| 100 | 1,801 | 27.7 | 3.71 s | 3.72 s | 3.72 s | 0 |

Server side: TTFT p50 48 ms, p95 53 ms. This endpoint has no transcripts and no follow-ups, so there is no rewrite. The answer time is the model's.

### (d) Uploads and ingest

5,000 documents in batches of 50 from 4 uploaders (service key, multipart), then waiting until every one is ready: parsed, chunked, embedded by the fake gateway and indexed.

| Measure | Before the fix (2,000 documents) | After (5,000 documents) |
|---|---:|---:|
| Upload batch (50 files) p50 / p95 | 1.64 s / 2.80 s | 264 ms / 319 ms |
| First upload to last ready | 430 s | 125 s |
| **Documents/min to ready** | **279** | **2,401** |
| **Chunks/s** | **15.2** | **131.5** (target 80) |
| Upload to ready, p50 / p95 | 145 s / 385 s | 58 s / 111 s |
| Failed | 0 | 0 |

- The "before" column comes from the build before the fix (§3.1).
- After the fix, documents are ready about as fast as they are uploaded. The upload-to-ready times are the queue behind the uploaders, running at 8 documents in flight.
- Worker CPU peaked at 91m and Postgres at 697m. Neither is saturated: the per-team cap of 8 in flight (`concurrent_ingest_jobs`) and the 4 jobs per worker (`INGEST_CONCURRENCY`) set the pace.
- With a real embedding gateway, its request limit sets the pace instead ([`scale-10k.md`](scale-10k.md) §2).

### (e) A day in the life at 2×

All traffic together for 10 minutes, with answers streaming for about 14 s (80 ms a word):
- chat: 100 people chatting at all times, ramped over 30 s;
- 3 retrievals/s;
- 1 OpenAI completion/s;
- a batch of 10 documents every 6 s (100 documents/min);
- 10 page reads/s (agents, conversations, KBs, a source, a document page).

| Traffic | Requests | p50 | p95 | p99 | Errors |
|---|---:|---:|---:|---:|---:|
| Chat, time to first token | 4,322 answers | 62 ms | 351 ms | 356 ms | 0 |
| Chat, whole answer | | 14.4 s | 14.7 s | 14.8 s | 0 |
| Retrieve | 1,800 | 56 ms | 73 ms | 109 ms | 0 |
| OpenAI-compatible | 600 | 14.4 s | 14.5 s | 14.6 s | 0 |
| Upload (10 documents) | 101 (1,010 documents) | 49 ms | 85 ms | 145 ms | 0 |
| Page reads | 6,000 | 2 ms | 4 ms | 7 ms | 0 |

- **Thresholds, all passed:** errors < 1% per traffic type, TTFT p95 < 2 s, retrieve p95 < 500 ms, reads p95 < 300 ms, uploads p95 < 5 s.
- The chat TTFT p95 of 351 ms is again the follow-ups' rewrite, 4 words at 80 ms.
- The uploaded documents were ready 0.2 s (p50) and 0.3 s (p95) after upload.
- Peak CPU: api about 100m each, Postgres 752m, workers 90m.

**Crawls** were not load-tested: that would load someone else's site. The demo's crawl of 100 go.dev pages took about 2 minutes, paced by the crawler's per-host politeness, not by Grounded.

## 3. Bottlenecks and what they mean

### 3.1 Ingest dispatch dropped its wake-ups (fixed)

- **What happened.** With instant embeddings, ingest ran at 15 chunks/s. Documents were queued in groups of 8 on the 5-second periodic dispatch (the job table showed `ingest.document` jobs created in bursts at :x1 and :x6). Each document took 130 ms, so the 8 slots were idle most of the time.
- **Why.** A finishing document "kicks" a dispatch job to refill its slot. The dispatch job is unique while it waits or runs. A kick that landed while one was running was dropped, and that dispatch had counted the slots before this document finished. River's `UniqueOpts` must include the running state, so kicks can't simply be kept. The chain of refills died out after a few documents, and the periodic dispatch restarted it.
- **Fix** (`internal/ingest`, `Processor.refill`). A finishing document runs the dispatch in its own commit transaction, under the dispatcher's advisory lock: it counts in-flight documents including itself and queues pending ones into every free slot. It runs in a savepoint and falls back to the kick on error, so a failed dispatch never fails a document. Maintenance mode leaves the slot to the periodic dispatch, as before. Kicks from uploads and the periodic dispatch are unchanged. Test: `TestRefillQueuesInTheFinishingTransaction`.
- **Result:** 2,400 documents/min and 131 chunks/s on the same cluster, from 279 and 15.

### 3.2 Retrieval is Postgres CPU

- **Cost per query.** Each retrieval costs Postgres about 26 ms of CPU: about 10 ms for the exact vector scan of 16k halfvec rows, and about 16 ms for the full-text query (`EXPLAIN ANALYZE`). With 2 CPUs that allows about 45/s.
- **No load shedding.** Past saturation, requests queue in the api's database pool: 25 connections were active, the two pools' maximum. Latency then grows without bound (31 s at 200/s offered) and nothing is refused.
- **What to tune:**
  - Postgres CPU: 4 CPUs gave twice the throughput.
  - Read replicas: CNPG's replicas serve reads once the app sends them there, which it doesn't yet.
  - `VECTOR_EXACT_THRESHOLD`: lower it for large KBs, so the HNSW index serves them.
- **Not changed.** The 2× target is 5/s, so none of this is needed yet.

### 3.3 Full-text cost grows with matching chunks (follow-up)

- **What.** The lexical query ORs every stemmed word of the question and ranks every chunk that matches (`LexicalSQL`, chosen for recall in [`scale-10k.md`](scale-10k.md)). Here a question matched 12,386 of 16,426 chunks, which were all ranked to keep 40.
- **Why it matters.** The synthetic corpus overstates this, because every document shares common words. But common words in real questions ("student", "form", "request") match a large share of a real KB too, and the cost is linear in the matches. The vector side is bounded by the HNSW switch; the lexical side has no bound.
- **At 10M chunks this is the first thing to fail.** Options include ranking only chunks that match the rarer terms, capping the candidate set before `ts_rank`, and dropping lexemes above a document frequency. Each changes ranking, so it needs the retrieval evaluation sets before it ships.

### 3.4 The database pool follows the node's CPU count (recommendation)

- **The default.** pgx sizes each pool at `max(4, runtime.NumCPU())`. That is the node's CPU count, not the pod's limit: 12 here.
- **The risk.** Five Grounded pods (2 api, 2 worker, the demo) on 64-core nodes would open up to 320 connections, and `postgres-single` allows 100.
- **The fix.** Set the pool explicitly in `DATABASE_URL`, for example `?pool_max_conns=16` for the api and fewer for the worker. Keep (api + worker replicas) × `pool_max_conns` under `max_connections` minus a margin for backups and `psql`.
- **Here** the peak was 25 active and 43 total.

### 3.5 Tuning summary

| Knob | Where | Measured | Suggestion |
|---|---|---|---|
| Postgres CPU | `postgres-single` limits, or CNPG `resources` | 2 CPUs: about 45 retrievals/s; 4 CPUs: about 95/s | 2 is enough for 2× (5/s); 4 for 20/s and more, or bursts of API retrieval |
| `pool_max_conns` | `DATABASE_URL` in `grounded-runtime` | 12 per pod by default; 25 active at saturation | Set it explicitly (§3.4) |
| api replicas | base: 2 | about 300m each at 200 concurrent streams, ≤ 70 MiB | 2 carry 2×; 3 for the 99.9% target (DESIGN §15), not for load |
| worker replicas, `INGEST_CONCURRENCY`, `concurrent_ingest_jobs` | base: 2; 4; 8 | 131 chunks/s at 8 in flight, workers ≤ 150m | Raise both only for a backfill faster than the gateway allows; the gateway's limit is the real cap |
| `VECTOR_EXACT_THRESHOLD` | `grounded-config` | exact scan of 16k vectors: about 10 ms | Keep the default until KBs reach it; then HNSW |
| Ramp and retry | clients, rollouts | 1–3 s TTFT when 100–200 answers start in the same second | Clients retry with jitter; `maxSurge: 1` already avoids dropping every stream at once |

## 4. Real models

The fake gateway takes the model out of the picture. The reference install's one-GPU model answers one request at a time, in about 14 s for chat and about 0.7 s for SystemOne (phase 5 §7). So it serves about 4 answers a minute, far below the 7 answers/s that 100 concurrent chats need at that length. With real models, the model is the bottleneck by two orders of magnitude, and Grounded's `model_busy` limits and the connections' `maxConcurrentRequests` are what matter.

The scripts run unchanged against an install with real models (`TARGET=url`). They were not run against real models here: that would only measure the GPU, and it is not ours to load.
