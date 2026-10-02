# Monitoring: metrics, dashboards, alerts and SLOs

Grounded exposes Prometheus metrics, ships five Grafana dashboards and a set of Prometheus alerting rules. They work with any Prometheus-compatible stack: Prometheus, Mimir, Cortex or Thanos, with Grafana on top. This page covers what's measured, how to load the dashboards and rules, and the objectives behind the alerts. The runbook for each alert is in [`alerts.md`](alerts.md).

| What | Where |
|---|---|
| Metrics | `GET /metrics` on the API's internal `METRICS_ADDR` listener (`:9091` in Kubernetes; not on the port the Ingress serves) and the worker (`WORKER_HTTP_ADDR`, `:9090`). With `METRICS_ADDR` empty (local `serve`), `/metrics` is on `HTTP_ADDR` |
| Dashboards | [`deploy/observability/dashboards/`](../../deploy/observability/dashboards) (Grafana JSON, schema 39) |
| Alert and recording rules | [`deploy/observability/alerts/grounded.rules.yaml`](../../deploy/observability/alerts/grounded.rules.yaml), with unit tests in `grounded.rules.test.yaml` |
| Kubernetes components | `monitoring` or `monitoring-annotations` (scraping), `alerts` (PrometheusRule), `dashboards` (Grafana sidecar ConfigMaps) |
| Logs | JSON on stdout (`LOG_FORMAT=json`), one line per request with `route`, `status`, `duration_ms` and `request_id` (and `trace_id`, `span_id` when the request is traced) |
| Traces | OpenTelemetry over OTLP, off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set: [`tracing.md`](tracing.md) |

## Scraping

Scrape the API and worker pods (see [`kubernetes.md`, Monitoring](../deployments/kubernetes.md#monitoring)):

- **Prometheus Operator:** `components/monitoring` (a ServiceMonitor for the `metrics` ports).
- **Anything else** (Prometheus pod discovery, Grafana Alloy, the OpenTelemetry Collector): `components/monitoring-annotations` (`prometheus.io/scrape`, `port`, `path`).

The dashboards and rules group by the `namespace` label, which both set up. Compose and other installs without it still work: the label is simply empty. Scrape every 15 to 60 seconds; the rules assume at least one sample a minute.

## Metrics reference

Labels are bounded by design: route patterns (never raw paths), channels, kinds, outcomes and connection names an admin chose. No metric carries a team, user, agent, document or conversation ID. Histograms have the usual `_bucket`, `_sum` and `_count` series. The Go runtime (`go_*`) and process (`process_*`) collectors are included too.

### HTTP

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_http_requests_total` | counter | `group`, `method`, `route`, `status` | `route` is the matched pattern, such as `GET /v1/teams/{team}/agents`; unmatched paths are `unmatched`. A request whose client went away before it failed (a page reload, a closed tab) is `499`, logged at info as `client closed request`, so it stays out of the 5xx series and the error objective |
| `grounded_http_request_duration_seconds` | histogram | `group`, `method`, `route` | For streamed chat, the whole stream |
| `grounded_http_requests_in_flight` | gauge | | Includes open chat streams |
| `grounded_ratelimit_backend_errors_total` | counter | | Rate-limit checks that failed open because Valkey was unavailable |

Route groups (`group`): `ops` (`/healthz`, `/readyz`, `/metrics`), `chat` (streamed answers: agent chat, public chat, `POST /v1/chat/completions`, editors' test chat), `public` (public pages and the widget), `openai` (`GET /v1/models`), `mcp` (`/mcp`, the MCP server; like `chat`, outside the latency objective, as an `ask` lasts as long as its answer), `admin` (`/v1/admin/…`), `auth` (sign-in and `/v1/me…`), `api` (the rest of `/v1`), `ui` (the web app) and `unmatched`.

### Chat, retrieval and checks

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_chat_answers_total` | counter | `channel`, `outcome` | Channels: `ui`, `api`, `openai`, `public`, `widget`, `mcp` (the MCP server's `ask`), `test` (editors' drafts). Outcomes: `ok`, `no_answer` (refused, or nothing to answer from), `moderated`, `model_busy`, `aborted` (the caller went away), `error` |
| `grounded_chat_first_token_seconds` | histogram | `channel` | Question to the first streamed token (absent when nothing streamed) |
| `grounded_chat_duration_seconds` | histogram | `channel` | Question to the end of the answer (before a streamed answer's citation check) |
| `grounded_retrieval_duration_seconds` | histogram | `outcome` (`ok`, `error`) | One hybrid search over one knowledge base, including the query embedding |
| `grounded_systemone_requests_total` | counter | `feature`, `outcome` | Features: `moderation`, `judging`, `citations`, `scope`, `test`. Outcomes: `ok`, `timeout`, `error` |
| `grounded_systemone_request_duration_seconds` | histogram | `feature` | After a concurrency slot is free |
| `grounded_rerank_requests_total` | counter | `caller`, `status` | Rerank calls of searches ([`rerank.md`](rerank.md)). Callers: `agent`, `retrieve` (Try it, the retrieval API, MCP `search`), `evaluation`. Statuses: `ok`, `timeout` and `error` (the search kept the fusion order), `skipped` (the rerank model may not read the knowledge base's classification; nothing was sent) |
| `grounded_rerank_duration_seconds` | histogram | `caller` | Bounded by the platform's rerank time limit |
| `grounded_moderation_decisions_total` | counter | `stage` (`input`, `output`), `decision` | Decisions: `pass`, `flag`, `block`, `support`, `error` (the provider failed; the policy decides whether that blocks) |
| `grounded_moderation_first_release_seconds` | histogram | `channel` | Answers streamed in checked paragraphs ([`../moderation-streaming.md`](../moderation-streaming.md)): question to the first paragraph shown |
| `grounded_moderation_paragraph_checks_total` | counter | `decision` | Their checks, one per paragraph (of the answer so far); also counted in `grounded_moderation_decisions_total` |
| `grounded_mcp_tool_calls_total` | counter | `tool` (`search`, `ask`), `outcome` | The MCP server's tool calls ([`../mcp.md`](../mcp.md)). Outcomes: `ok`, `refused` (a limit, a budget, a classification rule), `error` |
| `grounded_mcp_client_calls_total` | counter | `server`, `tool`, `outcome` | Agents' calls to approved MCP server tools ([`../mcp-client.md`](../mcp-client.md)). Outcomes: `ok`, `tool_error`, `refused`, `timeout`, `too_large`, `error`. Server and tool names are bounded by what admins register and approve |
| `grounded_mcp_client_call_duration_seconds` | histogram | `server`, `tool` | Latency of those calls |

### Model connections

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_model_requests_total` | counter | `connection`, `kind`, `outcome` | `connection` is the connection's name in Administration → Models; `kind` the model kind (`chat`, `embedding`, `rerank`, `moderation`, `systemone`, `vision`). Outcomes: `ok`, `rate_limited` (HTTP 429, or 503 with Retry-After), `throttled` (the connection's own requests-per-minute limit held it back; never sent), `unavailable` (network, timeout, 5xx), `auth`, `not_found`, `bad_request`, `bad_response`, `canceled` |
| `grounded_model_request_duration_seconds` | histogram | `connection`, `kind` | To the response; for streams, to the response headers. Throttled requests aren't timed |

Admin **Test connection** and **Test model** calls, the scheduled health check and `grounded doctor` probes aren't counted. Renaming a connection starts new series.

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_health_checks_total` | counter | `kind` (`connection`, `model`, `mcp_server`), `trigger` (`manual`, `scheduled`), `status` (`healthy`, `failing`) | Stored health checks ([`health.md`](health.md)) |
| `grounded_health_check_duration_seconds` | histogram | `kind` | The latency of the test behind a stored check |
| `grounded_gap_questions_total` | counter | `signal` (`no_context`, `refused`, `judged_out`, `out_of_scope`, `unsupported`, `uncited`, `thumbs_down`) | Failed questions kept for the gap report ([`../gaps.md`](../gaps.md)) |
| `grounded_gap_topic_changes_total` | counter | `kind` (`embedded`, `assigned`, `new_topic`, `reopened`, `resolved`, `labelled`, `pruned`) | The hourly `gaps.topics` job's work |
| `grounded_answer_cache_lookups_total` | counter | `result` (`hit`, `miss`), `reason` (`exact`, `near`; `no_entry`, `near_rejected`, `follow_up`, `error`) | Answer cache lookups of agents with saved answers on ([`../answer-cache.md`](../answer-cache.md)) |
| `grounded_answer_cache_tokens_saved_total` | counter | | Model tokens the originals of reused answers spent |

### Ingestion, crawling and jobs

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_ingest_documents_total` | counter | `outcome` | `indexed`, `failed`, `skipped` (empty, needs OCR), `retried` (a transient failure), `deferred` (the embedding model's backpressure; snoozed), `parked` (maintenance mode), `superseded` (a newer version or a new embedding profile replaced it while processing) |
| `grounded_ingest_document_duration_seconds` | histogram | | Parse, chunk, embed and index one document |
| `grounded_embedding_batch_inputs` | histogram | | Inputs per embedding request sent by ingestion |
| `grounded_crawl_pages_total` | counter | `result` (`done`, `failed`, `skipped`) | Crawled frontier URLs |
| `grounded_crawl_fetch_duration_seconds` | histogram | | One page fetch |
| `grounded_jobs_worked_total` | counter | `kind`, `outcome` | River jobs by kind (`ingest.document`, `web.crawl`, `retention.run`, …); outcomes `ok`, `error`, `snoozed`, `cancelled`, `panic` |
| `grounded_job_duration_seconds` | histogram | `kind` | |

### Install state (read from Postgres at scrape time)

The worker and `serve` processes read these from Postgres when scraped (cached for 10 seconds, 5-second timeout). Every worker reports the same values, so aggregate them with `max`. API processes don't register them.

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_jobs` | gauge | `kind`, `state` | River jobs in `available`, `running`, `retryable`, `scheduled` and `discarded` |
| `grounded_jobs_oldest_available_age_seconds` | gauge | `kind` | How long the oldest job ready to run has waited |
| `grounded_jobs_oldest_running_age_seconds` | gauge | `kind` | How long the longest-running job has run |
| `grounded_maintenance_mode` | gauge | | 1 while maintenance mode is on |
| `grounded_maintenance_mode_started_timestamp_seconds` | gauge | | When it was turned on; absent while off |
| `grounded_breakglass_open_sessions` | gauge | `status` (`active`, `pending`) | |
| `grounded_answer_cache_entries` | gauge | | Saved answers that haven't expired ([`../answer-cache.md`](../answer-cache.md)) |
| `grounded_health_failing` | gauge | `kind` (`connection`, `model`, `mcp_server`) | Enabled subjects whose latest stored health check failed ([`health.md`](health.md)) |
| `grounded_health_failing_seconds` | gauge | `kind`, `name` | How long each failing enabled connection, model or MCP server has been failing (by its name); absent while healthy |
| `grounded_state_up` | gauge | | 0 when the last read failed (the others are then absent) |

### Governance

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_retention_deleted_total` | counter | `kind` | Rows (or stored-file prefixes) deleted by retention |
| `grounded_retention_held` | gauge | `kind` | Rows past their period kept by a legal hold, at the last run |
| `grounded_retention_errors_total` | counter | `kind` | |
| `grounded_retention_last_success_timestamp_seconds` | gauge | `kind` | |
| `grounded_retention_run_duration_seconds` | histogram | | |
| `grounded_breakglass_sessions_total` | counter | `status` | Transitions by the status reached: `pending`, `active`, `ended`, `cancelled`, `denied`, `expired`, `request_expired` |
| `grounded_breakglass_reads_total` | counter | `kind` | Audited reads (`conversation`, `document`, `passages`, …) |

### Process and dependencies

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_build_info` | gauge | `version`, `commit`, `goversion`, `mode` | Always 1; `mode` is `serve`, `api` or `worker` |
| `grounded_db_pool_acquired_connections`, `_idle_connections`, `_constructing_connections`, `_connections`, `_max_connections` | gauge | | This process's Postgres pool. The limit is `pool_max_conns` in `DATABASE_URL` |
| `grounded_db_pool_acquires_total`, `_empty_acquires_total`, `_canceled_acquires_total` | counter | | `empty`: had to wait for a connection |
| `grounded_db_pool_acquire_wait_seconds_total` | counter | | Time spent acquiring |
| `grounded_valkey_errors_total` | counter | `command` | Failed commands and dials (`dial`); a missing key isn't an error |

## Dashboards

| Dashboard (uid) | Shows |
|---|---|
| **Grounded / Overview** (`grounded-overview`) | The SLOs over the time range and the 30-day error budgets, burn rates, instances up, maintenance mode, the queue, active break-glass sessions, firing Grounded alerts, chat outcomes, failing model requests and job failures |
| **Grounded / API** (`grounded-api`) | Traffic, errors and latency by route group, the slowest and most failing routes, requests in flight, the Postgres pool, Valkey errors, break-glass reads, CPU, memory, goroutines and versions |
| **Grounded / Chat & retrieval** (`grounded-chat`) | Answers by channel and outcome, time to first token and answer time by channel, retrieval latency and errors, SystemOne latency by feature |
| **Grounded / Ingest & jobs** (`grounded-ingest`) | The River queue (depth, oldest waiting and running job, failures, run time, discarded jobs), documents by outcome, embedding batch sizes, crawled pages, maintenance mode, break-glass and retention |
| **Grounded / Models & moderation** (`grounded-models`) | Requests, failures, 429s and latency per connection and model kind, SystemOne, moderation decisions and block rates, and the time to the first checked paragraph |

Every dashboard picks its data source through the `DS_PROMETHEUS` variable (any Prometheus-type data source, Mimir included), filters by `namespace`, and links to the others. Nothing is hard-coded, so they import into any Grafana 10.4 or later.

### Loading them into Grafana

- **By hand:** Dashboards → New → Import, and upload a JSON file.
- **Grafana dashboard sidecar** (the `grafana` and `kube-prometheus-stack` Helm charts' `sidecar.dashboards`): add `components/dashboards` to the overlay. It creates one ConfigMap per dashboard with the label `grafana_dashboard: "1"` and the annotation `grafana_folder: Grounded`. The sidecar must watch Grounded's namespace (`sidecar.dashboards.searchNamespace: ALL`, or the namespace), and it files them in a folder only when `sidecar.dashboards.folderAnnotation` is `grafana_folder`. With Flux or Argo CD, this is how the dashboards stay in Git.
- **File provisioning** without the sidecar: mount the JSON files where a [dashboard provider](https://grafana.com/docs/grafana/latest/administration/provisioning/#dashboards) points, for example from the same ConfigMaps.
- **Grafana Operator:** a `GrafanaDashboard` per file, with `configMapRef` to the ConfigMaps of `components/dashboards`, or `url` to a pinned raw file.

After loading, pick the data source in the `Data source` drop-down if the default isn't the one with Grounded's metrics.

## Alerts

The rule file has four groups of alerts, plus recording rules for the SLO ratios (`grounded:http_errors:ratio_rate<window>`, `grounded:http_slow:ratio_rate<window>`, `grounded:http_requests:rate5m` and `rate1h`):

| Alert | Severity | Fires when |
|---|---|---|
| `GroundedAPIErrorBudgetBurn` | critical | 5xx burn the 99.9% budget 14.4× (1 h and 5 min) or 6× (6 h and 30 min) too fast |
| `GroundedAPIErrorBudgetBurnSlow` | warning | 3× (1 day and 2 h) or 1× (3 days and 6 h) |
| `GroundedAPILatencyBudgetBurn` | critical | Requests over 1 s burn the 5% latency budget 14.4× or 6× too fast |
| `GroundedAPILatencyBudgetBurnSlow` | warning | 3× or 1× |
| `GroundedAPIDown` | critical | No `api` or `serve` process scraped for 5 min |
| `GroundedWorkerDown` | critical | No `worker` or `serve` process scraped for 10 min |
| `GroundedChatAnswersFailing` | warning | Over 10% of answers end in an error for 10 min |
| `GroundedJobsFailing` | warning | Over 25% of a job kind fails (at least 3) for 15 min |
| `GroundedJobsDiscarded` | warning | A job kind failed every attempt in the last hour |
| `GroundedJobStuck` | warning | A job has run for over an hour |
| `GroundedQueueBacklog` | warning | A ready job has waited over 15 min |
| `GroundedStateUnreadable` | warning | A worker can't read the queue state for 10 min |
| `GroundedRetentionFailing` | warning | A retention kind failed in the last hour |
| `GroundedRetentionStale` | warning | A retention kind hasn't completed in 3 hours |
| `GroundedMaintenanceModeLong` | warning | Maintenance mode on for over 4 hours |
| `GroundedModelConnectionFailing` | critical | Over half of a connection's requests (one model kind, at least 5) fail for 10 min, 429s aside |
| `GroundedModelConnectionRateLimited` | warning | Over 20% refused by 429 or the connection's own limit for 30 min |
| `GroundedHealthCheckFailing` | warning | An enabled connection, model or MCP server has failed every stored health check for over 30 min |
| `GroundedDBPoolSaturated` | warning | A process uses over 90% of its Postgres pool for 10 min |
| `GroundedValkeyErrors` | warning | More than one Valkey error every 10 s for 10 min |
| `GroundedBackupMissing` | critical | The `grounded-postgres-backup` CronJob hasn't succeeded for 26 h (kube-state-metrics) |
| `GroundedBackupJobFailed` | warning | A backup Job failed (kube-state-metrics) |
| `GroundedVolumeFillingUp` | warning | A Grounded PVC is over 85% full (kubelet) |
| `GroundedVolumeFull` | critical | Over 95% full, or full within 24 h at the 6-hour trend (kubelet) |

Every alert carries `severity`, `service: grounded`, a `summary`, a `description` and a `runbook_url` to its section of [`alerts.md`](alerts.md). Route on `severity` in Alertmanager or Grafana notification policies.

**Dependencies.** The backup alerts need [kube-state-metrics](https://github.com/kubernetes/kube-state-metrics) (`kube_cronjob_status_last_successful_time`, `kube_job_status_failed`); the volume alerts need the kubelet's volume stats (`kubelet_volume_stats_*`, scraped by kube-prometheus-stack and by Alloy's Kubernetes integrations). Without them those alerts stay silent. They match the claims Grounded's components create (`.*grounded.*`); adjust the selector if an overlay renames them. A CloudNativePG install backs up through its ScheduledBackup, not the CronJob: alert on its backup plugin's metrics instead. Certificate expiry is left to the ingress controller or cert-manager's own alerts.

`GroundedAPIDown` and `GroundedWorkerDown` use `absent()`, which doesn't know about namespaces: with several installs in one Prometheus, copy them per install with a `namespace` matcher.

### Loading the rules

- **Prometheus:** list `grounded.rules.yaml` under `rule_files`.
- **Prometheus Operator:** add `components/alerts` to the overlay: a `PrometheusRule` named `grounded`, generated from the rule file. Add the label your Prometheus's `ruleSelector` expects.
- **Mimir or Cortex ruler with Grafana Alloy:** Alloy's [`mimir.rules.kubernetes`](https://grafana.com/docs/alloy/latest/reference/components/mimir/mimir.rules.kubernetes/) component loads `PrometheusRule` resources into the Mimir ruler. Add `components/alerts` (the `PrometheusRule` CRD must be installed, for example from the `prometheus-operator-crds` chart; the Operator itself isn't needed). With Flux, the rules then live in Git with the rest of the install.
- **Mimir without Alloy:** [`mimirtool`](https://grafana.com/docs/mimir/latest/manage/tools/mimirtool/) loads a rule file into a namespace of the ruler:
  ```sh
  mimirtool rules load --address=https://mimir.example.org --id=<tenant> \
    <(printf 'namespace: grounded\n'; cat deploy/observability/alerts/grounded.rules.yaml)
  ```
  or post each group to the ruler API (`POST /prometheus/config/v1/rules/grounded`, one group per request, YAML body). Mimir's alerts then go to its Alertmanager, and Grafana shows them as data-source-managed rules.
- **Grafana-managed alerting only:** Grafana can't import a Prometheus rule file as Grafana-managed rules directly. Load the file into the data source's ruler (above), or recreate the alerts you need in Grafana using the expressions from the file.

Changing the rules: edit `grounded.rules.yaml` (and its tests), run `make obs-generate` to rewrite `components/alerts` and `components/dashboards`, then `make obs-validate`.

## Service level objectives

DESIGN §15 targets 99.9% availability. The rules measure it at the API:

| SLO | SLI | Objective | Budget over 30 days |
|---|---|---|---|
| Availability | Share of API requests (group `ops` excluded) that don't fail with 5xx | 99.9% | 0.1% of requests (about 43 minutes of full outage) |
| Latency | Share of non-streaming API requests (groups `ops`, `chat` and `mcp` excluded) that finish within 1 s | 95% (so p95 under 1 s) | 5% of requests |

The Overview dashboard shows both over the chosen time range, and the budget left over 30 days.

- **Burn-rate alerts** follow the multi-window, multi-burn-rate method of the Google SRE workbook: a fast burn (14.4× over 1 h and 5 min, or 6× over 6 h and 30 min) pages; a slow burn (3× over 1 day and 2 h, or 1× over 3 days and 6 h) warns. Both need at least one request a minute, so a single error on an idle install doesn't page.
- **Streamed chat and the MCP server** are outside the latency SLO (an MCP `ask` returns when its answer is complete). Its speed depends mostly on the chat model; the dashboards show time to first token and answer time per channel. Answers that fail after streaming started get an HTTP 200, so they're covered by `GroundedChatAnswersFailing`, not the availability SLO.
- **Intentional 503s count.** Uploads and crawls refused during maintenance mode are 5xx. Planned maintenance spends budget; keep it short.
- **Dependencies** bound the SLO (DESIGN §15): the model gateway, the OIDC provider and SMTP. Model connection health has its own alerts. A single-Postgres install (like the home install) can't meet 99.9% through node or storage failures; the HA overlay can.
- **Ingestion freshness** has no SLO yet. The queue alerts (`GroundedQueueBacklog`, `GroundedJobStuck`) and the Ingest dashboard cover it.

## Validating changes

`make obs-validate` (also in CI):
- `promtool check rules` and `promtool test rules` (promtool from the official Prometheus release, checksum-pinned, installed into `bin/obs-tools/`);
- `tools/obsgen -check`: `components/alerts` and `components/dashboards` match their sources;
- Go tests in `internal/observability` (also part of `make test`): every dashboard parses, uses schema 39 or later and only the `DS_PROMETHEUS` data source, and every expression in the dashboards and rules names a metric Grounded exposes (or a documented external one); every alert has a summary, a description, a severity and a runbook section in `alerts.md`.
