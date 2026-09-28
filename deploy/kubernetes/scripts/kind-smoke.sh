#!/usr/bin/env bash
# End-to-end smoke test of the manifests on a throwaway kind cluster:
# builds the image, deploys test/kind (the example-small shape) with random
# dev-only secrets, waits for everything to become ready, runs the backup
# CronJob once, checks /readyz, /healthz and the UI through port-forwards,
# runs `grounded doctor` in the pods, checks that a configuration change
# rolls the Deployments, then deletes the cluster.
#
# The cluster's kubeconfig lives in a temporary file and every kubectl call
# names it explicitly: your ~/.kube/config and current context are never
# read or changed. KEEP=1 keeps the cluster for debugging.
#
# Needs docker, kind, kubectl, openssl, curl. Used by `make k8s-smoke`.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "${root}/../.." && pwd)"
KIND="${KIND:-kind}"
KUSTOMIZE="${KUSTOMIZE:-kustomize}"
cluster="${CLUSTER:-grounded-smoke}"
ns=grounded-smoke
image=grounded:smoke

kubeconfig="$(mktemp -t grounded-smoke-kubeconfig.XXXXXX)"
pids=()
cleanup() {
  status=$?
  for p in "${pids[@]:-}"; do
    if [ -n "$p" ]; then kill "$p" 2>/dev/null || true; wait "$p" 2>/dev/null || true; fi
  done
  rm -f "${kubeconfig}".pf.*
  if [ -n "${overlay:-}" ]; then rm -rf "$overlay"; fi
  if [ "$status" -ne 0 ] && [ -s "$kubeconfig" ]; then
    echo "--- failure diagnostics"
    kc get pods,jobs,pvc -o wide || true
    kc get events --sort-by=.lastTimestamp | tail -n 30 || true
    for d in grounded-api grounded-worker; do kc logs "deploy/${d}" --all-containers --tail=40 || true; done
  fi
  if [ "${KEEP:-0}" = 1 ]; then
    echo "kept cluster ${cluster}; kubeconfig: ${kubeconfig}"
  else
    "$KIND" delete cluster --name "$cluster" --kubeconfig "$kubeconfig" >/dev/null 2>&1 || true
    rm -f "$kubeconfig"
  fi
  exit "$status"
}
trap cleanup EXIT
# Never fall back to the default kubeconfig: refuse if the temporary one is
# missing or names another cluster.
kc() {
  [ -s "$kubeconfig" ] && grep -q "current-context: kind-${cluster}\$" "$kubeconfig" ||
    { echo "refusing kubectl: ${kubeconfig} is not the kind-${cluster} kubeconfig" >&2; return 1; }
  kubectl --kubeconfig "$kubeconfig" --context "kind-${cluster}" --namespace "$ns" "$@"
}

echo "--- building ${image}"
docker build -q --build-arg VERSION=smoke --build-arg COMMIT="$(git -C "$repo" rev-parse --short HEAD)" -t "$image" "$repo"

echo "--- creating kind cluster ${cluster}"
"$KIND" create cluster --name "$cluster" --kubeconfig "$kubeconfig" --wait 180s
"$KIND" load docker-image "$image" --name "$cluster"

echo "--- namespace and dev-only secrets (random, never real)"
"$KUSTOMIZE" build "${root}/test/kind" >"${kubeconfig}.yaml"
kc apply -f "${root}/test/kind/namespace.yaml"
pg_password="$(openssl rand -hex 24)"
valkey_password="$(openssl rand -hex 24)"
kc create secret generic grounded-runtime \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  --from-literal=API_KEY_PEPPER="$(openssl rand -base64 32)" \
  --from-literal=POSTGRES_PASSWORD="$pg_password" \
  --from-literal=DATABASE_URL="postgres://grounded:${pg_password}@grounded-postgres:5432/grounded?sslmode=disable" \
  --from-literal=VALKEY_PASSWORD="$valkey_password" \
  --from-literal=VALKEY_URL="redis://:${valkey_password}@grounded-valkey:6379/0"
kc create secret generic grounded-s3 \
  --from-literal=access_key="smoke$(openssl rand -hex 6)" \
  --from-literal=secret_key="$(openssl rand -hex 24)"

echo "--- applying test/kind"
kc apply -f "${kubeconfig}.yaml"
rm -f "${kubeconfig}.yaml"

echo "--- waiting for readiness"
kc wait --for=condition=complete job/grounded-smoke-s3-bucket --timeout=300s
kc rollout status statefulset/grounded-postgres --timeout=300s
kc rollout status statefulset/grounded-valkey --timeout=300s
kc rollout status deployment/grounded-api --timeout=300s
kc rollout status deployment/grounded-worker --timeout=300s

echo "--- running the backup CronJob once"
kc create job --from=cronjob/grounded-postgres-backup grounded-smoke-backup
kc wait --for=condition=complete job/grounded-smoke-backup --timeout=300s
kc logs job/grounded-smoke-backup --all-containers

echo "--- checking endpoints through port-forwards"
# kubectl picks free local ports (":80"); read them from its output.
forward() { # target remote-port -> sets fwd_port (no subshell: cleanup kills it)
  local log="${kubeconfig}.pf.$2"
  kc port-forward "$1" ":$2" >"$log" 2>&1 &
  pids+=($!)
  for _ in $(seq 1 30); do
    fwd_port="$(sed -n 's/^Forwarding from 127.0.0.1:\([0-9]*\) .*/\1/p' "$log" | head -n 1)"
    [ -n "$fwd_port" ] && return 0
    sleep 1
  done
  echo "port-forward to $1 failed: $(cat "$log")" >&2
  return 1
}
check() { # name url [grep pattern]
  local body
  body="$(curl -sf --retry 10 --retry-all-errors --retry-delay 1 "$2")" || { echo "FAIL $1: $2" >&2; return 1; }
  if [ -n "${3:-}" ]; then
    grep -qi -- "$3" <<<"$body" || { echo "FAIL $1: no match for $3" >&2; return 1; }
    echo "$1: ok"
  else
    echo "$1: $body"
  fi
}
forward svc/grounded-api 80
api="$fwd_port"
forward svc/grounded-api 9091
apimetrics="$fwd_port"
forward deployment/grounded-worker 9090
worker="$fwd_port"
check "api /readyz" "http://127.0.0.1:${api}/readyz"
check "api /healthz" "http://127.0.0.1:${api}/healthz"
check "api /metrics (METRICS_ADDR)" "http://127.0.0.1:${apimetrics}/metrics" '^# HELP'
# The public listener (what the Ingress serves) must not expose /metrics.
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${api}/metrics")"
if [ "$code" != "404" ]; then echo "FAIL: /metrics on the api listener answered $code, want 404" >&2; exit 1; fi
echo "api /metrics on the public listener: 404 (ok)"
check "web UI" "http://127.0.0.1:${api}/" '<!doctype html'
check "worker /readyz" "http://127.0.0.1:${worker}/readyz"
check "worker /metrics" "http://127.0.0.1:${worker}/metrics" '^# HELP'
rm -f "${kubeconfig}".pf.*

echo "--- grounded doctor in the api and worker pods"
# Exits non-zero if any check fails; warnings (an empty crawl allowlist,
# no SMTP) are expected here.
kc exec deploy/grounded-api -c api -- /grounded doctor
kc exec deploy/grounded-worker -c worker -- /grounded doctor --mode worker --json >/dev/null

echo "--- a ConfigMap change rolls the pods"
before="$(kc get deploy/grounded-api -o jsonpath='{.spec.template.spec.containers[0].envFrom[0].configMapRef.name}')"
# kustomize wants relative paths: the overlay lives next to test/.
overlay="$(mktemp -d "${root}/.tmp.XXXXXX")"
cat >"${overlay}/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../test/kind
configMapGenerator:
  - name: grounded-config
    behavior: merge
    literals:
      - LOG_LEVEL=info
EOF
"$KUSTOMIZE" build "$overlay" | kc apply -f - >/dev/null
rm -rf "$overlay"
kc rollout status deployment/grounded-api --timeout=300s
after="$(kc get deploy/grounded-api -o jsonpath='{.spec.template.spec.containers[0].envFrom[0].configMapRef.name}')"
[ "$before" != "$after" ] || { echo "FAIL: the api still uses ${before} after a configuration change" >&2; exit 1; }
echo "grounded-config: ${before} -> ${after}"

kc get pods -o wide
echo "--- smoke test passed"
