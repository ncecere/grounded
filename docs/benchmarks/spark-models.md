# Self-hosted models on the DGX Spark vs an AI gateway (2026-09-26)

**Question:** should Grounded offer the owner's DGX Spark models as alternatives to the models of the university AI gateway used so far (an OpenAI-compatible, LiteLLM-based gateway; "the gateway" below)?

| role | Spark | gateway (current) |
|---|---|---|
| embeddings | `qwen3-embedding-4b` (vLLM) | `nomic-embed-text-v1.5` |
| chat | `qwen3.8-27b` (SGLang) | `gpt-oss-120b` |

**Short answer:**

- **Embeddings:** yes, offer `qwen3-embedding-4b` as a profile.
  - It is much better on FiQA (nDCG@10 **0.770 vs 0.527**) and at least as good on the registrar set (**0.964 vs 0.943**).
  - It needs its query instruction.
  - Truncated to 768 dimensions it loses almost nothing (0.767 / 0.960). That would keep nomic's storage and search cost, but Grounded can't do it yet (§4.2).
  - It should be vector-only or use a very small keyword weight.
- **Chat:** `qwen3.8-27b` answers the registrar questions as well as `gpt-oss-120b` (30/30 judged correct against 28/30). It works with Grounded's streaming and tool calling as is.
  - It is slow on this hardware: about 13 tokens/s per stream, and the server runs about 2 requests at a time.
  - With thinking on, a median answer takes **83 s**, against **2.2 s** through the gateway.
  - It is usable only as a **fallback or Restricted-data model with thinking disabled** (median 14 s, first text in 0.8 s). That needs one new compat flag.

Measured with [`cmd/sparkbench`](../../cmd/sparkbench) (`sparkbench -h`). Grounded itself was not changed.

> **Since then:** Grounded supports the changes §4 and §5 call for: profile output dimensions with client- or server-side Matryoshka truncation, fusion defaults per profile, a chat model's `extraBody`, top-level `usage.reasoning_tokens` and no blank text blocks (DESIGN.md §6 and §10; recipe in [`deployments/`](../deployments/README.md#self-hosted-models)).

## 1. Setup

- **Endpoints** (OpenAI-compatible; both Spark base URLs **need `/v1`**, and `GET /v1/models` works on both):
  - **Spark embeddings:** vLLM serving `Qwen/Qwen3-Embedding-4B`, `max_model_len` 32,768.
  - **Spark chat:** SGLang serving `qwen3.8-27b`, `max_model_len` 65,536.
  - **Gateway:** as in [`scale-10k.md`](scale-10k.md), with 120 requests/min per key. This run made **30 gateway calls**, all chat; the nomic query vectors came from ragbench's caches.
  - **SystemOne judge:** the owner's TypeSafe-compatible service (`openjev-0.1`).
- **Client:** an Apple M-series laptop reaching the Spark over the internet. Latency includes the network (about 0.1–0.2 s).
- **FiQA:** the 10,000-document BEIR FiQA KB of `scale-10k.md` (database `grounded_bench`): 10,653 chunks and 648 test queries.
  - nomic uses **Grounded's stored chunk vectors** and the stored query vectors (`search_query: `).
  - qwen3 embeds **the same chunks with the same text Grounded embeds**: `chunk.EmbedText(title, chunk)`, with no document prefix.
- **Registrar set:** a dev KB of a public university registrar website (58 pages, 376 chunks), with a 30-question set judged by page URL. It was read from the dev database, read-only. The question set is not published; its format is in [`README.md`](README.md#evaluation-data).
- **Scoring:** as in ragbench: BEIR nDCG@10, recall@10 and MRR@10 over documents (pages), with a chunk's document counted at its first occurrence.
  - Vectors are rounded to float16, like Grounded's `halfvec`.
  - Search is exact over 40 candidates (4 × k).
  - **Hybrid** is Grounded's fusion: `kbs.Fuse`, with keyword candidates from `kbs.LexicalSQL` (OR of lexemes, `ts_rank`) and weights vector 1 / keyword 0.1, the current defaults.
  - Sanity check: the nomic rows reproduce `ragbench sweep` (0.527 / 0.594 against 0.526 / 0.592 for vector only; 0.526 / 0.599 against 0.526 / 0.598 hybrid).

## 2. Embeddings

### 2.1 Endpoint

| check | result |
|---|---|
| dimensions | **2560**, L2-normalised |
| Matryoshka (`"dimensions": 1024` / `768`) | **rejected**: vLLM answers `400 … does not support Matryoshka embeddings`. The model supports it (32–2560 dims per the model card), but the server was started without it. Client-side truncation plus renormalisation works (§2.2). |
| maximum input | 32,768 tokens: 32,000 accepted (7 s); 40,000 rejected with a clear `400` |
| token counts | plausible (9 tokens for a 7-word query, 8,003 for an 8,000-word input), unlike the gateway's nomic counts, which are about 4.7× Grounded's (scale-10k §4) |
| single query (sequential, n=20) | **p50 151 ms, p95 162 ms**. Gateway nomic: p50 about 200 ms, p95 1.37 s (scale-10k §3). |
| throughput, batch 32 × 1 / batch 32 × 4 concurrent | 22 / **51 texts/s** (3.9k / 8.3k tokens/s, FiQA documents averaging about 170 tokens) |
| throughput, batch 64 × 1 / batch 64 × 4 | 22 / 42 texts/s: larger batches don't help |
| embedding 10,653 FiQA chunks (batch 32 × 4) | 7 min 10 s (**25 chunks/s**) while the chat model was also busy: the two share the GPU |

**Query format** (from the [model card](https://huggingface.co/Qwen/Qwen3-Embedding-4B)):
- Queries are `Instruct: {one-sentence task}\nQuery:{query}`. There is no space after `Query:` in the card's code; its TEI example has one.
- Documents get no instruction.
- The card reports a 1–5% loss without the instruction.
- The tasks used here:
  - *generic*: the card's example, "Given a web search query, retrieve relevant passages that answer the query";
  - *task-specific* for FiQA: MTEB's "Given a financial question, retrieve user replies that best answer the question";
  - *task-specific* for the registrar set: "Given a university student's question, retrieve passages from the university registrar's website that answer the question".

### 2.2 FiQA (10k documents, 648 queries)

| model | query format | dims | vector nDCG@10 | recall@10 | MRR@10 | hybrid wk=0.1 nDCG@10 | recall@10 | MRR@10 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| keyword only (Grounded's query) | | | 0.325 | 0.402 | 0.392 | | | |
| nomic-embed-text-v1.5 (Grounded's stored vectors) | `search_query: ` | 768 | 0.527 | 0.594 | 0.610 | 0.526 | 0.599 | 0.609 |
| qwen3-embedding-4b | none | 2560 | 0.675 | 0.758 | 0.735 | 0.662 | 0.760 | 0.719 |
| | generic instruction | 2560 | 0.738 | 0.813 | 0.801 | 0.692 | 0.804 | 0.742 |
| | **task instruction** | **2560** | **0.770** | **0.840** | **0.830** | 0.727 | 0.832 | 0.779 |
| | task instruction | 1024 (truncated) | 0.772 | 0.845 | 0.826 | 0.736 | 0.841 | 0.785 |
| | task instruction | 768 (truncated) | 0.767 | 0.842 | 0.823 | 0.733 | 0.841 | 0.780 |
| | none | 1024 / 768 | 0.670 / 0.664 | 0.748 / 0.745 | | 0.660 / 0.655 | | |
| | generic instruction | 1024 / 768 | 0.745 / 0.740 | 0.816 / 0.809 | | 0.704 / 0.700 | | |

Keyword weight with the task instruction, hybrid nDCG@10 (vector only: qwen3 0.770, nomic 0.527):

| keyword weight | 0.02 | 0.05 | 0.1 | 0.2 |
|---|---:|---:|---:|---:|
| qwen3, 2560 | 0.760 | 0.745 | 0.727 | 0.695 |
| nomic | 0.531 | 0.530 | 0.526 | 0.516 |

### 2.3 Registrar set (376 chunks, 30 questions)

| model | query format | dims | vector nDCG@10 | recall@10 | MRR@10 | hybrid wk=0.1 nDCG@10 | recall@10 | MRR@10 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| keyword only (Grounded's query) | | | 0.835 | 0.933 | 0.802 | | | |
| nomic-embed-text-v1.5 (Grounded's stored vectors) | `search_query: ` | 768 | 0.943 | 0.983 | 0.936 | 0.948 | 0.983 | 0.944 |
| qwen3-embedding-4b | none | 2560 | 0.925 | 1.000 | 0.900 | 0.953 | 1.000 | 0.944 |
| | generic instruction | 2560 | 0.952 | 1.000 | 0.940 | 0.956 | 1.000 | 0.942 |
| | **task instruction** | **2560** | **0.964** | **1.000** | **0.961** | 0.971 | 1.000 | 0.967 |
| | task instruction | 1024 / 768 | 0.964 / 0.960 | 1.000 / 1.000 | 0.961 / 0.957 | 0.964 / 0.945 | 1.000 / 1.000 | 0.950 / 0.925 |
| | none | 1024 / 768 | 0.906 / 0.898 | 1.000 / 1.000 | | 0.946 / 0.966 | | |

With 30 questions, one question moving one rank changes nDCG@10 by about 0.01–0.03. The registrar-set differences between the good rows are within that noise; the recall difference (1.000 against 0.983) is one question that nomic misses in the top 10. The keyword weight (0.02–0.2) moves qwen3's hybrid score between 0.945 and 0.984 without a trend.

### 2.4 Storage and search cost

`sparkbench storage` copied the FiQA KB's vectors into scratch tables in `grounded_bench`, shaped like Grounded's `emb_<profile>` tables: `halfvec`, storage `EXTERNAL`, a `source_id` btree, and HNSW with m=16 and ef_construction=64. It then ran Grounded's exact and HNSW queries over 200 queries (warm cache, one client).

| vectors (10,653) | dims | heap | TOAST | HNSW index | HNSW build | exact p50 / p95 | exact per 1k vectors | HNSW p50 / p95 (ef_search 400) | HNSW recall@10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| nomic | 768 | 17.0 MiB | 0 | 20.8 MiB | 0.8 s | 3.5 / 3.8 ms | **0.33 ms** | 4.7 / 5.5 ms | 0.999 |
| qwen3 | 2560 | 0.9 MiB | 60.2 MiB | 83.2 MiB | 5.6 s | 18.3 / 19.1 ms | **1.71 ms** | 6.7 / 8.5 ms | 1.000 |
| qwen3 (truncated) | 1024 | 0.9 MiB | 28.2 MiB | 27.8 MiB | 2.7 s | 12.6 / 16.3 ms | 1.18 ms | 5.1 / 13.3 ms | 1.000 |

- **Size.** A `halfvec(768)` row (1.5 KiB) stays in the heap. From 1024 dimensions up the row is over Postgres's 2 KB TOAST threshold, so every vector moves to TOAST.
  - Per 1M chunks: nomic ≈ **3.5 GiB** (table plus HNSW, matching the vector gate); qwen3-2560 ≈ **13 GiB** (3.8×); qwen3-1024 ≈ 5 GiB.
  - Each 2560-dim HNSW element (5 KiB) takes most of an 8 KiB page. The index is 4× nomic's, and it builds 7× slower (5.6 s against 0.8 s here). Extrapolated linearly, the vector gate's builds (4 s for 57.6k vectors, 18 min for 1.56M) would take about 30 s and about 2 hours, before any `maintenance_work_mem` spill.
- **Exact search is 5× slower per vector** at 2560 dimensions: 3.3× the arithmetic, plus a TOAST fetch per row. At the current `VECTOR_EXACT_THRESHOLD` of 50,000 that is about 85 ms instead of 16 ms, and about 170 ms at the proposed 100,000 (vector-gate §5.5). Even 1024 dimensions pays the TOAST cost (1.18 ms per 1k). Only dimensions up to about 980 stay inline.
- **HNSW latency barely changes** (4.7 → 6.7 ms), and recall stays at 0.999–1.000 on this KB.

## 3. Chat

### 3.1 Endpoint behaviour (`sparkbench chat-probe`, `sparkbench replay`)

Every stream below was also replayed through Grounded's own provider (`internal/llm.OpenAI`, default compat flags) with `sparkbench replay`. All parse into the expected thinking, text and tool-call blocks with the right stop reasons. Fixtures: `/tmp/sparkbench/fixtures/qwen3827b_{text,toolcall,toolresult}.sse` (not in the repo).

| check | qwen3.8-27b on SGLang | Grounded compat flag |
|---|---|---|
| streaming, `stream_options.include_usage` | usage arrives in a final chunk with `choices: []` | `supportsStreamUsage` true (default) |
| usage without `stream_options` | no usage at all | keep the default |
| reasoning | `delta.reasoning_content`; **thinking is on by default** (100–2,000 reasoning tokens per registrar answer) | `thinkingField` empty (auto) or `reasoning_content` |
| reasoning token count | top-level `usage.reasoning_tokens`, **not** `completion_tokens_details.reasoning_tokens`, so Grounded records 0 reasoning tokens (output tokens are still right) | **gap**, see §4 |
| answer text | starts with `"\n\n"`. Before a tool call the model streams a whitespace-only `"\n\n"` content delta, which Grounded keeps as a text block of its own. | **gap** (cosmetic), see §4 |
| tool calling (`search_knowledge` with Grounded's schema) | standard incremental `tool_calls` deltas: ID and name first, then argument fragments; `finish_reason: tool_calls`. Arguments are valid JSON, e.g. `{"query": "drop add deadline end date"}`. | `supportsTools` true |
| tool result turn (`role: tool`) | answers from the returned `<sources>` with `[1]` | — |
| `tool_choice: "required"` | **honoured**: small talk ("Hi! Thanks…") produced a `search_knowledge` call, while `auto` answered directly | `supportsToolChoice` **true**. vLLM with gpt-oss ignores it, which is why the default is false. |
| role `developer` | **rejected** (`400 Unexpected message role`) | `supportsDeveloperRole` false (default) |
| `max_tokens` / `max_completion_tokens` | both accepted. With 64 tokens the budget went entirely to reasoning: `finish_reason: length`, empty answer. | `maxTokensField` `max_tokens` (default). Don't set small output limits while thinking is on. |
| `reasoning_effort: "low"` | accepted without error. One sample used 21 reasoning tokens against 176 without it; not verified further. | leave `supportsReasoningEffort` false until verified |
| `chat_template_kwargs: {"enable_thinking": false}` | works: no reasoning, same answer, about 6× faster (median 14 s against 83 s, §3.2) | **gap**: Grounded can't send it, see §4 |
| context | `max_model_len` 65,536 | `contextWindow` 65536 |

### 3.2 Answer quality on the registrar set

**Method (`sparkbench answer`, then `sparkbench judge`):**
- **Retrieval.** For each of the 30 questions, the top 6 chunks come from an exact SQL search over the KB's stored nomic vectors, using the cached nomic question vector. The expected page was among the 6 for **30/30** questions, so the models were compared on the same, good context.
- **Prompt.** The model gets Grounded's system prompt for the published "Registrar assistant" agent (strict grounding, `[n]` citations, its refusal message and team instructions), then `<sources>…</sources>` and the question. This is a copy of `internal/agents.systemPrompt` and `formatSources`.
- **Request.** Streamed, with `max_tokens` 8192 and no temperature (Grounded's defaults).
- **Checks.** Citations and refusals are checked with Grounded's marker regex and `isRefusal`.
- **Judge.** SystemOne gets a `choice` question (`correct | partially | incorrect`) with the question, the answer (markers removed) and the expected page's full text.

| run | correct | partially | incorrect | mean P(correct) | refusals | cites the expected page | answers with citations | invalid citation numbers |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-oss-120b (gateway) | 28 | 1 | 1 | 0.94 | 1 | 29 | 29 | 0 |
| qwen3.8-27b, thinking on | **30** | 0 | 0 | 0.99 | 0 | 30 | 30 | 0 |
| qwen3.8-27b, thinking off | **30** | 0 | 0 | 0.99 | 0 | 30 | 30 | 0 |
| qwen3.8-27b, thinking on, 4 concurrent (12 questions) | 12 | 0 | 0 | 0.99 | 0 | 12 | 12 | 0 |

- **gpt-oss's two misses.**
  - **Question 23** ("How do I take a course pass/fail…"): it **refused**, although sources 1 and 2 were the S–U Grade Option PDF. Qwen explained the S–U option correctly in both modes.
  - **Question 25** ("…how long does a decision take?"): judged *partially*. It said the sources don't give a timeframe. The qwen answers were judged correct, but only at 0.51–0.58 confidence.
- **The set is close to saturated.** Retrieval always found the page, and most questions are single-fact lookups. It shows that qwen3.8-27b is not worse at grounded answering; it can't separate two good models. SystemOne's confidence was below 0.8 only on questions 1 and 25, for every model.

| run | first token p50 / p95 | first answer text p50 / p95 | total p50 / p95 | output tokens (mean) | reasoning tokens (mean) |
|---|---:|---:|---:|---:|---:|
| gpt-oss-120b (gateway) | 0.4 / 7.2 s | **1.4 / 8.0 s** | **2.2 / 9.1 s** | 372 | 155 |
| qwen3.8-27b, thinking on | 1.5 / 2.1 s | 67 / 288 s | 83 / 331 s | 907 | 738 |
| qwen3.8-27b, thinking off | 0.8 / 1.3 s | **0.8 / 1.3 s** | **14 / 38 s** | 226 | 0 |

- "First token" includes reasoning deltas, which Grounded shows in a collapsed panel.
- The thinking-on run was slowed by other load on the Spark: it decoded at 6–7 tokens/s until 20:25 and at 12–13 tokens/s afterwards. Unloaded, expect about half the times shown.
- gpt-oss decodes at about **230 tokens/s** per stream through the gateway.

### 3.3 Throughput on the Spark

| load | per-stream decode | aggregate | notes |
|---|---:|---:|---:|
| 1 stream (thinking off, 30 answers) | 13.1 tokens/s | 12.5 tokens/s | stable 13.0–13.5 |
| 4 concurrent, thinking on (12 answers) | 12.5 tokens/s | **22.6 tokens/s** | on average only **1.8** streams were decoding; the others waited 11–61 s for a first token |
| 4 concurrent, thinking off (8 answers) | 12.7 tokens/s | 21.3 tokens/s | 2 requests got a first token at 1.2 s; the others queued for 7–15 s |

**The Spark serves about 2 chat requests at a time, at about 13 tokens/s each.** That is about 22 tokens/s in total, roughly 1,300 output tokens a minute.
- With thinking on (about 900 output tokens per answer) that is about **1.5 answers a minute**; with thinking off (about 230 tokens) about **6 a minute**.
- The embedding model shares the GPU: ingest and chat slow each other (§2.1).
- None of the roughly 95 Spark chat requests (80 answers plus the probes) failed.

## 4. What we learned

1. **qwen3-embedding-4b is the better retriever.**
   - On FiQA it is +0.24 nDCG@10 over nomic (+46%), with recall@10 0.84 against 0.59. That is larger than any fusion or prefix change measured so far.
   - Part of it may be training data: the Qwen3 Embedding report lists its supervised sets as "MS MARCO, NQ, HotpotQA, … etc.", which neither includes nor excludes FiQA.
   - On the registrar pages, which no public model has trained on, it is at least as good as nomic (0.964 against 0.943) and finds every expected page in the top 10.
2. **Its query instruction matters, much more than nomic's prefixes do.**
   - Without an instruction qwen3 loses 0.095 nDCG@10 on FiQA and 0.039 on the registrar set.
   - The card's generic instruction recovers most of that; a task-specific one is best.
   - In Grounded the instruction is just the profile's query prefix, `Instruct: <task>\nQuery:` (under the 200-character limit, newline included), with an empty document prefix. No code change is needed.
3. **Matryoshka truncation to 768 costs nothing measurable** (FiQA 0.767 against 0.770; registrar 0.960 against 0.964), and 768 dimensions keeps nomic's storage and exact-search cost. At full 2560 dimensions, exact search is 5× slower per vector and storage about 3.8×, because the vectors move to TOAST.
4. **Grounded's default keyword weight (0.1) hurts a strong embedder.** On FiQA, qwen3 loses 0.043 nDCG@10 with keyword weight 0.1 and 0.010 even at 0.02; nomic is flat. On the registrar set, fusion is neutral within noise for both. The fusion default was tuned for nomic.
5. **qwen3.8-27b is a competent grounded answerer but a slow one here.**
   - Citations were always valid and pointed at the expected page, with no unwarranted refusals, and it followed "S–U" where gpt-oss refused.
   - Its protocol behaviour is clean: standard tool calls, a `tool_choice` that works, and `reasoning_content`.
   - Thinking is on by default and makes answers take minutes on the Spark's about 13 tokens/s × 2 slots. With thinking off, answers are as good on this set, start in under a second and finish in about 14 s.
6. **Embedding cost and latency favour the Spark.** It has no request cap, predictable single-query latency (151 ms p50, 162 ms p95) and honest token counts. Batch throughput is about 50 texts/s, below the gateway's best batched rate, and the Spark is shared with chat.

## 5. Recommendations

**Embeddings: offer a `qwen3-embedding-4b` profile.**
- **Model:** connection `https://embed.example.net/v1`, dimensions 2560, `maxInputTokens` 32768.
- **Profile:**
  - document prefix: empty;
  - query prefix: `Instruct: Given a university student's question, retrieve passages from the university's web pages that answer the question\nQuery:`, or the card's generic web-search instruction for mixed content;
  - `halfvec`, chunk size 512 with 64 overlap (unchanged).
- **Documentation.** The admin docs for this model should say that the query prefix is required, and give the template. This is a second model family, after nomic, where an empty prefix silently costs quality (scale-10k recommendation 4).
- **Fusion.** Set the KB's `fusionWeights` to vector-only (keyword 0) or at most 0.02 for KBs on this profile. Better still, make the default keyword weight a property of the profile rather than one platform number. Re-tune on a larger institutional question set.
- **Prefer 768 dimensions over 2560.** There is no measurable quality loss, and storage and exact search stay at nomic's cost. Grounded needs one of:
  - a model setting to send `dimensions` on `/embeddings`, with the Spark's vLLM started with Matryoshka enabled (for example `--hf-overrides '{"is_matryoshka": true}'`); or
  - client-side truncation and renormalisation when a profile's dimensions are below the model's.

  Either way the profile's dimensions would no longer always equal the model's. Until then, a 2560-dim profile works; it is 3.8× the storage and 5× the exact-search cost. At that size, lower `VECTOR_EXACT_THRESHOLD` for 2560-dim profiles to about 20k (about 35 ms), or make the threshold depend on dimensions.
- **Classification.** The Spark is self-hosted, so it is a candidate model for Restricted data (DESIGN §10), subject to the install's policy.

**Chat: don't make `qwen3.8-27b` the default while it runs on one Spark.**
- Use it as a **fallback** when the gateway is unavailable, and as the **model for Restricted-data agents**, with thinking **off**.
- Expect about 2 concurrent answers and 13 tokens/s each. Set the connection's concurrency limit to 2 so extra requests queue in Grounded rather than on the GPU.
- **Model settings:** `supportsTools` true, `contextWindow` 65536, `maxOutputTokens` 8192.
- **Compat flags:** `supportsToolChoice` **true**, `supportsDeveloperRole` false, `supportsStreamUsage` true, `maxTokensField` `max_tokens`, `thinkingField` `reasoning_content` or auto, `supportsReasoningEffort` false.
- **Grounded changes this model needs (small, in `internal/llm`):**
  1. **An "extra body" or "disable thinking" compat option** that merges fixed JSON into every chat request, here `{"chat_template_kwargs": {"enable_thinking": false}}`. Without it the model always thinks: answers take 1–5 minutes, and small `max_tokens` values produce empty answers.
  2. **Read `usage.reasoning_tokens` at the top level** (SGLang) as well as `completion_tokens_details.reasoning_tokens`, so the ledger's reasoning counts aren't 0.
  3. **Drop whitespace-only text blocks, and trim leading whitespace from the first text block.** Qwen streams `"\n\n"` before answers and tool calls.

  Record `qwen3827b_*.sse` from `/tmp/sparkbench/fixtures` as `internal/llm/testdata` fixtures when these are implemented.
- **Revisit** if the Spark gets a second GPU or a faster serving setup, such as a quantised or speculative-decoding deployment. The quality is there; only the speed is missing.

## 6. Reproduce

```sh
set -a && . ./ai.env && set +a            # gateway, Spark and SystemOne endpoints (never printed)
go build -o /tmp/sparkbench/sparkbench ./cmd/sparkbench
S=/tmp/sparkbench/sparkbench
$S embed-probe -n 512                      # dims, Matryoshka, max input, latency, throughput
$S retrieval -set fiqa                     # needs grounded_bench (scale-10k.md) and /tmp/ragbench caches
EVAL=questions.jsonl KB="Registrar help" AGENT="Registrar assistant"   # your own URL-judged set, KB and agent
$S retrieval -set urlset -eval $EVAL -kb-name "$KB"   # dev database
$S retrieval -set fiqa -query-formats set -dims 0,768 -keyword-weight 0.02
$S storage                                 # scratch tables in grounded_bench, dropped afterwards
$S chat-probe                              # records /tmp/sparkbench/fixtures/*.sse
$S replay /tmp/sparkbench/fixtures/*.sse   # parse them with Grounded's internal/llm
answer() { $S answer -eval "$EVAL" -kb-name "$KB" -agent "$AGENT" -org "Example University" "$@"; }
answer -endpoint gateway-chat -rpm 30     # 30 gateway calls
answer -endpoint spark-chat
answer -endpoint spark-chat -extra '{"chat_template_kwargs":{"enable_thinking":false}}' -out /tmp/sparkbench/answers-spark-nothink.jsonl
answer -endpoint spark-chat -concurrency 4 -limit 12 -out /tmp/sparkbench/answers-spark-conc4.jsonl
$S judge -kb-name "$KB" -in /tmp/sparkbench/answers-gateway-chat.jsonl,/tmp/sparkbench/answers-spark-chat.jsonl,/tmp/sparkbench/answers-spark-nothink.jsonl
```

qwen3 vectors are cached in `/tmp/sparkbench/cache`, so re-runs only embed what changed. Answers and verdicts are JSONL in `/tmp/sparkbench/`. Never commit them or `ai.env`.
