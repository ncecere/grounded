#!/usr/bin/env bash
# Restore rehearsal (docs/operations/restore.md) on a throwaway kind cluster:
#
#  1. deploy test/load (the example-small shape: postgres-single,
#     backup-pgdump, backup-objects, the S3 test server) and an "off-site" S3
#     server in its own namespace, seed the demo with the fake models (the
#     go.dev crawl), add an API key, a conversation and uploads;
#  2. back up: run the pg_dump CronJob and the objects CronJob, both copying
#     off-site; record a fingerprint (row counts, retrieval, blob keys);
#  3. disaster: delete the Postgres StatefulSet, its PVC and the backups PVC,
#     and empty the bucket;
#  4. restore by the runbook, timing each step: stop the app, recreate
#     Postgres, pg_restore the off-site dump, copy the bucket back, start the
#     app;
#  5. verify: grounded doctor, the same fingerprint, every document's files
#     present, retrieval with the old key, the old session and conversation,
#     a new chat.
#
# Prints the timings (the RTO) and writes them with the logs to RESULTS
# (default /tmp/grounded-restore-<time>). Deletes the cluster unless KEEP=1.
# Never touches your kubeconfig. Needs docker, kind, kubectl, kustomize,
# openssl, curl. Used by `make k8s-restore-rehearsal`.
set -euo pipefail

CLUSTER="${CLUSTER:-grounded-restore}"
# shellcheck source=kind-lib.sh
. "$(cd "$(dirname "$0")" && pwd)/kind-lib.sh"
results="${RESULTS:-/tmp/grounded-restore-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$results"
offsite_ns=grounded-offsite
pids=()

cleanup() {
  status=$?
  for p in "${pids[@]:-}"; do
    if [ -n "$p" ]; then kill "$p" 2>/dev/null || true; wait "$p" 2>/dev/null || true; fi
  done
  rm -f "${kubeconfig}".pf.* "${kubeconfig}.jar"
  if [ "$status" -ne 0 ] && [ -s "$kubeconfig" ]; then kind_diagnostics; fi
  kind_down
  echo "results: ${results}"
  exit "$status"
}
trap cleanup EXIT

# --- helpers -----------------------------------------------------------------

step_names=()
step_secs=()
t_step=0
step() { t_step=$(date +%s); echo "--- $*"; }
done_step() { # name
  local s=$(($(date +%s) - t_step))
  step_names+=("$1")
  step_secs+=("$s")
  echo "    ${1}: ${s} s"
}

# A kubectl port-forward to the API (for a handful of verification calls),
# restarted after the API pods are replaced.
api=""
forward_api() {
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  pids=()
  local log="${kubeconfig}.pf.api"
  kc port-forward svc/grounded-api ":80" >"$log" 2>&1 &
  pids+=($!)
  for _ in $(seq 1 30); do
    api="$(sed -n 's/^Forwarding from 127.0.0.1:\([0-9]*\) .*/\1/p' "$log" | head -n 1)"
    [ -n "$api" ] && return 0
    sleep 1
  done
  echo "port-forward failed: $(cat "$log")" >&2
  return 1
}
jar="${kubeconfig}.jar"
csrf=""
# http METHOD PATH JSON|'' [extra curl args]: the dev admin's session (the
# Host header must be APP_URL's host for development sign-in).
http() {
  local method="$1" path="$2" body="${3:-}"
  shift 3 || shift $#
  local json=()
  [ -z "$body" ] || json=(-H 'Content-Type: application/json' --data "$body")
  curl -sS --retry 5 --retry-all-errors --retry-delay 1 -X "$method" -b "$jar" -c "$jar" \
    -H 'Host: localhost:8080' -H "X-CSRF-Token: ${csrf}" ${json[@]+"${json[@]}"} "$@" "http://127.0.0.1:${api}${path}"
}
# field NAME: the first "NAME":"value" in the JSON on stdin (keys come
# sorted, so nested objects may come before or after; take the first).
field() { grep -o "\"$1\":\"[^\"]*\"" | head -n 1 | sed 's/^[^:]*:"//; s/"$//'; }
# need NAME VALUE: fail loudly when a value the rehearsal relies on is empty.
need() { [ -n "$2" ] || { echo "FAIL: no ${1}" >&2; exit 1; }; }
sign_in() {
  http POST /auth/dev '{"account":"admin"}' >/dev/null
  csrf="$(http GET /v1/me '' | field csrfToken)"
  [ -n "$csrf" ] || { echo "dev sign-in failed" >&2; return 1; }
}

# fingerprint: what must survive a restore. Business tables only: River
# jobs, sessions' last-seen times and periodic audit entries move on their own.
fingerprint() {
  psql_q -c "SELECT 'teams', count(*) FROM teams UNION ALL SELECT 'users', count(*) FROM users
    UNION ALL SELECT 'data_sources', count(*) FROM data_sources UNION ALL SELECT 'documents', count(*) FROM documents
    UNION ALL SELECT 'documents_ready', count(*) FROM documents WHERE status = 'ready'
    UNION ALL SELECT 'chunks', count(*) FROM chunks UNION ALL SELECT 'knowledge_bases', count(*) FROM knowledge_bases
    UNION ALL SELECT 'agents', count(*) FROM agents UNION ALL SELECT 'agent_versions', count(*) FROM agent_versions
    UNION ALL SELECT 'conversations', count(*) FROM conversations UNION ALL SELECT 'messages', count(*) FROM messages
    UNION ALL SELECT 'api_keys', count(*) FROM api_keys UNION ALL SELECT 'model_connections', count(*) FROM model_connections
    ORDER BY 1"
}
embeddings() { # rows in every emb_* table
  local total=0 n t
  for t in $(psql_q -c "SELECT tablename FROM pg_tables WHERE tablename LIKE 'emb\\_%'"); do
    n="$(psql_q -c "SELECT count(*) FROM ${t}")"
    total=$((total + n))
  done
  echo "$total"
}
blob_keys() { # every document's original and parsed text
  psql_q -c "SELECT blob_key FROM documents WHERE blob_key <> '' UNION ALL
    SELECT regexp_replace(blob_key, 'original$', 'parsed.md') FROM documents WHERE blob_key <> '' AND status = 'ready'" | sort
}

# delete_job NAME: deletes a Job and its pods and waits (bounded) until they
# are gone. A Completed pod still counts as a user of the PVCs it mounts
# (kubernetes.io/pvc-protection), so PVCs are only deleted after this.
delete_job() {
  kc delete job "$1" --ignore-not-found --cascade=foreground --wait=true --timeout=120s >/dev/null
  kc delete pod -l "job-name=$1" --ignore-not-found --wait=true --timeout=120s >/dev/null
}

# run_job NAME MANIFEST-FILE: applies a Job and waits; its logs go to RESULTS.
run_job() {
  delete_job "$1"
  kc apply -f "$2" >/dev/null
  if ! kc wait --for=condition=complete "job/$1" --timeout=1800s >/dev/null; then
    kc logs "job/$1" --all-containers >"${results}/$1.log" 2>&1 || true
    cat "${results}/$1.log" >&2
    return 1
  fi
  kc logs "job/$1" --all-containers >"${results}/$1.log" 2>&1
  tail -n 3 "${results}/$1.log" | sed 's/^/    /'
}
# cronjob_now CRONJOB JOB: runs a CronJob once and waits.
cronjob_now() {
  delete_job "$2"
  kc create job --from="cronjob/$1" "$2" >/dev/null
  if ! kc wait --for=condition=complete "job/$2" --timeout=1800s >/dev/null; then
    kc logs "job/$2" --all-containers >&2 || true
    return 1
  fi
  kc logs "job/$2" --all-containers >"${results}/$2.log" 2>&1
  tail -n 2 "${results}/$2.log" | sed 's/^/    /'
}
# bucket_list [COMMAND]: every object key in the primary bucket (rclone lsf
# in a Job), or COMMAND's output. Remote s: is the primary S3, o: the
# off-site one.
bucket_list() {
  local cmd="${1:-}"
  [ -n "$cmd" ] || cmd='rclone --config "" lsf -R --files-only s:grounded'
  cat >"${results}/bucket-list.yaml" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: grounded-bucket-list
  labels: {app.kubernetes.io/name: grounded, app.kubernetes.io/component: backup}
spec:
  backoffLimit: 1
  template:
    metadata:
      labels: {app.kubernetes.io/name: grounded, app.kubernetes.io/component: backup}
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext: {runAsNonRoot: true, runAsUser: 65532, seccompProfile: {type: RuntimeDefault}}
      containers:
        - name: list
          image: ${rclone_image}
          command: [/bin/sh, -ec]
          args:
            - |
              export RCLONE_CONFIG_S_TYPE=s3 RCLONE_CONFIG_S_PROVIDER=Other RCLONE_CONFIG_S_ENDPOINT=http://grounded-smoke-s3:9000
              export RCLONE_CONFIG_S_ACCESS_KEY_ID="\$K" RCLONE_CONFIG_S_SECRET_ACCESS_KEY="\$S"
              export RCLONE_CONFIG_O_TYPE=s3 RCLONE_CONFIG_O_PROVIDER=Other RCLONE_CONFIG_O_ENDPOINT=http://offsite-s3.${offsite_ns}:9000
              export RCLONE_CONFIG_O_ACCESS_KEY_ID="\$OK" RCLONE_CONFIG_O_SECRET_ACCESS_KEY="\$OS"
              ${cmd}
          env:
            - {name: HOME, value: /tmp}
            - {name: K, valueFrom: {secretKeyRef: {name: grounded-s3, key: access_key}}}
            - {name: S, valueFrom: {secretKeyRef: {name: grounded-s3, key: secret_key}}}
            - {name: OK, valueFrom: {secretKeyRef: {name: grounded-backup-s3, key: access_key}}}
            - {name: OS, valueFrom: {secretKeyRef: {name: grounded-backup-s3, key: secret_key}}}
          securityContext: {allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: {drop: [ALL]}}
          volumeMounts: [{name: tmp, mountPath: /tmp}]
      volumes: [{name: tmp, emptyDir: {}}]
EOF
  delete_job grounded-bucket-list
  kc apply -f "${results}/bucket-list.yaml" >/dev/null
  if ! kc wait --for=condition=complete job/grounded-bucket-list --timeout=600s >/dev/null; then
    kc logs job/grounded-bucket-list >&2 || true
    return 1
  fi
  kc logs job/grounded-bucket-list | sort
}
rclone_image="$(sed -n 's/^ *image: \(docker.io\/rclone\/rclone:[^ ]*\)$/\1/p' "${kind_root}/components/backup-objects/backup.yaml" | head -n 1)"
silo_image="$(sed -n 's/^ *image: \(docker.io\/pgsty\/silo:[^ ]*\)$/\1/p' "${kind_root}/test/kind/s3.yaml" | head -n 1)"
mc_image="$(sed -n 's/^ *image: \(docker.io\/pgsty\/mc:[^ ]*\)$/\1/p' "${kind_root}/test/kind/s3.yaml" | head -n 1)"

# --- 1. deploy and load data -------------------------------------------------

kind_build
kind_create
kind_secrets

echo "--- the off-site target: a second S3 server in namespace ${offsite_ns}"
off_key="offsite$(openssl rand -hex 6)"
off_secret="$(openssl rand -hex 24)"
kubectl --kubeconfig "$kubeconfig" --context "kind-${cluster}" apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${offsite_ns}
  labels: {pod-security.kubernetes.io/enforce: restricted}
---
apiVersion: v1
kind: Secret
metadata: {name: offsite-s3, namespace: ${offsite_ns}}
stringData: {access_key: "${off_key}", secret_key: "${off_secret}"}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: offsite-s3, namespace: ${offsite_ns}}
spec:
  selector: {matchLabels: {app: offsite-s3}}
  template:
    metadata: {labels: {app: offsite-s3}}
    spec:
      automountServiceAccountToken: false
      securityContext: {runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: {type: RuntimeDefault}}
      containers:
        - name: s3
          image: ${silo_image}
          args: [server, /data, --certs-dir, /tmp/certs]
          env:
            - {name: HOME, value: /tmp}
            - {name: MINIO_ROOT_USER, valueFrom: {secretKeyRef: {name: offsite-s3, key: access_key}}}
            - {name: MINIO_ROOT_PASSWORD, valueFrom: {secretKeyRef: {name: offsite-s3, key: secret_key}}}
          ports: [{name: s3, containerPort: 9000}]
          readinessProbe: {httpGet: {path: /minio/health/ready, port: s3}, periodSeconds: 3}
          securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: [ALL]}}
          volumeMounts: [{name: data, mountPath: /data}, {name: tmp, mountPath: /tmp}]
      volumes: [{name: data, emptyDir: {}}, {name: tmp, emptyDir: {}}]
---
apiVersion: v1
kind: Service
metadata: {name: offsite-s3, namespace: ${offsite_ns}}
spec:
  selector: {app: offsite-s3}
  ports: [{name: s3, port: 9000, targetPort: s3}]
---
apiVersion: batch/v1
kind: Job
metadata: {name: offsite-bucket, namespace: ${offsite_ns}}
spec:
  backoffLimit: 20
  template:
    spec:
      restartPolicy: OnFailure
      automountServiceAccountToken: false
      securityContext: {runAsNonRoot: true, runAsUser: 1000, seccompProfile: {type: RuntimeDefault}}
      containers:
        - name: mc
          image: ${mc_image}
          command: [/bin/sh, -ec]
          args: ['mc --config-dir /tmp/mc alias set s3 http://offsite-s3:9000 "\$K" "\$S" && mc --config-dir /tmp/mc mb --ignore-existing s3/grounded-backups']
          env:
            - {name: K, valueFrom: {secretKeyRef: {name: offsite-s3, key: access_key}}}
            - {name: S, valueFrom: {secretKeyRef: {name: offsite-s3, key: secret_key}}}
          securityContext: {allowPrivilegeEscalation: false, capabilities: {drop: [ALL]}}
          volumeMounts: [{name: tmp, mountPath: /tmp}]
      volumes: [{name: tmp, emptyDir: {}}]
EOF
kc create secret generic grounded-backup-s3 --from-literal=access_key="$off_key" --from-literal=secret_key="$off_secret" >/dev/null

# The backup targets, as an operator would set them in the overlay.
overlay="$(mktemp -d "${kind_root}/.tmp.XXXXXX")"
cat >"${overlay}/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../test/load
patches:
  - patch: |-
      apiVersion: v1
      kind: ConfigMap
      metadata: {name: grounded-postgres-backup, namespace: ${ns}}
      data:
        UPLOAD_S3_ENDPOINT: http://offsite-s3.${offsite_ns}:9000
        UPLOAD_S3_BUCKET: grounded-backups
        UPLOAD_S3_PREFIX: grounded/postgres
  - patch: |-
      apiVersion: v1
      kind: ConfigMap
      metadata: {name: grounded-objects-backup, namespace: ${ns}}
      data:
        UPLOAD_S3_ENDPOINT: http://offsite-s3.${offsite_ns}:9000
        UPLOAD_S3_BUCKET: grounded-backups
        UPLOAD_S3_PREFIX: grounded/objects
EOF
"$KUSTOMIZE" build "$overlay" >"${results}/manifests.yaml"
rm -rf "$overlay"
kc apply -f "${results}/manifests.yaml" >/dev/null
kubectl --kubeconfig "$kubeconfig" --context "kind-${cluster}" -n "$offsite_ns" wait --for=condition=complete job/offsite-bucket --timeout=300s >/dev/null
kind_wait
echo "--- waiting for the demo's go.dev crawl"
kind_wait_indexed 900
forward_api
sign_in

echo "--- more data: an API key, uploads, a conversation"
key_json="$(http POST /v1/teams/demo/api-keys '{"name":"restore rehearsal","kind":"service","scopes":["query","ingest"]}')"
api_key="$(printf '%s' "$key_json" | field secret)"
kb="$(http GET /v1/teams/demo/kbs '' | field id)"
need "API key" "$api_key"
need "KB" "$kb"
src="$(http POST /v1/teams/demo/sources '{"name":"Rehearsal uploads","type":"upload","classification":"open"}' | field id)"
need "upload source" "$src"
for i in 1 2 3 4 5; do
  printf '# Rehearsal note %s\n\nThe restore rehearsal uploaded note %s about goroutines and channels.\n' "$i" "$i" >"${results}/note-${i}.md"
done
http POST "/v1/teams/demo/sources/${src}/documents" '' -f \
  -F "files=@${results}/note-1.md" -F "files=@${results}/note-2.md" -F "files=@${results}/note-3.md" \
  -F "files=@${results}/note-4.md" -F "files=@${results}/note-5.md" >/dev/null
http PUT "/v1/teams/demo/kbs/${kb}/sources/${src}" '' -f >/dev/null
kind_wait_indexed 300
chat="$(http POST /v1/agents/demo/go-docs/chat '{"message":"How do I install Go?","stream":false}')"
conversation="$(printf '%s' "$chat" | field conversationId)"
[ -n "$conversation" ] || { echo "chat failed: ${chat:0:300}" >&2; exit 1; }
retrieve() {
  curl -sS --retry 5 --retry-all-errors -X POST -H "Authorization: Bearer ${api_key}" -H 'Content-Type: application/json' \
    --data '{"query":"How do I install Go?","topK":5}' "http://127.0.0.1:${api}/v1/teams/demo/kbs/${kb}/retrieve"
}
top_before="$(retrieve | field chunkId)"
need "retrieval hit before the backup" "$top_before"

# --- 2. back up --------------------------------------------------------------

step "backup: pg_dump CronJob (with the off-site copy)"
cronjob_now grounded-postgres-backup rehearsal-pg-backup
done_step "backup_pgdump"
step "backup: objects CronJob"
cronjob_now grounded-objects-backup rehearsal-objects-backup
done_step "backup_objects"
fingerprint >"${results}/fingerprint-before.txt"
echo "embeddings | $(embeddings)" >>"${results}/fingerprint-before.txt"
blob_keys >"${results}/blob-keys-before.txt"
bucket_list >"${results}/bucket-before.txt"
echo "    before: $(tr '\n' ' ' <"${results}/fingerprint-before.txt")"
echo "    bucket: $(wc -l <"${results}/bucket-before.txt" | tr -d ' ') objects; dump: $(grep -o 'grounded-[0-9TZ]*\.dump ([^)]*)' "${results}/rehearsal-pg-backup.log" | head -n 1)"

# --- 3. disaster -------------------------------------------------------------

# The restore reads the dump and the files from the off-site server (another
# namespace), never from what the disaster destroys: check they are there.
dump="$(grep -o 'grounded-[0-9TZ]*\.dump' "${results}/rehearsal-pg-backup.log" | head -n 1)"
need "dump name in the backup log" "$dump"
bucket_list 'rclone --config "" lsf o:grounded-backups/grounded/postgres' | grep -qx "$dump" ||
  { echo "FAIL: ${dump} is not on the off-site target; refusing to destroy the only copy" >&2; exit 1; }
offsite_objects="$(bucket_list 'rclone --config "" lsf -R --files-only o:grounded-backups/grounded/objects/current' | wc -l | tr -d ' ')"
[ "$offsite_objects" = "$(wc -l <"${results}/bucket-before.txt" | tr -d ' ')" ] ||
  { echo "FAIL: the off-site objects copy has ${offsite_objects} files" >&2; exit 1; }
echo "    off-site: ${dump} and ${offsite_objects} objects"

echo "--- disaster: Postgres (StatefulSet, data PVC, backups PVC) and the bucket's contents are gone"
# Pods of finished backup Jobs still hold the backups PVC (pvc-protection).
for j in $(kc get jobs -o name | sed 's|^job.batch/||'); do
  case "$j" in grounded-smoke-s3-bucket) ;; *) delete_job "$j" ;; esac
done
kc delete statefulset grounded-postgres --wait=true --timeout=180s >/dev/null
if ! kc delete pvc data-grounded-postgres-0 grounded-postgres-backups --wait=true --timeout=180s >/dev/null; then
  echo "FAIL: PVCs not deleted; still used by:" >&2
  kc get pods -o json | grep -o '"claimName": *"[^"]*"' | sort | uniq -c >&2 || true
  kc get pvc >&2
  exit 1
fi
bucket_list 'rclone --config "" purge s:grounded && rclone --config "" mkdir s:grounded && echo emptied' >/dev/null
[ "$(bucket_list | wc -l | tr -d ' ')" = 0 ] || { echo "the bucket is not empty" >&2; exit 1; }
t_disaster=$(date +%s)

# --- 4. restore (docs/operations/restore.md) ---------------------------------

step "restore 1: stop the app and the backups"
kc patch cronjob grounded-postgres-backup -p '{"spec":{"suspend":true}}' >/dev/null
kc patch cronjob grounded-objects-backup -p '{"spec":{"suspend":true}}' >/dev/null
kc scale deployment grounded-api grounded-worker grounded-fake-models --replicas=0 >/dev/null
kc wait --for=delete pod -l app.kubernetes.io/component=api --timeout=300s >/dev/null 2>&1 || true
kc wait --for=delete pod -l app.kubernetes.io/component=worker --timeout=300s >/dev/null 2>&1 || true
done_step "stop_app"

step "restore 2: recreate Postgres (empty)"
kc apply -f "${results}/manifests.yaml" -l app.kubernetes.io/component=postgres >/dev/null
kc rollout status statefulset/grounded-postgres --timeout=600s >/dev/null
done_step "recreate_postgres"

step "restore 3: pg_restore the newest off-site dump"
run_job grounded-pg-restore "${kind_root}/restore/pg-restore-offsite.yaml"
done_step "pg_restore"

step "restore 4: copy the bucket back from the off-site copy"
kc create configmap grounded-restore --from-literal=S3_ENDPOINT=http://grounded-smoke-s3:9000 --from-literal=S3_BUCKET=grounded \
  --dry-run=client -o yaml | kc apply -f - >/dev/null
run_job grounded-objects-restore "${kind_root}/restore/objects-restore.yaml"
done_step "objects_restore"

step "restore 5: start the app (re-apply the manifests)"
kc delete configmap grounded-restore --timeout=60s >/dev/null
kc apply -f "${results}/manifests.yaml" >/dev/null
kc rollout status deployment/grounded-api --timeout=600s >/dev/null
kc rollout status deployment/grounded-worker --timeout=600s >/dev/null
kc rollout status deployment/grounded-fake-models --timeout=600s >/dev/null
done_step "start_app"

step "restore 6: verify"
kc exec deploy/grounded-api -c api -- /grounded doctor >"${results}/doctor.txt" 2>&1 || { cat "${results}/doctor.txt"; exit 1; }
fingerprint >"${results}/fingerprint-after.txt"
echo "embeddings | $(embeddings)" >>"${results}/fingerprint-after.txt"
diff "${results}/fingerprint-before.txt" "${results}/fingerprint-after.txt" || { echo "FAIL: row counts differ" >&2; exit 1; }
blob_keys >"${results}/blob-keys-after.txt"
bucket_list >"${results}/bucket-after.txt"
diff -q "${results}/bucket-before.txt" "${results}/bucket-after.txt" >/dev/null || { echo "FAIL: bucket listing differs" >&2; exit 1; }
missing="$(comm -23 "${results}/blob-keys-after.txt" "${results}/bucket-after.txt" | wc -l | tr -d ' ')"
[ "$missing" = 0 ] || { echo "FAIL: ${missing} document files missing from the bucket" >&2; exit 1; }
forward_api
top_after="$(retrieve | field chunkId)"
[ -n "$top_after" ] && [ "$top_after" = "$top_before" ] || { echo "FAIL: retrieval top hit ${top_after} != ${top_before}" >&2; exit 1; }
# The session made before the backup is in the restored database.
http GET "/v1/conversations/${conversation}" '' | grep -q "How do I install Go?" || { echo "FAIL: the old conversation" >&2; exit 1; }
answer="$(http POST /v1/agents/demo/go-docs/chat '{"message":"What is a goroutine?","stream":false}')"
printf '%s' "$answer" | grep -q '"citations":\[{' || { echo "FAIL: new chat: ${answer:0:300}" >&2; exit 1; }
done_step "verify"
t_restored=$(date +%s)

# --- report ------------------------------------------------------------------

{
  echo "# Restore rehearsal $(date -u +%Y-%m-%dT%H:%MZ)"
  echo
  echo "- commit $(git -C "$kind_repo" rev-parse --short HEAD); host $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), docker $(docker info --format '{{.NCPU}} CPUs, {{.MemTotal}} bytes' 2>/dev/null)"
  echo "- data: $(tr '\n' ';' <"${results}/fingerprint-before.txt" | sed 's/ | /=/g; s/;/, /g')"
  echo "- bucket: $(wc -l <"${results}/bucket-before.txt" | tr -d ' ') objects; dump: $(grep -o 'grounded-[0-9TZ]*\.dump ([^)]*)' "${results}/rehearsal-pg-backup.log" | head -n 1)"
  echo
  echo "| step | seconds |"
  echo "|---|---:|"
  for i in "${!step_names[@]}"; do echo "| ${step_names[$i]} | ${step_secs[$i]} |"; done
  echo "| **restore total (stop the app to verified)** | **$((t_restored - t_disaster))** |"
  echo
  echo "Verified: grounded doctor passed; row counts and embeddings equal; the bucket listing equal; every document's original and parsed text present (${missing} missing); retrieval with the pre-backup API key returns the same top hit; the pre-backup session reads its conversation; a new chat answers with citations."
} | tee "${results}/report.md"
