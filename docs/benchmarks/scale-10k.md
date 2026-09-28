# Scale and retrieval quality: 10k documents (Phase 1 exit criterion)

Status: **passed, 2026-09-26.** 10,000 documents were uploaded through the public API. All 10,000 reached `ready`, and each one is retrievable with a citation that maps back to its source file. The run found three problems worth fixing before large backfills:

- ingest throughput is capped by the gateway's per-key request limit;
- rate-limited documents can fail permanently;
- hybrid fusion scores lower than vector search alone on this dataset.

See §6.

Reproduce with `cmd/ragbench` (see `ragbench -h`). The vector-store gate on the same real embeddings is in [`vector-gate.md`](vector-gate.md).

## 1. Setup

- **Dataset: BEIR FiQA-2018** (financial opinion Q&A). 57,638 documents, 648 test queries, and 1,706 relevance judgments (qrels, one relevant document each). 38 documents have no text, so Grounded rejects them as empty files. They are never uploaded, and none of them are judged relevant.
- **Corpus uploaded to Grounded: 10,000 documents.** These are the 1,706 judged documents plus 8,294 random distractors (seeded). The full corpus would have needed about 9 hours of ingest at the gateway's rate limit (§2).
  - Each document is uploaded as `<doc id>.txt`, so every hit's `filename` maps back to its BEIR ID.
  - The full 57,600-document corpus was embedded separately, outside Grounded, for the quality comparison and for the vector gate.
- **Grounded:** built from commit `96131a0` into `/tmp/ragbench/grounded` and run as `grounded serve` on `127.0.0.1:8081`.
  - Its own resources: database `grounded_bench` (dev Postgres 17 + pgvector 0.8.6 in Docker), Valkey DB 3 and a filesystem blob directory.
  - Defaults otherwise: `INGEST_CONCURRENCY=4`, `INGEST_MAX_INFLIGHT_PER_TEAM=8`, `EMBED_BATCH_SIZE=64`, `VECTOR_EXACT_THRESHOLD=50000`, `VECTOR_EF_SEARCH=400`.
  - `REQUESTS_PER_MINUTE` was raised so the benchmark client wasn't rate limited by Grounded itself.
  - The machine is an Apple M-series laptop; Docker has 12 CPUs and 8 GB.
- **Model:** `nomic-embed-text-v1.5` (768 dims) through a university's OpenAI-compatible AI gateway (LiteLLM-based; "the gateway" below). It was added with the admin API: connection, model (`maxInputTokens` 2048) and embedding profile.
  - Profile: `halfvec`, chunk size 512 tokens with 64 overlap, and the nomic task prefixes `search_document: ` and `search_query: `.
  - **Grounded applies both prefixes when the profile sets them:** the document prefix at ingest and the query prefix at retrieval. An admin who leaves them empty gets no prefixes (see §4).
- **Gateway limit:** the gateway key allows **120 requests per minute**. It answers `429` beyond that. The main ingest ran through `ragbench throttle`, a pacing proxy at 110 requests/min with at most 4 concurrent requests (§2).

## 2. Ingest

| measure | value |
|---|---|
| documents uploaded / ready / failed | 10,000 / 10,000 / 0 |
| upload API (100 files per request, 2 concurrent requests) | 10,000 in 1 min 35 s (106 docs/s); 57,600 in 9 min 53 s (97 docs/s) in the first run |
| chunks | 10,653 (1.07 per document; 449 documents have more than one, the most is 6) |
| chunk tokens (Grounded's count) | 1.80 M (180 per document) |
| embedding tokens in the usage ledger (gateway-reported) | 8.43 M |
| first upload to last document ready | 1 h 40 min: **99.8 docs/min** overall, **108.5 docs/min** steady state. For 21 minutes the throttle was shared with the offline embedding run, and ingest ran at 67 docs/min. |
| upload to ready, per document | p50 53 min, p95 94 min (queueing behind the rate limit) |
| gateway requests | 1 per document; 0 upstream 429s in steady state (4 absorbed by the proxy) |
| Grounded tables for this corpus | documents 15.9 MiB, chunks 22.8 MiB, `emb_<profile>` 38.1 MiB (21.4 MiB of indexes), usage_events 5.4 MiB, river_job 14.4 MiB: about **97 MiB** (≈ 10 MiB per 1,000 short documents) |
| blobs (original + parsed Markdown) | 20,000 files, 15.4 MiB of content (79 MiB on disk with 4 KiB blocks) |

**Throughput equals the gateway's request limit.** Grounded embeds each document with its own requests, in batches of up to 64 chunks per document. It does not batch across documents. FiQA documents average 1.07 chunks, so ingest issues about one request per document, and docs/min matches the key's requests/min.

- At 110 requests/min, 10k documents take about 90 minutes and the whole FiQA corpus about 9 hours.
- A 1M-chunk backfill would take weeks at this rate.
- By contrast, the gateway embeds 64 texts in one request in about 1.25 s. With 4 concurrent 64-input requests it embedded the full 57,600-document corpus in 21 minutes while sharing the limit with Grounded.

**Without the proxy, rate limiting makes documents fail.** The first attempt uploaded all 57,600 documents directly against the gateway.

- Grounded's 4 workers sent more than 120 requests/min, so the gateway answered 429.
- Each 429 used up one of the job's 5 attempts (`MaxAttempts: 5`, River's backoff), and the document was requeued.
- Throughput fell to 60–120 docs/min, with whole idle minutes while in-flight slots waited out their backoff.
- Within 12 minutes one document was `failed` with `model_unavailable` after 5 attempts. The rest would have needed manual retries.
- That run was stopped, and the database was recreated for the measured run.

## 3. Retrieval quality and latency

All 648 test queries were sent through `POST /v1/teams/bench/kbs/{kb}/retrieve` with `topK` 10. Hit filenames map back to BEIR IDs; when several chunks of one document come back, only its first occurrence counts. Metrics follow BEIR/pytrec_eval: recall@10 = found relevant / all relevant, and nDCG@10.

The KB has 10,653 vectors, which is under `VECTOR_EXACT_THRESHOLD`, so Grounded searched it exactly.

| ranking (10k-document corpus) | recall@10 | nDCG@10 | MRR@10 |
|---|---:|---:|---:|
| **Grounded `/retrieve` (hybrid: vector + full-text, RRF)** | **0.484** | **0.365** | 0.425 |
| vector search only, over Grounded's stored vectors (exact) | 0.594 | 0.528 | 0.610 |
| full-text only (Grounded's query) | 0.207 | 0.148 | 0.175 |
| RRF, equal weights, ties broken by vector rank | 0.496 | 0.377 | 0.436 |
| RRF, full-text weight 0.5 | 0.545 | 0.414 | 0.463 |
| RRF, full-text weight 0.25 | 0.580 | 0.456 | 0.510 |

The rows after the first come from `ragbench dense -fusion`. It runs the same two candidate queries as Grounded (40 candidates each, Grounded's full-text SQL) and fuses them offline. Its equal-weight row (0.364) reproduces the API result.

**Sanity check against published numbers.** The full 57,600-document corpus was embedded directly with the same model and prefixes (`ragbench offline`) and searched exactly. That gave nDCG@10 **0.376**, recall@10 **0.450**, MRR@10 0.455. The model card reports FiQA2018 test nDCG@10 **0.3746**, recall@10 **0.4437**, MRR@10 0.4540 ([nomic-ai/nomic-embed-text-v1.5 model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5), MTEB results). The gateway's model and Grounded's handling of prefixes therefore match the reference. The 10k-corpus numbers are higher only because there are fewer distractors.

**Prefix and title ablations** (10k corpus, vector only, exact, embedded directly):

| document prefix | query prefix | title header | nDCG@10 | recall@10 |
|---|---|---|---:|---:|
| `search_document: ` | `search_query: ` | none | 0.532 | 0.599 |
| none | none | none | 0.524 | 0.592 |
| `search_document: ` | none | none | 0.526 | 0.591 |
| none | `search_query: ` | none | 0.519 | 0.596 |
| `search_document: ` | `search_query: ` | `<doc id>` line (what Grounded embeds for `.txt` uploads) | 0.526 | 0.592 |
| Grounded's stored vectors (chunked, halfvec, title header) | `search_query: ` | as Grounded | 0.528 | 0.594 |

**Latency** was measured with the queries paced at 90/min, so the gateway limit added no waiting. It covers the whole `/retrieve`, with the server's and the client's timings within 5 ms of each other:

- **p50 202 ms, p95 1.37 s, p99 2.7 s.**
- Almost all of it is the query embedding call. Single embedding requests to the gateway measured 0.14–0.37 s typically, with a tail to 1.7–2.6 s.
- The database part is small: exact vector search p50 4.6 ms, full-text query p50 12.5 ms (p95 30 ms).

## 4. What we learned

1. **Criterion met.** 10k documents were uploaded, all reached `ready`, and all are retrievable with citations (filename, title, chunk, document and source IDs).
2. **Ingest is bound by gateway requests, not by Grounded.** Upload runs at about 100 docs/s. Parsing, chunking and indexing are not visible in the timings. Embedding one request per document caps ingest at the key's requests/min (120 today).
3. **Rate limiting is handled as failure, not as backpressure.** A 429 consumes one of 5 attempts, backoff holds in-flight slots idle, and documents can end `failed`. Pacing the requests removed every failure.
4. **Hybrid fusion lowers quality on FiQA.** Grounded's full-text query ORs the question's lexemes and ranks with `ts_rank_cd`. It has no IDF and no length normalisation, and reaches nDCG@10 0.148; BEIR reports BM25 at 0.236 on the full FiQA corpus. Equal-weight RRF with ties broken on the full-text rank pulls vector nDCG@10 down from 0.528 to 0.365. FiQA is paraphrased opinion Q&A with little word overlap, so full-text search may help more on institutional web content (course codes, names, policy numbers). But this is the only measurement we have, and the effect is large.
5. **Prefixes are applied and matter only a little here.** On FiQA they are worth +0.008 nDCG@10. The `<doc id>` title line that Grounded derives from a `.txt` filename costs about 0.006. Both effects are small, but a profile created without prefixes silently loses some quality.
6. **The gateway reports about 4.7× more embedding tokens than Grounded counts:** 8.43 M reported against 1.80 M chunk tokens, and 49,390 tokens reported for one 64-document request. The usage ledger stores the gateway's figure, so it overstates embedding volume if the gateway's count is wrong. A later probe showed why: this gateway reports embedding `prompt_tokens` as characters, not tokens (281 characters gave 281 "tokens", 4,000 gave 4,000). Check this with the gateway's operators before relying on it for budgets.

## 5. Recommendations

These cover `internal/`, which this run did not change. Items 1–3 were done the same day (§7 and §8). Item 4 is open.

1. **Batch embeddings across documents in ingest**, or have the embed stage pull chunks from several documents per request, up to `EMBED_BATCH_SIZE`. With 64 inputs per request, the 120 requests/min limit allows up to 7,680 chunks per minute. The gateway's own speed then becomes the bound: 4 concurrent 64-input requests measured about 80 documents/s, or 4,800 per minute, against 120 today.
2. **Treat 429 as backpressure.**
   - Add a per-connection request-rate limit (requests/min) next to the concurrency limit.
   - Honour `Retry-After`.
   - Don't count rate-limited attempts toward `MaxAttempts`.
   - Or snooze the job instead of failing it.
   - Separately, ask the gateway's operators for a higher limit or a dedicated key for ingestion.
3. **Revisit fusion before Phase 3:**
   - Make the RRF weights a KB setting.
   - Break ties on the vector rank.
   - Consider `websearch_to_tsquery`, or a ranking that uses IDF.
   - Most importantly, build a small evaluation set from real institutional content (DESIGN §19 "retrieval evaluation sets") and choose defaults from it. On FiQA, vector-only or a full-text weight of 0.25 or lower is best.
4. **Default the nomic prefixes** when an admin creates a profile for a nomic model, or warn when they are empty. Also consider not embedding a title that comes from the filename (such as `123`) as the chunk header.

## 6. Reproduce

```sh
mkdir -p /tmp/ragbench && cd /tmp/ragbench
curl -O https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/fiqa.zip && unzip fiqa.zip
go build -o /tmp/ragbench/grounded ./cmd/grounded && go build -o /tmp/ragbench/ragbench ./cmd/ragbench
docker exec grounded-postgres-1 psql -U grounded -d postgres -c "CREATE DATABASE grounded_bench"
# Grounded on :8081 with DATABASE_URL=.../grounded_bench, VALKEY_URL=redis://127.0.0.1:56379/3,
# BLOB_DIR=/tmp/ragbench/blobs, DEV_AUTH=true, APP_URL=http://127.0.0.1:8081 (see .env.example)
set -a && . ./ai.env && set +a                         # URL, KEY (never printed)
ragbench throttle -rpm 110 &                           # pacing proxy on 127.0.0.1:18090
ragbench setup -gateway-url http://127.0.0.1:18090     # connection, model, profile, team, source, KB
ragbench upload -max-docs 10000                        # judged docs + seeded distractors
ragbench wait
ragbench eval -rpm 90                                  # /retrieve: recall@10, nDCG@10, latency
export BENCH_DATABASE_URL=postgres://grounded:grounded-dev-only@127.0.0.1:55432/grounded_bench?sslmode=disable
ragbench dense -gateway-url http://127.0.0.1:18090 -fusion   # vector/full-text/RRF on the same candidates
ragbench offline -gateway-url http://127.0.0.1:18090 -queries-out queries.jsonl \
    -export-dsn "$BENCH_DATABASE_URL" -export-table bench_fiqa_nomic          # full corpus, for the gate
ragbench offline -gateway-url http://127.0.0.1:18090 -max-docs 10000 -doc-prefix "" -query-prefix ""
ragbench stats -blob-dir /tmp/ragbench/blobs
```

Embeddings are cached in `/tmp/ragbench/cache`, so re-runs and ablations only request what changed. Never commit the dataset, the cache or `ai.env`.

## 7. Fusion tuning (2026-09-26)

**Question:** which keyword query and which fusion weights should `/retrieve` and agents use by default?

**Method:**
- `ragbench sweep` fuses Grounded's exact vector candidates with several full-text query variants at several keyword weights. It uses the application's own fusion code (`kbs.Fuse`) over the stored vectors and cached query embeddings, so no gateway calls are needed.
- **FiQA:** the 10,000-document corpus above, 648 queries.
- **Registrar set:** 30 realistic student questions with the page(s) that answer them, over a dev KB of 58 pages crawled from a public university registrar website, with real nomic embeddings. Run with `ragbench urlset`. The question set is not published (it contains a third party's site content); its format is in [`README.md`](README.md#evaluation-data).

**FiQA,** nDCG@10 / recall@10, vector weight 1 (vector only: 0.526 / 0.592):

| keyword query | keyword only | wk=0.05 | wk=0.1 | wk=0.2 | wk=0.5 | wk=1 |
|---|---:|---:|---:|---:|---:|---:|
| OR lexemes, `ts_rank_cd(…,1)` (before) | 0.148 / 0.207 | 0.511 / 0.596 | 0.497 / 0.596 | 0.471 / 0.587 | 0.414 / 0.545 | 0.377 / 0.496 |
| OR lexemes, `ts_rank(…,1)` (**chosen**) | 0.325 / 0.402 | 0.530 / 0.600 | 0.526 / 0.598 | 0.515 / 0.594 | 0.488 / 0.564 | 0.472 / 0.558 |
| OR lexemes, `ts_rank(…,0)` | 0.289 / 0.346 | 0.524 / 0.596 | 0.520 / 0.598 | 0.507 / 0.591 | 0.471 / 0.560 | 0.449 / 0.539 |
| AND first (`websearch_to_tsquery`), OR fallback, `ts_rank(…,1)` | 0.327 / 0.402 | 0.530 / 0.601 | 0.526 / 0.601 | 0.515 / 0.597 | 0.487 / 0.565 | 0.471 / 0.558 |
| AND only (`websearch_to_tsquery`) | 0.063 / 0.067 | 0.526 / 0.593 | 0.525 / 0.592 | 0.524 / 0.593 | 0.519 / 0.590 | 0.514 / 0.585 |

**Registrar set,** nDCG@10 / recall@10, vector weight 1 (vector only: 0.943 / 0.983; Grounded before tuning, equal weights with ties on the keyword rank: 0.903–0.908 / 0.967–0.983):

| keyword query | keyword only | wk=0.05 | wk=0.1 | wk=0.2 | wk=0.5 | wk=1 |
|---|---:|---:|---:|---:|---:|---:|
| OR lexemes, `ts_rank(…,1)` (**chosen**) | 0.824 / 0.900 | 0.950 / 0.983 | 0.948 / 0.983 | 0.948 / 0.983 | 0.932 / 0.983 | 0.920 / 0.983 |
| OR lexemes, `ts_rank_cd(…,1)` (before) | 0.677 / 0.917 | 0.950 / 0.983 | 0.950 / 0.983 | 0.947 / 0.983 | 0.927 / 0.967 | 0.923 / 0.967 |

**Chosen defaults:** vector weight 1, keyword weight **0.1**, keyword query = OR of the question's stemmed lexemes ranked by `ts_rank` normalised by `1 + log(length)`, ties broken on the vector rank.
- **`ts_rank` over `ts_rank_cd`.** Cover density rewards terms close together, which suits short phrases but not natural questions against long passages. `ts_rank` doubled keyword-only quality on FiQA (0.148 → 0.325) and improved it on the registrar set (0.677 → 0.824). It is also 2–3× faster.
- **AND-first adds nothing** over OR with `ts_rank` and costs a second query when it falls back, so it was dropped.
- **Keyword weight 0.1 rather than the best-scoring 0.05.** The two are within noise on both sets (FiQA 0.526 against 0.530; registrar 0.948 against 0.950), and the registrar set has only 30 questions. 0.1 keeps more influence for exact-term matches such as course codes, form names and policy numbers, which neither set tests much. A KB can raise it (`fusionWeights`), for example for catalogues of codes.
- **Net effect:** FiQA nDCG@10 goes from 0.364 to 0.526 (+45%). The registrar set goes from 0.903 to 0.948.

Reproduce: `ragbench sweep -dsn …grounded_bench… -query-vectors /tmp/ragbench/cache/…` for FiQA, and `ragbench urlset -eval <your questions.jsonl> -kb <kb id> -dsn …grounded…` for a URL-judged set (see `-h`).

## 8. Ingest batching and backpressure (2026-09-26)

**Setup:** 1,705 FiQA documents (the judged set) ingested through a fake gateway limited to 120 requests/min with 250 ms latency (`fakeproxy -embed-rpm 120 -embed-latency 250ms`), by `/tmp/ragbench/ingest-run.sh`.

- **Before** (one request per document, 429s retried as failures): about 110–120 docs/min. That is 1.1 inputs per request, and requests were rejected with 429 throughout. In the unthrottled gateway run of §2, one document failed permanently this way.
- **After** (cross-document batching, connection pacing at 115 requests/min, 429 as backpressure): all 1,705 documents ready in 4 m 48 s, **355 docs/min (about 3×)**. There were 431 requests carrying 4.4 inputs each on average, and 0 rejected by the gateway, so there were no 429s, no snoozes and no retries. Before, 64 requests had been rejected by the 360th document.
- **The next limit is how many documents are in flight.** A request can only combine chunks from documents being processed at the same time. With one team, that is its `concurrent_ingest_jobs` limit (default 8). A backfill can raise that limit, or `INGEST_CONCURRENCY`, to fill requests closer to `EMBED_BATCH_SIZE` (64). At 64 inputs per request, 115 requests/min allows about 7,000 chunks per minute.
