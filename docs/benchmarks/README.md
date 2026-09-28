# Benchmarks

| Report | What it measures |
|---|---|
| [`scale-10k.md`](scale-10k.md) | 10k-document ingest, retrieval quality, fusion tuning, ingest batching |
| [`vector-gate.md`](vector-gate.md) | The pgvector benchmark gate on real embeddings |
| [`boilerplate.md`](boilerplate.md) | Repeated-boilerplate suppression at ingest |
| [`spark-models.md`](spark-models.md) | Self-hosted embedding and chat models against a gateway's models |
| [`systemone.md`](systemone.md) | SystemOne passage judging, moderation, citation and scope checks |
| [`load.md`](load.md) | Load tests at 2× the sizing estimates on the Kubernetes shape, with the fake model (k6, [`deploy/loadtest`](../../deploy/loadtest/README.md)) |

The tools are [`cmd/ragbench`](../../cmd/ragbench), [`cmd/sparkbench`](../../cmd/sparkbench) and [`cmd/vecbench`](../../cmd/vecbench); run each with `-h`.

The reports were measured during Grounded's first test deployment, at a university, through that university's OpenAI-compatible AI gateway. They describe the gateway by its behaviour (request limits, token counts, latency), not by name.

## Evaluation data

**Published:** BEIR FiQA-2018 (download it as in [`scale-10k.md`](scale-10k.md) §6) and [`moderation-eval.jsonl`](moderation-eval.jsonl), a set of 60 labelled messages written for the project.

**Not published:** three sets built from a public university registrar website (58 pages). They contain a third party's site content and URLs, so they are kept outside the repository ([ADR-0023](../adr/0023-no-institution-data-in-the-repository.md)). The reports keep every number measured on them. To run the same evaluations on your own content, crawl a site into a KB and write sets in these formats (JSONL, one object per line):

- **URL-judged questions** (30 in the reports; `ragbench urlset -eval`, `sparkbench retrieval -set urlset -eval`, `sparkbench answer -eval`). Each question lists the page or pages that answer it; a hit counts as relevant when its page URL matches (trailing `/` ignored). Every URL must be a page of the KB.

  ```json
  {"id":"q01","question":"How do I drop a class after the deadline?","urls":["https://registrar.example.edu/registration/drop-add"]}
  ```

- **Citation claims** (34; `ragbench citations -eval`). A claim and the chunk it is checked against (page URL and chunk ordinal). `class` is `supported`, `paraphrase`, `contradicted` or `unsupported`.

  ```json
  {"id":"s01","class":"supported","claim":"Official transcripts cost $10.00 each.","url":"https://registrar.example.edu/transcripts","chunk":4}
  ```

- **Scope messages** (40; `ragbench scope -eval`), judged against the agent described in `cmd/ragbench/scope.go`. `group` is `small_talk`, `on_topic`, `borderline` or `off_topic`; `inScope` is `null` for borderline messages, where either answer is defensible.

  ```json
  {"id":"o01","group":"on_topic","text":"How do I order an official transcript?","smallTalk":false,"inScope":true}
  ```

Write questions the way people ask them, and judge them against the pages as crawled: a question whose answer isn't in the KB measures the crawl, not retrieval. With 30 questions, one question moving one rank changes nDCG@10 by about 0.01–0.03, so treat small differences as noise.
