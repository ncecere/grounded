# Stored health: connections and models

Grounded keeps the latest test result of every model connection and model (roadmap E11, [`v0.3.0.md` §5](../v0.3.0.md#5-stored-health-e11)). Admin → Connections and Admin → Models show it in a **Health** column, "Healthy · 3 minutes ago" or "Failing · since 2 hours ago", with a Health filter. A connection or model that has never been tested shows **Not tested yet**. The record page of a connection or model shows the exact time of the last test, who ran it (an admin or the scheduled check), and, when it failed, the error class and the gateway's message. Failures also appear on the admin Overview under **Needs attention** ("1 connection is failing", "2 models are failing"), linking to the list filtered to the failing ones.

Platform admins and platform auditors can see health; nobody else can. Only platform admins can run a test.

## Where results come from

| Trigger | What it sends | Stored as |
|---|---|---|
| **Test connection** (an admin, on a connection's page) | `GET /models`, or one small SystemOne question for a SystemOne service ([`systemone.md`](../systemone.md)) | The connection's result, plus the result it implies for each enabled model on it (below) |
| **Test model** (an admin, on a model's page or row menu) | One small real request to the model: a 16-token chat completion, one embedding, the moderation samples, the SystemOne sample questions or the OCR sample page. This costs a few tokens | The model's result |
| **The scheduled check** (the worker's `health.check` job) | For each enabled connection, `GET /models`. For a SystemOne service, only a `GET` of its SystemOne endpoint, to check that the service answers. It never asks a question | The connection's result, plus the result it implies for each enabled model on it |

**What a scheduled check costs:** nothing. It never sends a completion, an embedding, a moderation check or a SystemOne question. A gateway's `GET /models` is free, and a SystemOne service may bill per request, so its endpoint is only checked for an answer. The trade-off is that a scheduled check proves less than **Test model**:

- **A connection passes** when its gateway lists its models. For a SystemOne service, it passes when the SystemOne endpoint answers, with anything but a server error, a refused key or a 429.
- **A model passes** when its connection passes and the connection's model list includes the model's upstream ID. It fails with class `not_found` when the gateway lists models but not this one. SystemOne models are never listed, and an empty list proves nothing, so neither counts against a model.
- **A model fails with its connection** when the connection fails, with the connection's error class ("Its connection failed its test: …").

So a model whose upstream is listed but broken (for example, out of GPU memory) shows healthy until an admin presses **Test model** or real traffic fails. [`GroundedModelConnectionFailing`](alerts.md#groundedmodelconnectionfailing) catches that case from real requests.

## Status, error classes and messages

Each check is **healthy** or **failing**. A failing check has an error class:

| Class | Shown as | Meaning |
|---|---|---|
| `unavailable` | Unreachable or server error | Network, DNS, TLS or proxy failure, a timeout, or a 5xx |
| `auth` | API key refused | 401 or 403 |
| `not_found` | Not found | A wrong base URL (missing `/v1`?), or the gateway no longer lists the model |
| `rate_limited` | Rate limited | 429 (or 529) |
| `bad_request` | Request refused | Another 4xx |
| `bad_response` | Unexpected response | The answer wasn't what an OpenAI-compatible or SystemOne API returns |
| `config` | Settings problem | The connection's own settings keep it from being tested: its stored API key can't be decrypted with the current `ENCRYPTION_KEY`. Enter the key again |

The stored message is the gateway's error message, at most 300 characters, with anything that looks like a key or bearer token replaced by `[redacted]`. Response bodies are never stored. **Failing since** is when the current run of failures began. It stays correct after older checks are pruned.

## Schedule

The worker re-tests enabled connections every `HEALTH_CHECK_INTERVAL` (default `15m`):

| Setting | Default | Allowed |
|---|---|---|
| `HEALTH_CHECK_INTERVAL` | `15m` | `5m` to `24h`, or `0` / `off` to stop the scheduled check (Test buttons still store their results) |

- **Only enabled subjects** are tested: an enabled connection and its enabled models. A disabled connection or model keeps its last result, and isn't counted on the Overview or in the metrics. With nothing enabled, a run tests nothing.
- **Each connection is tested once per run.** Its models' health comes from that one test, so a connection is never probed more than once at a time by a run. At most 4 connections are tested at once, and each test is bounded by the connection's timeout and by 2 minutes.
- **Jitter:** each run starts after a random delay of up to a tenth of the interval (at most 2 minutes), so installs and restarts don't probe a shared gateway in step. The first run comes shortly after a worker starts.
- **One run per interval** across all worker processes: only River's leader enqueues periodic jobs. A run never outlasts the interval (at most 10 minutes).
- **Maintenance mode doesn't pause it.** Maintenance pauses ingestion and the writes it names, and a check writes nothing but its own result.
- A failed run isn't retried. The next one re-tests.

The scheduled check doesn't count in `grounded_model_requests_total`, like the Test buttons and `grounded doctor`.

## Retention

The `health_checks` table keeps **7 days** of checks per subject, plus always each subject's latest check however old. The health job prunes older checks, and every check of a deleted connection or model, at the end of each run. With the default interval that is about 700 rows per connection (one for the connection and one per enabled model every 15 minutes). With `HEALTH_CHECK_INTERVAL=off`, nothing is pruned until the schedule is back on, and only Test presses add rows.

## API

`GET /v1/admin/health-checks` (platform admins and auditors) returns the latest check of each subject that has one: `subjectKind` (`connection` or `model`), `subjectId`, `subjectName`, `subjectEnabled`, `status`, `latencyMs`, `errorClass`, `httpStatus`, `message`, `trigger` (`manual` or `scheduled`), `triggeredBy` and `triggeredByName`, `checkedAt` and `statusSince`. `?kind=connection` or `?kind=model` narrows it. The Test endpoints (`POST /v1/admin/connections/{id}/test`, `POST /v1/admin/models/{id}/test`) return their results as before, and store them. See [`api/openapi.yaml`](../../api/openapi.yaml).

## Metrics and alert

The worker (and `serve`) processes read these from Postgres when scraped, with the other install-state metrics ([`monitoring.md`](monitoring.md#install-state-read-from-postgres-at-scrape-time)):

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_health_failing` | gauge | `kind` (`connection`, `model`) | Enabled subjects whose latest check failed |
| `grounded_health_failing_seconds` | gauge | `kind`, `name` | How long each failing enabled subject has been failing; absent while it's healthy. `name` is the connection's name or the model's display name |

Every process that stores a check also counts it:

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `grounded_health_checks_total` | counter | `kind`, `trigger` (`manual`, `scheduled`), `status` (`healthy`, `failing`) | Stored checks |
| `grounded_health_check_duration_seconds` | histogram | `kind` | The test's latency |

The alert [`GroundedHealthCheckFailing`](alerts.md#groundedhealthcheckfailing) (warning) fires when an enabled connection or model has failed every check for over 30 minutes: `max by (namespace, kind, name) (grounded_health_failing_seconds) > 1800`.

## Adding a subject kind

A subject is a kind and an ID, with no foreign key. MCP servers (v0.3 M3) become a third kind: a value in the `health_checks_subject_kind` constraint, a branch in the `health_subjects` view (name, and whether it's enabled), a `Kind` constant and a `Checker` for the job in `internal/healthcheck`, and the value in `HealthSubjectKind` in the OpenAPI.
