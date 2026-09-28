# Load tests

k6 scenarios for Grounded, run with the official `grafana/k6` image (pinned by digest in `run.sh`; nothing to install but Docker). Results and what they mean: [`docs/benchmarks/load.md`](../../docs/benchmarks/load.md).

```sh
make k8s-load                              # every scenario on a throwaway kind cluster
make k8s-load SCENARIOS="chat retrieve"  # or some of them
KEEP=1 make k8s-load SCENARIOS=chat       # keep the cluster; then REUSE=1 KUBECONFIG_FILE=<printed path>
```

`run.sh` builds the image from the working tree, creates a kind cluster (`grounded-load`) running [`deploy/kubernetes/test/load`](../kubernetes/test/load) (the example-small shape: 2 api and 2 worker replicas, single Postgres and Valkey, an S3 test server, plus `grounded demo --serve-fake-models`), installs metrics-server, waits for the demo's crawl, prepares the install, runs the scenarios, and deletes the cluster. Results go to `deploy/loadtest/results/<time>/` (ignored by git): `summary.md`, and per scenario the k6 log, summary JSON, a Markdown table and resource samples.

| Script | Scenario | Load | Thresholds (k6 `thresholds`) |
|---|---|---|---|
| `setup.js` | Prepares the install through the API as the development admin: team `load` with raised limits, an upload source with `SEED_DOCS` synthetic documents embedded by the fake gateway, an empty ingest source, a KB, a published agent, a personal and a service API key. Writes `results/install.json`. | once | |
| `chat.js` | (a) Agent chat over SSE with the fake model; 30% follow-ups in the same conversation | `LEVELS` concurrent users (25, 50, 100, 200), `HOLD` each | errors < 1% per level; time to first token p95 < `TTFT_P95_MS` (1500) up to `TARGET_CONCURRENCY` (100) |
| `retrieve.js` | (b) `POST .../kbs/{kb}/retrieve`, topK 10, service key | `LEVELS` requests/s (10, 25, 50, 100, 200) | errors < 1%; p95 < `RETRIEVE_P95_MS` (300) up to `RETRIEVE_P95_UP_TO` (50/s) |
| `openai.js` | (c) `POST /v1/chat/completions`, non-streaming, `agent:load/load` | `LEVELS` concurrent (10, 25, 50, 100) | errors < 1% |
| `ingest.js` | (d) Uploads (batches of `BATCH`, `UPLOADERS` in parallel) of `DOCS` documents, then documents/min until all are ready | 5,000 documents | upload errors < 1%, batch p95 < 10 s |
| `mixed.js` | (e) A day in the life at 2× the DESIGN §1 sizing, for `DURATION` (10m): 100 answers streaming at all times, 3 retrievals/s, 1 OpenAI completion/s, 100 uploaded documents/min, 10 page reads/s | see the script | per-traffic errors < 1%; TTFT p95 < 2 s, retrieve p95 < 500 ms, reads p95 < 300 ms, uploads p95 < 5 s |

A failed threshold is reported in the summary and does not stop the run.

**The fake model.** Every answer and embedding comes from the demo's fake gateway, so the figures measure Grounded, not a model. Its `DEMO_FAKE_WORD_DELAY` sets how long an answer streams: `CHAT_WORD_DELAY` (20 ms, about 3.5 s an answer) for `chat` and `openai`, `MIXED_WORD_DELAY` (80 ms, about 14 s, like the one-GPU model at home) for `mixed`, so the concurrency is real.

**Time to first token.** k6 cannot read a stream event by event, so `chat_ttft` is the time to the stream's first byte. Grounded holds every SSE event until the model starts answering, so that is the time to the first token (less one word delay). `run.sh` also prints the server's own `first_token_ms` and `latency_ms` from `message_events`.

**Limits.** `setup.js` raises the load team's limits (queries, tokens, concurrent chats, documents, storage) through the admin API, and `test/load` raises `REQUESTS_PER_MINUTE`, so no limit shapes a result. `concurrent_ingest_jobs` stays at the platform default unless `INGEST_JOBS` is set: it is one of the knobs the ingest run measures.

**Another install.** `TARGET=url BASE_URL=http://host.docker.internal:<port>` runs against an install you already have (it needs `DEV_AUTH`, `APP_HOST` set to its APP_URL host, and `grounded demo --serve-fake-models --fake-word-delay 20ms`; `PSQL` for the server-side figures). Never point it at an install people use, or at real models.
