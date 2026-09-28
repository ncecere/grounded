# Vector store benchmark gate (ADR-0004)

Status: **passed on real embeddings, 2026-09-26, with one stress case that needs a fix before very large tables.**

- **Real embeddings.** `nomic-embed-text-v1.5` vectors of the 57,600 FiQA documents were measured with Grounded's HNSW path at `ef_search` 400:
  - recall@10 **0.997** when the KB is alone in its table;
  - **0.998** among 500k synthetic rows of other sources;
  - **0.997** among 500k near-duplicate rows of other sources.
  The criterion is ≥ 0.95. The earlier 0.57 was an artifact of the synthetic data.
- **Stress case.** A 1.56M-row table in which the KB is 3.7% and every KB vector has about 26 near-duplicates in other sources reaches only **0.845** with the current index (m=16, ef_construction=64). Two of the §4 fallbacks fix it:
  - hash partitioning by `source_id` (16 partitions): **0.998**, and the fastest option;
  - m=24 / ef_construction=128: **0.997**, at 2.8× the build time.
- Results are in §5. Small and medium KBs (up to 50k vectors) are still searched exactly and pass (§2).

Run it with `go run ./cmd/vecbench` (see `-h`).

- **Default mode** loads clustered synthetic vectors into a table shaped like the application's: `halfvec(768)`, HNSW cosine with m=16 and ef_construction=64, and a `source_id` filter. It measures recall@10 against exact search, and latency, for KBs of different sizes.
- **`-real-table` mode** runs the same measurement on real vectors and real queries (§5).

## 1. Setup (synthetic run, 2026-09-25)

- A laptop (Apple M-series) running Postgres 17 and pgvector in Docker, with `maintenance_work_mem=768MB` and 4 parallel build workers.
- 1,000,000 vectors × 768 dims across 2,000 sources. Source sizes follow a Zipf distribution, and each source covers about 3 of 2,000 topics.
- Loading took 56 s. **Building the HNSW index took 9 min 45 s.** Table and indexes use 3.5 GiB.
- **On-topic** queries are perturbed copies of vectors inside the filter, like users asking a KB about its own content. **Off-topic** queries come from random topics; this is the worst case for filtered HNSW search.

## 2. Synthetic results with the final policy (exact up to 50k vectors, HNSW above, ef_search 400)

| scenario | queries | vectors in filter | recall@10 | p50 ms | p95 ms | p99 ms |
|---|---|---:|---:|---:|---:|---:|
| small KB (5 small sources) | on-topic | 448 | 1.000 | 0.5 | 0.7 | 1.3 |
| small KB | off-topic | 448 | 1.000 | 0.5 | 0.9 | 1.1 |
| medium KB (20 mid sources) | on-topic | 6,114 | 1.000 | 1.9 | 2.1 | 4.3 |
| medium KB | off-topic | 6,114 | 1.000 | 1.6 | 2.0 | 2.1 |
| large KB (largest source) | on-topic | 83,646 | 0.568 | 13.0 | 18.1 | 19.5 |
| large KB | off-topic | 83,646 | 0.087 | 40.4 | 51.2 | 56.7 |
| very large KB (10% of sources) | on-topic | 632,414 | 0.578 | 13.2 | 15.3 | 20.7 |
| very large KB | off-topic | 632,414 | 0.407 | 12.6 | 18.2 | 21.6 |

## 3. What we learned from the synthetic run, and what we changed

1. **Postgres's planner chooses badly for filtered vector search.**
   - Left to itself, it used HNSW for a 6k-vector KB, which lost recall (0.66–0.75).
   - It chose an exact scan for a 632k-vector KB, which cost 330 ms.

   **Change:** the app now chooses the strategy itself (`internal/vectorstore`). A KB's approximate vector count comes from its sources' chunk counts, cached for 1 minute.
   - Up to `VECTOR_EXACT_THRESHOLD` (default 50,000), the search is **exact**: rows are read through the `source_id` index and sorted.
   - Above it, the filter is hidden from the btree so **HNSW** drives the scan, with iterative scanning.
2. **Exact search scales linearly.** On synthetic data it cost about 0.5 ms per 1,000 vectors on one core: 2 ms at 6k vectors, 40 ms at 84k, 320 ms at 632k. On real data, 57,600 vectors take 16 ms (§5).
3. **`ef_search`**: 400 improved recall over 100 at modest latency cost. The default is now 400 (`VECTOR_EF_SEARCH`).
4. **Synthetic HNSW recall on large filtered sets was 0.57.** §5 shows this came from the synthetic data (isotropic clusters, where many neighbours are almost equidistant), not from pgvector.

## 4. Fallback options (from the original gate, now measured)

If large-KB recall is below 0.95, try in order:

1. Raise HNSW `m`/`ef_construction` (for example 24/128). Builds get slower. **Measured in §5.3.**
2. Hash-partition the vector tables by `source_id`, so each graph is smaller and filters prune partitions. **Measured in §5.3.**
3. Raise the exact threshold and use parallel query workers for mid-size KBs. **Exact latency is measured in §5.** Parallel workers did not help (§5.4).
4. Implement `VectorStore` on Qdrant, whose payload-indexed filtered HNSW is built for this workload. The interface already allows it. **Not needed on current evidence.**

## 5. Real-embedding results (2026-09-26)

### 5.1 Setup

- **Vectors:** all 57,600 non-empty documents of BEIR FiQA-2018, embedded with `nomic-embed-text-v1.5` (768 dims) through the AI gateway of [`scale-10k.md`](scale-10k.md) with the `search_document: ` prefix. They are stored as `halfvec` under a single `source_id`, like one large KB.
  - Their quality matches the published model: exact search gives FiQA nDCG@10 0.376, against 0.3746 on the model card. See [`scale-10k.md`](scale-10k.md).
- **Queries:** the 648 FiQA test queries, embedded with `search_query: `.
- **Search path:** each query runs the same SQL and settings as `internal/vectorstore` for KBs above the exact threshold:
  - the `CASE WHEN source_id = ANY(...)` filter;
  - `enable_seqscan`/`enable_bitmapscan` off;
  - `hnsw.iterative_scan = relaxed_order`;
  - `LIMIT 40`, because Grounded asks for 4 × topK vector candidates;
  - results re-sorted by distance.
- **Measure:** recall@10 against exact search over the same filter.
  - "recall@10 (distance)" counts results tied with the 10th exact distance as hits. It was always equal to ID recall on real data, so near-ties don't matter here.
  - recall@40 is the recall of the whole candidate list that Grounded fuses.
- **Filler rows** stand in for other teams' sources: 2,000 more sources with Zipf-distributed sizes.
  - *Synthetic:* vecbench's clustered random vectors. They sit far from real text embeddings, so they barely interact with the KB's graph.
  - *Near-duplicate (cos 0.9):* noisy copies of randomly chosen FiQA vectors with an expected cosine of 0.9 to their seed. For comparison, a FiQA document's nearest real neighbour has median cosine 0.84 (p95 0.91). These copies are closer than almost any real neighbour; think of many teams indexing lightly edited copies of the same pages.
  - *Same-topic (cos 0.8):* the same construction with more noise.
- **Hardware:** the same laptop Docker Postgres 17 + pgvector 0.8.6, 12 CPUs, 8 GB, 1 GB `/dev/shm`. The build ran with `maintenance_work_mem=900MB` and 4 parallel workers.
  - With less than the graph size in `maintenance_work_mem`, pgvector finishes the build on disk, much more slowly (see the build times).
  - Latency is single-client, on a warm cache.

### 5.2 Results with the current defaults (m=16, ef_construction=64)

| scenario | rows in table | KB rows (share) | HNSW build | ef_search | recall@10 | recall@40 | p50 ms | p95 ms |
|---|---:|---:|---|---:|---:|---:|---:|---:|
| KB alone | 57,600 | 57,600 (100%) | 4 s, 113 MiB | 100 | 0.985 | 0.969 | 1.5 | 2.1 |
| | | | | 200 | 0.994 | 0.987 | 2.1 | 2.8 |
| | | | | **400** | **0.997** | 0.995 | 4.5 | 14.5 |
| | | | | 800 | 0.999 | 0.998 | 6.4 | 9.2 |
| + 500k synthetic filler | 557,599 | 57,600 (10%) | 2 min 39 s, 1.09 GiB | 100 | 0.982 | 0.964 | 2.2 | 2.9 |
| | | | | 200 | 0.993 | 0.986 | 3.4 | 4.5 |
| | | | | **400** | **0.998** | 0.994 | 5.6 | 7.4 |
| | | | | 800 | 0.999 | 0.998 | 9.3 | 12.4 |
| + 500k near-duplicate filler (cos 0.9) | 557,599 | 57,600 (10%) | 2 min 33 s, 1.09 GiB | 100 | 0.974 | 0.936 | 3.6 | 4.5 |
| | | | | 200 | 0.990 | 0.974 | 6.0 | 7.6 |
| | | | | **400** | **0.997** | 0.990 | 10.5 | 13.6 |
| | | | | 800 | 0.999 | 0.997 | 18.5 | 24.0 |
| + 1.5M near-duplicate filler (cos 0.9) | 1,557,600 | 57,600 (3.7%) | 18 min 24 s, 2.97 GiB | 100 | 0.732 | 0.644 | 5.6 | 11.7 |
| | | | | 200 | 0.794 | 0.718 | 6.7 | 11.4 |
| | | | | **400** | **0.845** | 0.791 | 10.4 | 17.2 |
| | | | | 800 | 0.873 | 0.844 | 18.4 | 31.2 |
| + 1.5M same-topic filler (cos 0.8) | 1,557,600 | 57,600 (3.7%) | 20 min 15 s, 2.97 GiB | 100 | 0.933 | 0.886 | 5.6 | 6.7 |
| | | | | 200 | 0.961 | 0.934 | 10.0 | 11.6 |
| | | | | **400** | **0.977** | 0.963 | 18.4 | 21.2 |
| | | | | 800 | 0.989 | 0.980 | 37.4 | 42.0 |

Exact search over the same 57,600 KB rows (the `source_id` index, then a sort) took **p50 16 ms (p95 18 ms)** in every table size: about 0.29 ms per 1,000 vectors.

In the failing case, raising `hnsw.max_scan_tuples` from 20,000 to 100,000 changed nothing (0.845 / 0.873). The loss is in graph quality, not in the iterative scan stopping early.

### 5.3 Fallbacks on the failing case (1.56M rows, near-duplicate filler)

| option | HNSW build | index size | ef_search | recall@10 | recall@40 | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|
| current (m=16, ef_construction=64) | 18 min 24 s | 2.97 GiB | 400 | 0.845 | 0.791 | 10.4 | 17.2 |
| 1: m=24, ef_construction=128 | **52 min 15 s** | 2.97 GiB | 100 | 0.974 | 0.933 | 6.2 | 8.7 |
| | | | 200 | 0.990 | 0.966 | 9.5 | 14.5 |
| | | | **400** | **0.997** | 0.987 | 16.5 | 24.9 |
| | | | 800 | 0.999 | 0.996 | 28.6 | 44.9 |
| 2: 16 hash partitions by `source_id` (m=16, ef_construction=64) | **2 min 25 s** | 2.97 GiB | 100 | 0.979 | 0.958 | 2.9 | 3.9 |
| | | | 200 | 0.993 | 0.984 | 4.6 | 5.9 |
| | | | **400** | **0.998** | 0.994 | 7.5 | 9.9 |
| | | | 800 | 0.999 | 0.998 | 11.9 | 15.6 |
| 3: exact search for this KB | none | — | — | 1.000 | 1.000 | 16 | 18 |

- **Partitioned variant.** The table is `PARTITION BY HASH (source_id)` with an HNSW index on each partition and no `source_id` btree. The query filters with a plain `source_id = ANY(...)`, so the planner prunes to the KB's partitions and walks their smaller graphs.
  - The KB's partition held its 57.6k rows plus about 94k filler rows.
  - The build is 7.6× faster than the unpartitioned one, because each partition's graph fits in `maintenance_work_mem`.
- **The m=24 index is the same size as the m=16 one.** Each 768-dim `halfvec` element takes about 1.5 KiB, so four elements fill an 8 KiB page with either neighbour-list size.

### 5.4 What we learned

1. **The gate passes on real embeddings.** On real text embeddings, filtered HNSW via Grounded's path reaches 0.997–0.998 recall@10 at `ef_search` 400. That holds for a 57.6k-vector KB alone, and among 500k rows of other sources, whether those rows are unrelated or near-duplicates. The synthetic 0.57 was a property of isotropic synthetic clusters.
2. **`ef_search` 400 is the right default.**
   - 200 already gives 0.990–0.994.
   - 400 adds about 0.005 recall for 3–6 ms more.
   - A query's end-to-end latency is dominated by the embedding call: about 200 ms p50 through the gateway.
   - No change recommended.
3. **Very large tables with heavy cross-source duplication break m=16 graphs.** When each KB vector has dozens of near-identical neighbours in other sources, the graph neighbourhoods fill with other sources' copies. Filtered search then misses KB rows, and more `ef_search` or `max_scan_tuples` barely helps.
   - Same-topic (cos 0.8) filler at the same size passes, at 0.977 with `ef_search` 400. The margin is smaller, though, and HNSW is then no faster than exact search on the KB (18.4 ms against 17.3 ms p50).
   - At a university, the realistic path to this situation is many teams crawling the same sites into their own sources. Platform-shared sources exist to avoid exactly that.
4. **Partitioning by `source_id` is the best fix measured.** It gave the highest recall, the lowest latency and the fastest build. m=24/128 also fixes recall, but its build is 2.8× slower than the current parameters (7.6× slower than partitioned) and it is no faster than exact search at this KB size.
5. **Exact search is cheaper on real data than the synthetic estimate:** 16 ms for 57.6k vectors. Raising `VECTOR_EXACT_THRESHOLD` to about 100,000 (about 30 ms) would keep more KBs on the perfect-recall path at little cost. Parallel workers did not speed up the filtered exact path: the bitmap heap scan plus sort stayed single-process (16.4 ms with 0 workers, 16.9 ms with 4 among 500k filler rows). They only helped when the KB was the whole table and Postgres used a parallel sequential scan (15.5 ms to 8.0 ms).

### 5.5 Recommendations

These cover `internal/`, which this run did not change.

1. **Keep `VECTOR_EF_SEARCH`=400.**
2. **Raise the default `VECTOR_EXACT_THRESHOLD` from 50,000 to 100,000.** Measured exact cost is about 0.29 ms per 1,000 real vectors: about 30 ms at 100k, still below the embedding call's p50 by an order of magnitude.
3. **Before tables reach millions of rows** (Phase 2 web crawling), move `emb_<profile>` tables to hash partitioning by `source_id`, with per-partition HNSW indexes and a pruning-friendly filter. This needs a vectorstore change and a migration plan (ADR-0007/0014). Build time on the laptop fell from 18 min to 2.5 min at 1.56M rows.
4. **Qdrant is not needed on current evidence.**

### 5.6 Remaining gate work

- **A real institutional corpus instead of FiQA,** at least 1M real chunks, measured on hardware sized like production. The largest real-vector table here was 1.56M rows, but only 57.6k of them were distinct real embeddings; the rest were derived from them.
- **Toward 20M rows:** measure build time and memory for partitioned tables on production hardware (`maintenance_work_mem` large enough for each partition's graph, and more `/dev/shm` for parallel builds).

### 5.7 Reproduce

```sh
# Real vectors + query vectors (see scale-10k.md §6 for ai.env and the throttle)
ragbench offline -gateway-url http://127.0.0.1:18090 -queries-out /tmp/ragbench/queries-prefix.jsonl \
    -export-dsn "$DSN" -export-table bench_fiqa_nomic
V="go run ./cmd/vecbench -dsn $DSN -real-table bench_fiqa_nomic -query-vectors /tmp/ragbench/queries-prefix.jsonl -maintenance-work-mem 900MB"
$V -filler 500000                                        # KB alone, then + 500k synthetic
$V -filler 500000 -filler-kind real -filler-cos 0.9      # + 500k near-duplicate
$V -filler 1500000 -filler-kind real -filler-cos 0.9 -keep -real-work-table vecbench_real_big
$V -real-reuse -real-rebuild -m 24 -ef-construction 128 -real-work-table vecbench_real_big -keep
$V -filler 1500000 -filler-kind real -filler-cos 0.9 -partitions 16
$V -filler 1500000 -filler-kind real -filler-cos 0.8
```

`-real-table` also accepts Grounded's own `emb_<profile>` tables. The working copy is a separate table, so Grounded's data is never modified.
