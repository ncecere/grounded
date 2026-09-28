# Alert runbooks

One section per alert in [`deploy/observability/alerts/grounded.rules.yaml`](../../deploy/observability/alerts/grounded.rules.yaml). Each alert's `runbook_url` links here. How the alerts are loaded, and the SLOs behind them: [`monitoring.md`](monitoring.md).

The commands assume the Kubernetes base in namespace `grounded` (containers `api` and `worker`; the image has no shell, the binary is `/grounded`). On compose, use `docker compose exec` and `docker compose logs` instead.

**First check for almost everything:** `grounded doctor` checks the configuration and every dependency (Postgres, Valkey, object storage, the OIDC issuer, each model connection) with timings, and names the failure ([`kubernetes.md`](../deployments/kubernetes.md#grounded-doctor)):

```sh
kubectl -n grounded exec deploy/grounded-api -c api -- /grounded doctor
kubectl -n grounded exec deploy/grounded-worker -c worker -- /grounded doctor --mode worker
```

Logs are JSON; every request log line has `route`, `status`, `duration_ms` and `request_id` (also the `X-Request-ID` response header):

```sh
kubectl -n grounded logs deploy/grounded-api -c api --since=30m | grep '"level":"ERROR"'
kubectl -n grounded logs deploy/grounded-worker -c worker --since=30m | grep -E '"level":"(WARN|ERROR)"'
```

Some checks read the job queue in Postgres. With `components/postgres-single`:

```sh
kubectl -n grounded exec -it statefulset/grounded-postgres -- psql -U grounded grounded
```

---

## GroundedAPIErrorBudgetBurn

**Meaning:** API requests (health checks and `/metrics` aside) are failing with 5xx fast enough to use 2% of the 30-day error budget in an hour, or 5% in six hours. At least one request a minute is needed for it to fire. Users see errors now.

**First checks:**
1. **Grounded / API** dashboard, "5xx by route group" and "Routes with most 5xx": one route or everything?
2. Everything: `grounded doctor` in an API pod. `/readyz` failing on Postgres, Valkey or storage takes pods out of the Service; a dependency down shows here first.
3. One route: the API log for that `route` with `"status":5`, and the `request_id` of a failing request.
4. `503` on uploads, crawls and syncs during maintenance mode are intended refusals, but they count against the budget. Planned maintenance explains a burn; turn maintenance off when done ([GroundedMaintenanceModeLong](#groundedmaintenancemodelong)).
5. Chat routes answer `503 model_unavailable` when the agent's chat model or its connection is disabled: check Administration → Models.

**Fixes:** restore the failing dependency; roll back a bad release (`kubectl -n grounded rollout undo deploy/grounded-api`); scale up if pods are saturated (**Grounded / API**, "Requests in flight", CPU). Recent deploys: `kubectl -n grounded rollout history deploy/grounded-api`.

## GroundedAPIErrorBudgetBurnSlow

**Meaning:** a low but steady 5xx rate over a day or three: at this pace the 99.9% availability objective is missed this month. Not urgent, but it doesn't go away on its own.

**First checks:** "Routes with most 5xx" on **Grounded / API** over the last 3 days; the API log for those routes. Common causes: one broken feature (a model connection that fails for one agent), a dependency with intermittent timeouts (`grounded doctor` timings), pods restarting (`kubectl -n grounded get pods`, `RESTARTS`), or maintenance mode left on.

**Fixes:** fix the route or dependency; if the errors are expected (a client repeatedly calling something that can't work), make it return a 4xx instead.

## GroundedAPILatencyBudgetBurn

**Meaning:** far more than 5% of non-streaming API requests take over 1 s (streamed chat is excluded). The UI feels slow now.

**First checks:**
1. **Grounded / API**: "Slowest routes", "p95 latency by route group". One route (a large list, an admin report) or all of them?
2. All routes slow: "Postgres pool wait" (see [GroundedDBPoolSaturated](#groundeddbpoolsaturated)), CPU and memory of the API pods, and Postgres itself (slow queries, disk). `grounded doctor` prints the Postgres round trip.
3. Retrieval (`POST /v1/teams/{team}/kbs/{kbId}/retrieve`, and chat before the model starts): **Grounded / Chat & retrieval**, "Retrieval latency"; the embedding model's latency on **Models & moderation**.

**Fixes:** scale the API; raise the pool (`pool_max_conns` in `DATABASE_URL`) if Postgres has headroom; give Postgres more CPU, memory or faster storage; for one slow route, open an issue with its `request_id` and log lines.

## GroundedAPILatencyBudgetBurnSlow

**Meaning:** over a day or three, more than 5% of non-streaming requests took over 1 s.

**First checks and fixes:** as [GroundedAPILatencyBudgetBurn](#groundedapilatencybudgetburn), over the longer window. Growth is a common cause: more documents make keyword and vector search slower; check Postgres resources and the retrieval latency on **Grounded / Chat & retrieval**.

## GroundedAPIDown

**Meaning:** Prometheus has scraped no `api` or `serve` process for 5 minutes. Either Grounded is down or Prometheus can't reach it.

**First checks:**
1. `kubectl -n grounded get pods -l app.kubernetes.io/component=api` and `kubectl -n grounded describe pod <pod>`: `CrashLoopBackOff`, `Pending`, image pull errors.
2. A crash: `kubectl -n grounded logs <pod> -c api --previous`. `invalid configuration` lists every problem ([Safety checks](../deployments/kubernetes.md#safety-checks)); the `migrate` init container's log for migration failures.
3. Pods fine but not scraped: the Prometheus target page; the `grounded-allow-metrics-scrape` NetworkPolicy must admit the scraper's namespace; the ServiceMonitor must carry the label your Prometheus selects on.

**Fixes:** see the [troubleshooting table](../deployments/kubernetes.md#troubleshooting). Roll back a bad release with `kubectl -n grounded rollout undo deploy/grounded-api`.

## GroundedWorkerDown

**Meaning:** no `worker` or `serve` process has been scraped for 10 minutes. Chat keeps working, but uploads, crawls, syncs, notifications, retention and break-glass expiry are not processed.

**First checks:** as [GroundedAPIDown](#groundedapidown), with `-l app.kubernetes.io/component=worker` and container `worker`. Worker metrics are on port 9090.

**Fixes:** as for the API. Jobs wait in Postgres and run when a worker is back; nothing is lost.

## GroundedChatAnswersFailing

**Meaning:** over 10% of chat answers (editors' tests aside) ended with an error in 15 minutes. A streamed answer fails after its HTTP 200, so the API error SLO doesn't see it.

**First checks:**
1. **Grounded / Chat & retrieval**, "Answers by outcome"; **Models & moderation**, "Failures by connection and outcome": is the chat model's connection failing ([GroundedModelConnectionFailing](#groundedmodelconnectionfailing))?
2. The API log: `"msg":"record answer"` errors, and chat requests' `request_id`.
3. Which error codes, from the answers' analytics rows (no content):
   ```sql
   SELECT error_code, channel, count(*) FROM message_events
   WHERE created_at > now() - interval '1 hour' AND error_code <> '' GROUP BY 1, 2 ORDER BY 3 DESC;
   ```

**Fixes:** a failing model connection (see its runbook); `incomplete_answer` from one agent: its model runs out of output tokens or turns (raise *max output tokens* or *max turns* on the agent); `internal`: the log line with the request ID.

## GroundedJobsFailing

**Meaning:** over a quarter of one kind of background job failed in 15 minutes (at least 3 failures). River retries with backoff; after the last attempt the job is discarded ([GroundedJobsDiscarded](#groundedjobsdiscarded)).

**First checks:**
1. **Grounded / Ingest & jobs**, "Job failures by kind".
2. The worker log for that kind: `kubectl -n grounded logs deploy/grounded-worker -c worker --since=30m | grep '<kind>'`.
3. The last errors River recorded:
   ```sql
   SELECT kind, state, attempt, errors[array_upper(errors, 1)]->>'error' AS last_error
   FROM river_job WHERE kind = '<kind>' AND errors IS NOT NULL
   ORDER BY id DESC LIMIT 10;
   ```

**Fixes by kind:** `ingest.document`: the embedding model (connection, key, dimensions) or object storage (`grounded doctor`); `web.crawl`: usually a site, not Grounded (failed pages are recorded per crawl run); `notify.email`: SMTP settings; `retention.run`: see [GroundedRetentionFailing](#groundedretentionfailing). Transient failures clear by themselves.

## GroundedJobsDiscarded

**Meaning:** at least one job of this kind failed every attempt in the last hour and was discarded. Its work is not done: a document may stay failed, an email unsent.

**First checks:** the errors of the discarded jobs:

```sql
SELECT id, kind, attempt, finalized_at, errors[array_upper(errors, 1)]->>'error' AS last_error
FROM river_job WHERE state = 'discarded' ORDER BY finalized_at DESC LIMIT 20;
```

**Fixes:** fix the cause (see [GroundedJobsFailing](#groundedjobsfailing)), then redo the work from the UI: **Retry** on failed documents, **Sync now** on a web source. Periodic jobs (retention, sweeps, sync scheduling) run again on their schedule. River deletes discarded jobs after a week.

## GroundedJobStuck

**Meaning:** a job has been `running` for over an hour. No Grounded job is meant to run that long: document processing and retention time out after 30 minutes, a crawl after its time budget (10 minutes by default) plus 5.

**First checks:** which job, and on which worker:

```sql
SELECT id, kind, attempt, attempted_at, attempted_by FROM river_job
WHERE state = 'running' ORDER BY attempted_at LIMIT 10;
```

`attempted_by` names the worker's River client. Is that pod still alive (`kubectl -n grounded get pods`)? A pod killed without a graceful stop leaves its jobs `running` until River's rescuer retries them (after an hour).

**Fixes:** usually none: the rescuer returns the job to the queue. If a live worker is hung (the log shows nothing for the job), restart it: `kubectl -n grounded rollout restart deploy/grounded-worker`. Jobs are safe to interrupt and resume.

## GroundedQueueBacklog

**Meaning:** a job ready to run has waited over 15 minutes for a worker. Workers are down, all busy, or can't claim jobs.

**First checks:**
1. Workers up? ([GroundedWorkerDown](#groundedworkerdown)).
2. **Grounded / Ingest & jobs**, "Jobs waiting by kind" and "Jobs worked by kind": busy (work is being done, the queue is just long) or stalled (nothing worked)?
3. Stalled: `grounded doctor --mode worker`, and the worker log for Postgres errors.

**Fixes:** a big upload or crawl drains by itself; raise `WORKER_CONCURRENCY` or add worker replicas if it's routine (the embedding model's rate limit is usually the real ceiling: see [GroundedModelConnectionRateLimited](#groundedmodelconnectionratelimited)). Stalled workers: restart them.

## GroundedStateUnreadable

**Meaning:** a worker's `/metrics` couldn't read the job queue and platform state from Postgres for 10 minutes (`grounded_state_up` is 0). The queue, stuck-job and maintenance alerts are blind meanwhile.

**First checks:** the worker log for `metrics: read queue and platform state`, and `grounded doctor --mode worker` (Postgres reachable, migrations current). The read has a 5-second timeout: an overloaded Postgres can cause it.

**Fixes:** restore Postgres connectivity or capacity. If migrations are behind (a new worker against an old schema), run them.

## GroundedRetentionFailing

**Meaning:** a retention rule (a data kind) failed in the last hour, so data past its retention period isn't being deleted.

**First checks:** Administration → Retention → **Runs** shows each run's error per kind; the worker log has `retention` errors. Common causes: a statement timeout on a large first purge, a database permission problem, or object storage errors for *files of deleted documents*.

**Fixes:** see [`retention.md`](retention.md). For a large backlog, lower `RETENTION_BATCH_SIZE` so each transaction is short; the next runs catch up. Legal holds are never the cause: held rows are skipped, not errors.

## GroundedRetentionStale

**Meaning:** a retention rule hasn't completed for over 3 hours; it normally runs every 10 minutes.

**First checks:** workers up and the `retention.run` job not failing ([GroundedJobsFailing](#groundedjobsfailing)); Administration → Retention → Runs for the last run. A run holds an advisory lock: a stuck run blocks the next ([GroundedJobStuck](#groundedjobstuck)).

**Fixes:** as for the failing or stuck job. **Run now** on the Retention page starts a run at once.

## GroundedMaintenanceModeLong

**Meaning:** maintenance mode has been on for over 4 hours. It never ends by itself; uploads, crawls, syncs and re-fetches stay paused while it's on (chat and retrieval keep working).

**First checks:** Administration → Maintenance shows who turned it on, when, the reason and the planned end. `grounded doctor` also reports it. Is the planned work still going on?

**Fixes:** a platform admin turns it off on Administration → Maintenance (audited). Parked documents and crawls resume by themselves within about 10 seconds.

## GroundedModelConnectionFailing

**Meaning:** over half the requests to a model connection (by the name an admin gave it) failed in 10 minutes, for one model kind: `chat` (answers), `embedding` (indexing and retrieval), `moderation` or `systemone` (checks). Rate limiting is not counted here ([GroundedModelConnectionRateLimited](#groundedmodelconnectionratelimited)).

**First checks:**
1. **Grounded / Models & moderation**, "Failures by connection and outcome": the outcome says why. `unavailable`: network, timeout or a 5xx from the gateway; `auth`: the key was refused; `not_found`: wrong model name or base URL; `bad_request`, `bad_response`: the gateway and Grounded disagree about the request or the answer.
2. Administration → Models → Connections: **Test connection**, and **Test model** on the model: both show the phases (DNS, connect, TLS, first byte) and the gateway's message.
3. `grounded doctor` checks every enabled connection from inside the cluster, which is what matters (egress NetworkPolicy, proxies, DNS).

**Fixes:** `auth`: enter the key again (Administration → Models → Connections); `not_found`: fix the upstream model name; `unavailable`: the gateway or the model server is down, or egress is blocked. Chat agents answer with *model unavailable* meanwhile; ingestion retries and then waits.

## GroundedModelConnectionRateLimited

**Meaning:** for 30 minutes, over 20% of a connection's requests were refused because of load: the gateway answered 429 (`rate_limited`), or the connection's own *requests per minute* setting held them back (`throttled`). Nothing is broken: requests wait and retry. But chat answers take longer or say the model is busy, and ingestion slows.

**First checks:** **Models & moderation**, "Rate limited (429) and throttled", and which kinds are busy. A large upload or crawl (embeddings) is the usual cause; **Ingest & jobs** shows it.

**Fixes:** raise the gateway's limit for Grounded's key, or the connection's *requests per minute* if it's set below what the gateway allows; move embeddings to a separate connection so indexing can't starve chat; schedule big crawls off-hours.

## GroundedDBPoolSaturated

**Meaning:** one process has used over 90% of its Postgres connection pool for 10 minutes; requests and jobs wait for a connection.

**First checks:** **Grounded / API**, "Postgres connections in use" and "Postgres pool wait" per instance. Is the process busy (traffic, many chat streams, a large job), or is Postgres slow so connections are held longer?

**Fixes:** raise the pool with `pool_max_conns` in `DATABASE_URL` (pgx's default is the larger of 4 and the number of CPUs), keeping the total over all replicas under Postgres's `max_connections`; add replicas; or fix Postgres slowness first.

## GroundedValkeyErrors

**Meaning:** Valkey commands or connections are failing (more than one every 10 seconds). Rate limits and anonymous-session guards fail open (traffic isn't blocked), and crawl pacing and the model connections' request limits are affected.

**First checks:** **Grounded / API**, "Valkey errors by command": `dial` means Valkey is unreachable. `grounded doctor` (Valkey PING); `kubectl -n grounded get pods -l app.kubernetes.io/component=valkey`; the password in `VALKEY_URL`.

**Fixes:** restore Valkey. It holds no durable data: restarting it or losing its contents is safe.

## GroundedBackupMissing

**Meaning:** a backup CronJob hasn't succeeded for over 26 hours: `grounded-postgres-backup` (`components/backup-pgdump`) or `grounded-objects-backup` (`components/backup-objects`, the bucket's off-site copy). Both run daily. Needs kube-state-metrics.

**First checks:** `kubectl -n grounded get cronjob grounded-postgres-backup` (suspended? last schedule?); `kubectl -n grounded get jobs --sort-by=.metadata.creationTimestamp`; the last job's log: `kubectl -n grounded logs job/<job>`. Also [GroundedBackupJobFailed](#groundedbackupjobfailed).

**Fixes:** fix the cause (see below), then take a backup now: `kubectl -n grounded create job --from=cronjob/<cronjob> manual-backup`. A CronJob left suspended after a restore ([`restore.md`](restore.md), step 6) also fires this. A CloudNativePG install backs up through its own ScheduledBackup instead; watch the plugin's backup metrics.

## GroundedBackupJobFailed

**Meaning:** a backup job failed. Earlier dumps are kept; the next scheduled run tries again.

**First checks:** `kubectl -n grounded logs job/<job_name> --all-containers`. Common causes: the backup PVC `grounded-postgres-backups` is full ([GroundedVolumeFillingUp](#groundedvolumefillingup)); `pg_dump` can't connect (password, NetworkPolicy); `pg_restore --list` rejected the dump; the off-site copy (rclone) failed on credentials or endpoint; for `grounded-objects-backup`, the bucket or the off-site target is unreachable.

**Fixes:** as the log says. Delete the failed Job once understood (`kubectl -n grounded delete job <job_name>`): the alert fires while it exists.

## GroundedVolumeFillingUp

**Meaning:** one of Grounded's PersistentVolumeClaims is over 85% full. Needs kubelet volume metrics. The claims: `data-grounded-postgres-0` (Postgres), `grounded-postgres-backups` (dumps), CloudNativePG's `grounded-postgres-N`, and Valkey's.

**First checks:** which claim. Postgres: which tables grow (documents, vectors, messages, audit and usage logs); dead rows after large deletes need a `VACUUM`. Backups: `RETENTION_DAYS` in the `grounded-postgres-backup` ConfigMap against dump size.

**Fixes:** expand the claim (if the storage class allows `allowVolumeExpansion`); set retention periods ([`retention.md`](retention.md)) with records management's agreement; keep fewer dumps on the PVC and more off-site.

## GroundedVolumeFull

**Meaning:** a Grounded claim is over 95% full, or at the rate of the last 6 hours fills within a day. A full Postgres volume stops all writes: sign-in, chat history and ingestion fail.

**First checks and fixes:** as [GroundedVolumeFillingUp](#groundedvolumefillingup), now. To stop the growth quickly, turn maintenance mode on (pauses ingestion) while the volume is expanded.
