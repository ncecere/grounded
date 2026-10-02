# Cross-encoder reranking

A rerank model (a cross-encoder such as bge-reranker or Qwen3-Reranker) reads the question together with each passage a search found and scores how well the passage answers it. That is more precise than the vector and keyword fusion, and it runs in one batched call. Once a platform admin chooses a rerank model, every search reranks: agents, a knowledge base's **Try it**, the retrieval API (`POST …/kbs/{kbId}/retrieve`) and the MCP server's `search` tool. Without a rerank model, retrieval is as before. The design is in [`v0.4.0.md` §3](../v0.4.0.md#3-cross-encoder-reranking-a1b).

## How a search uses it

1. The search fetches the platform's **candidate count** of passages (default 40; more when a search asks for more results, at most 50) and fuses them as usual.
2. The rerank model scores them in one `/rerank` call, bounded by the platform's **time limit** (default 2 s).
3. The best passages are kept:
   - **Agents** keep their **passages kept after reranking** (`rerankTopN`, default 6) for each search. With SystemOne passage judging on, SystemOne judges only those few instead of 10 to 20, so answers start sooner. Without judging, they go to the model.
   - **Try it, the retrieval API and MCP `search`** keep the number of results asked for (the knowledge base's top-k by default), each with its rerank score (`rerankScore`; the response's `rerank` says how the search was reranked).

**It fails open.** A rerank error or a call slower than the time limit keeps the usual fusion order, and the search goes on: an answer is never worse or much later than without reranking. The response's `rerank.status` (`timeout`, `error`) and the metrics show it.

**Classification.** Like every model, the rerank model may only read data up to its maximum classification (ADR-0006). A search over a knowledge base above it isn't reranked (`rerank.status` `skipped`); for an agent, that applies when any of its knowledge bases is above it.

## Deploying a reranker

Grounded calls `POST {base URL}/rerank` with the Cohere and Jina request shape, which LiteLLM, vLLM and SGLang accept:

```json
{"model": "bge-reranker-v2-m3", "query": "When does the library open?", "documents": ["…", "…"], "top_n": 6, "return_documents": false}
```

and reads `{"results": [{"index": 1, "relevance_score": 0.98}, …]}` (a `data` list, a `score` field and a bare list are accepted too). With a base URL ending in `/v1`, that is `/v1/rerank`.

- **vLLM** serves cross-encoders with `/rerank`, `/v1/rerank` and `/v2/rerank`, for example `vllm serve BAAI/bge-reranker-v2-m3`. Qwen3-Reranker needs vLLM's documented `--hf-overrides` for that model.
- **SGLang** serves `/v1/rerank` for reranker models; see its documentation for the launch flags of the model you choose.
- **LiteLLM** proxies `/rerank` and `/v1/rerank` to a provider that supports rerank (for example a vLLM server or a Cohere-compatible API); add the model to its `model_list` as its rerank documentation describes.
- **Hugging Face text embeddings inference** serves `/rerank` with `texts` instead of `documents` and returns a bare list: set the model's **Passages field** to `texts` (below).

A reranker is small: bge-reranker-v2-m3 scores 40 passages in a few hundred milliseconds on one GPU.

## Adding the model

1. **Admin → Models → Add model**, kind **Rerank**, on the connection that serves it. Set its **maximum classification** like any model's, and optionally **Max input tokens**: longer passages are shortened to fit with the question.
2. **Compatibility**, for servers that differ: **Passages field** (`documents`, the default, or `texts`) and **Accepts top_n** (sent by default; turn it off for a server that rejects it). The API fields are `compat.rerankDocumentsField` and `compat.supportsRerankTopN`.
3. **Test model** scores a passage that answers a fixed question and one that doesn't; the test passes when the first scores higher, and is stored as the model's health like other tests. The scheduled health check derives a rerank model's health from its connection's model list (`GET /models`), so it sends nothing to the reranker ([`health.md`](health.md)).
4. **Admin → Models → Reranking settings** (above the list): choose the rerank model, the candidate count (5 to 50) and the time limit (200 to 10,000 ms). Saving is audited (`platform.rerank_settings_update`, "Changed reranking settings", with the model by name and each value); the dialog checks each field before saving, and **Save settings** stays off until something changed (saving the same settings would start a new revision, which retires every saved answer). Auditors see the button disabled. The API is `GET` and `PUT /v1/admin/rerank` (platform admins; auditors read), and any signed-in user can read `GET /v1/rerank/status`.

A rerank model in use can't be deleted (choose **None** first; its record page says so beside the disabled **Delete**); a disabled model, or one on a disabled connection, turns reranking off until it is enabled again.

## For editors: the agent's setting

**Build → Advanced** shows **Rerank passages** (on by default) and **Passages kept after reranking** (1 to 20, default 6) once the platform has a rerank model. Turn reranking off for an agent whose knowledge base is small or already precise, or to compare. In **Try it** on a knowledge base, the **Rerank** switch compares the reranked order with the usual one (switching it searches again), and each passage shows its rerank score.

**Evaluations** rerank like searches do. To measure what reranking changes, start a run with **Rerank** turned off and compare it with a run with it on: the run's details say whether it reranked, and the score chart marks the change ([`evaluations.md`](evaluations.md)). For an agent's set, a reranked retrieval run keeps the agent's passages kept after reranking as its k.

## Costs, usage and monitoring

- Each answered rerank call records `rerank_requests` (1) and `rerank_tokens` usage events for the team (and agent), with the rerank model. Tokens are the server's count, or an estimate (the question with each passage, 4 characters per token) when it reports none. Rerank models are priced per million tokens and per request ([`costs.md`](costs.md)); spend reports show them as **Rerank**.
- Metrics: `grounded_rerank_requests_total{caller, status}` and `grounded_rerank_duration_seconds{caller}`, plus `grounded_model_requests_total{kind="rerank"}` per connection ([`monitoring.md`](monitoring.md)). The Chat and retrieval dashboard has a Reranking row.
- Traces: a `rerank` span (caller, candidates, status, passages kept) with the `rerank <model>` client span under it ([`tracing.md`](tracing.md)). Neither records the question or the passages.
