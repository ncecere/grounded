# Restoring Postgres and object storage

Use this runbook when Grounded's database or its bucket is lost or damaged: a deleted or corrupt Postgres volume, a bad migration, a bucket emptied by mistake. It restores the newest good backup of each and brings the app back. The steps were rehearsed on a throwaway kind cluster with `make k8s-restore-rehearsal` ("Rehearsal" below); the whole restore took 46 seconds for a small install.

Targets (DESIGN §15): Postgres RPO 15 minutes, object storage RPO 24 hours, RTO 4 hours.

## What is backed up, and where

| Data | Backed up by | Where | RPO it gives |
|---|---|---|---|
| Postgres: every table, including the vectors (pgvector) and the job queue | `components/backup-pgdump`: a daily `pg_dump -Fc` (03:17 UTC), checked with `pg_restore --list` | the `grounded-postgres-backups` PVC, 14 days; off-site when `UPLOAD_S3_BUCKET` is set | 24 hours |
| Postgres on CloudNativePG | `components/postgres-cnpg`: WAL archiving and a daily base backup through the Barman Cloud Plugin | the `grounded-postgres-backup` object store | minutes (the 15-minute target) |
| The bucket: original documents and parsed text | `components/backup-objects`: a daily `rclone sync` (03:47 UTC) | the off-site target, `<prefix>/current`; files changed or deleted since the last run under `<prefix>/previous/<time>`, 14 days | 24 hours |
| Valkey | nothing: it holds only rate-limit counters and crawl pacing | | |

A daily `pg_dump` meets the 24-hour RPO, not the 15-minute one. Installs that need 15 minutes run CloudNativePG (or a managed Postgres with point-in-time recovery); this runbook covers the `pg_dump` path, and "CloudNativePG" below points to the other.

Keep the off-site target on a **different system** from the primary storage. A copy on the same disk or NAS survives a mistake, not a hardware loss.

## Before you start

- **The secrets, with the same values.** `ENCRYPTION_KEY` decrypts the stored model connection keys and SMTP and moderation secrets; without it they are unreadable and must be entered again. `API_KEY_PEPPER` validates API keys; without it every key must be recreated. Both live in your secret store (OpenBao at home). If the keys were rotated after the backup, see [`rotate-keys.md`](rotate-keys.md), "Restoring a backup".
- **Which backup.** The newest dump from before the incident. The backup Jobs' logs name each one (`kubectl -n grounded logs job/<backup-job> --all-containers`: `backup ok: /backups/grounded-<time>.dump`); the off-site copy lists them with `rclone lsf <remote>:<bucket>/grounded/postgres`. By default the restore Jobs take the newest.
- **Is the bucket damaged too?** A database-only incident (a bad migration, a dropped table) needs steps 1–3 and 5–6 only; restoring the bucket over good files is harmless but slow.

Time each step: the log is your RTO record.

## 1. Stop the app and the backups

Stop anything that writes, and the backup CronJobs, so that an empty or half-restored database is never dumped. The restore Job picks the **newest** dump by default, and a fresh dump of an empty database would be the newest.

```sh
# GitOps: suspend reconciliation first, or it undoes the next commands
flux suspend kustomization grounded            # (home install; other tools have an equivalent)
kubectl -n grounded patch cronjob grounded-postgres-backup -p '{"spec":{"suspend":true}}'
kubectl -n grounded patch cronjob grounded-objects-backup -p '{"spec":{"suspend":true}}'
kubectl -n grounded scale deployment grounded-api grounded-worker --replicas=0
kubectl -n grounded wait --for=delete pod -l 'app.kubernetes.io/component in (api,worker)' --timeout=300s
```

Users see the ingress's error page meanwhile. For a planned restore, turn on maintenance mode first; for an incident there is no time.

## 2. An empty database

**The volume is gone** (the rehearsal's case): recreate the Postgres StatefulSet from your manifests. It starts with a new, empty `grounded` database.

```sh
kustomize build <your overlay> | kubectl -n grounded apply -l app.kubernetes.io/component=postgres -f -
kubectl -n grounded rollout status statefulset/grounded-postgres --timeout=600s
```

The label selector applies only the Postgres objects: applying everything would start the api and worker, whose `migrate` init container would create an empty schema that the restore then refuses.

**The server is fine but the data is bad:** drop and recreate the database (this deletes it; be sure of the backup first):

```sh
kubectl -n grounded exec -it statefulset/grounded-postgres -- \
  psql -U grounded -d postgres -c 'DROP DATABASE grounded WITH (FORCE)' -c 'CREATE DATABASE grounded'
```

## 3. Restore the dump

Two Jobs in [`deploy/kubernetes/restore/`](../../deploy/kubernetes/restore/), one for each place the dump lives. Both use the pgvector image of `components/postgres-single`, so `pg_restore` matches the server; read the connection from the `grounded-postgres-backup` ConfigMap and the password from `grounded-runtime`; refuse a database that already has tables; and restore in a single transaction (all or nothing), then `ANALYZE`.

```sh
# optional: a specific dump instead of the newest
kubectl -n grounded create configmap grounded-restore --from-literal=DUMP=grounded-20260927T031700Z.dump

# the dump is on the grounded-postgres-backups PVC
kubectl -n grounded apply -f deploy/kubernetes/restore/pg-restore-pvc.yaml
# or: the PVC is lost too; fetch it from the off-site copy (UPLOAD_S3_* and grounded-backup-s3)
kubectl -n grounded apply -f deploy/kubernetes/restore/pg-restore-offsite.yaml

kubectl -n grounded wait --for=condition=complete job/grounded-pg-restore --timeout=4h
kubectl -n grounded logs job/grounded-pg-restore --all-containers
```

The log ends with `restored: <teams> <documents> <chunks> <schema version>`. On failure, nothing was written (single transaction): read the error, fix it, delete the Job, and apply it again. The off-site Job holds the dump in an `emptyDir` of up to 20Gi; raise `sizeLimit` for a larger dump.

Restore time grows with the database, mostly in rebuilding indexes (the full-text and HNSW vector indexes). The rehearsal's 1.5 MB dump took 3 seconds. The FiQA benchmark used about 10 MiB per 1,000 short documents ([`scale-10k.md`](../benchmarks/scale-10k.md)), and a vector is 1.5 KB before indexes, so a 10M-chunk install restores tens of gigabytes. Time a restore of your own size once: if it approaches the 4-hour RTO, use CloudNativePG.

## 4. Restore the bucket

Copy the off-site copy back. The Job copies and never deletes, so files still in the bucket stay. Tell it the bucket with the same values as `grounded-config`:

```sh
kubectl -n grounded create configmap grounded-restore \
  --from-literal=S3_ENDPOINT=https://s3.example.org --from-literal=S3_BUCKET=grounded   # S3_PREFIX, S3_REGION if you set them
kubectl -n grounded apply -f deploy/kubernetes/restore/objects-restore.yaml
kubectl -n grounded wait --for=condition=complete job/grounded-objects-restore --timeout=4h
kubectl -n grounded logs job/grounded-objects-restore     # "0 differences found", then the object count
```

(If `grounded-restore` exists from step 3, add the keys to it: `kubectl -n grounded edit configmap grounded-restore`.) `SNAPSHOT=previous/<time>` restores the files a later run replaced or deleted, for example after a bad bulk delete.

## 5. Start the app

```sh
kubectl -n grounded delete configmap grounded-restore --ignore-not-found
kubectl -n grounded delete job grounded-pg-restore grounded-objects-restore --ignore-not-found
flux resume kustomization grounded        # or: kustomize build <overlay> | kubectl apply -f -
kubectl -n grounded rollout status deployment/grounded-api --timeout=600s
kubectl -n grounded rollout status deployment/grounded-worker --timeout=600s
```

Re-applying the manifests recreates the api and worker (their `migrate` init container finds nothing to do, or applies the migrations of a newer release) and the CronJobs, unsuspended. If you applied nothing, unsuspend them by hand (`-p '{"spec":{"suspend":false}}'`): a suspended backup fires [GroundedBackupMissing](alerts.md#groundedbackupmissing) a day later.

## 6. Verify

```sh
kubectl -n grounded exec deploy/grounded-api -c api -- /grounded doctor     # every check passes
kubectl -n grounded exec -it statefulset/grounded-postgres -- psql -U grounded -d grounded -c \
  "SELECT (SELECT count(*) FROM teams) teams, (SELECT count(*) FROM documents) documents,
          (SELECT count(*) FROM documents WHERE status = 'ready') ready, (SELECT count(*) FROM chunks) chunks,
          (SELECT count(*) FROM conversations) conversations"
```

- The counts match the backup's (the rehearsal records them just before the backup; in an incident compare with the last dashboard or the `restored:` line).
- **Every document's files exist.** List the keys the database expects and compare them with the bucket:
  ```sh
  psql ... -At -c "SELECT blob_key FROM documents WHERE blob_key <> ''
                   UNION ALL SELECT regexp_replace(blob_key, 'original$', 'parsed.md') FROM documents WHERE status = 'ready'" | sort >expected
  rclone lsf -R --files-only primary:grounded | sort >present
  comm -23 expected present      # empty: nothing missing
  ```
- Sign in, open a KB and search it, ask an agent a question (an answer with citations), and use an existing API key.
- Take a fresh backup of both, now: `kubectl -n grounded create job --from=cronjob/grounded-postgres-backup after-restore` (and the same for `grounded-objects-backup`).

Write down the incident's timeline, the backup used and the data lost (the time between the backup and the incident).

### Consistency between the two

The database and the bucket are copied half an hour apart (03:17 and 03:47 UTC), so the bucket copy is the newer. After restoring both:
- **Files without rows** (uploaded between the two backups): harmless. They are never read, and the retention job does not see them.
- **Rows without files** (the bucket restored from an older copy than the database): those documents' originals are missing. `comm` above lists them. Re-upload them, or for web pages use Re-fetch; deleting them from their source also works.

## CloudNativePG

A CNPG install restores by creating a new `Cluster` that bootstraps from the Barman object store (`bootstrap.recovery`, optionally with a `recoveryTarget` time for point-in-time recovery), then pointing `DATABASE_URL` at it; see the CloudNativePG documentation, "Recovery". Steps 1, 4, 5 and 6 above are the same. This path is not rehearsed here.

## A single-node install with backups on one NAS

The reference install (a homelab cluster, phase 5 §4) runs `postgres-single` and `backup-pgdump` with both PVCs on the same NAS, and an S3-compatible object store for the bucket on that NAS too. Keeping backups there is an accepted risk (phase 5 §9, decision 4): they protect against mistakes (a dropped table, a bad migration, a deleted bucket object), not against losing the NAS.

- Use `pg-restore-pvc.yaml` in step 3: there is no off-site copy.
- Step 4 applies only with `components/backup-objects` pointed at a second bucket. That protects against deletions (including `previous/`), still not against the NAS.
- Step 1: `flux suspend kustomization grounded` first; Flux would otherwise scale the Deployments back within minutes. Resume it in step 5.
- The keys live in the cluster's secret store; External Secrets recreates `grounded-runtime` from them if the namespace was lost.

## Rehearsal

`make k8s-restore-rehearsal` ([`restore-rehearsal.sh`](../../deploy/kubernetes/scripts/restore-rehearsal.sh)) runs this runbook on a throwaway kind cluster, with its own kubeconfig (your kubeconfig and clusters are never touched):

1. It deploys `deploy/kubernetes/test/load` (the example-small shape: `postgres-single`, `backup-pgdump`, `backup-objects` and an S3 test server, with the demo's fake models) and a second S3 server in namespace `grounded-offsite` as the off-site target. It seeds the demo (the go.dev crawl), then adds an API key, five uploads and a conversation.
2. It runs both backup CronJobs and records a fingerprint: row counts, the embeddings, the bucket listing, the top retrieval hit for a question. It checks that the dump and the files are on the off-site target before destroying anything.
3. The disaster: it deletes the Postgres StatefulSet, its PVC and the backups PVC (with the finished backup Jobs' pods, which otherwise keep the PVC), and empties the bucket.
4. Steps 1–5 above, timed, restoring from the off-site copy.
5. Verification: `grounded doctor`; the same row counts, embeddings and bucket listing; no document file missing; the same top retrieval hit with the pre-backup API key; the pre-backup session reads its conversation; a new chat answers with citations.

Every delete and wait is bounded, and any failure stops it with diagnostics. Results for 2026-09-27 (commit `5029a43`; an Apple M4 Pro, Docker Desktop with 12 CPUs and 8 GB; 102 documents, 1,021 chunks, 204 objects, a 1.5 MB dump):

| Step | Seconds |
|---|---:|
| Backup: `pg_dump` and the off-site copy | 11 |
| Backup: the bucket | 3 |
| 1. Stop the app and the backups | 18 |
| 2. Recreate Postgres | 10 |
| 3. `pg_restore` (off-site) | 3 |
| 4. Restore the bucket | 4 |
| 5. Start the app | 6 |
| 6. Verify | 5 |
| **Restore, stop to verified** | **46** |

On a real install the fixed costs dominate: noticing the incident, deciding which backup to use, and pulling images. `pg_restore` grows with the database (step 3). Run the rehearsal after any change to the backup components, and time a restore of your own install's size once a year.
