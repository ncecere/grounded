# Shared by deploy/loadtest/run.sh and restore-rehearsal.sh: a throwaway
# kind cluster running test/load (the example-small shape plus the fake
# model gateway), with a kubeconfig of its own. Source it, then call
# kind_up; kind_down runs from the caller's EXIT trap.
#
# Like kind-smoke.sh, every kubectl call names the temporary kubeconfig and
# the kind context: ~/.kube/config and its current context are never read or
# changed. KEEP=1 keeps the cluster.
#
# Needs docker, kind, kubectl, kustomize (KIND, KUSTOMIZE override), openssl.

kind_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kind_repo="$(cd "${kind_root}/../.." && pwd)"
KIND="${KIND:-kind}"
KUSTOMIZE="${KUSTOMIZE:-kustomize}"
cluster="${CLUSTER:-grounded-load}"
ns=grounded-smoke
image=grounded:load
kubeconfig="${KUBECONFIG_FILE:-$(mktemp -t "${cluster}-kubeconfig.XXXXXX")}"

# kc runs kubectl against the throwaway cluster only.
kc() {
  [ -s "$kubeconfig" ] && grep -q "current-context: kind-${cluster}\$" "$kubeconfig" ||
    { echo "refusing kubectl: ${kubeconfig} is not the kind-${cluster} kubeconfig" >&2; return 1; }
  kubectl --kubeconfig "$kubeconfig" --context "kind-${cluster}" --namespace "$ns" "$@"
}

# psql_q runs SQL in the cluster's Postgres (unaligned, " | " separated).
psql_q() {
  kc exec -i statefulset/grounded-postgres -c postgres -- psql -X -q -v ON_ERROR_STOP=1 -U grounded -d grounded -At -F ' | ' "$@"
}

kind_diagnostics() {
  echo "--- failure diagnostics"
  kc get pods,jobs,pvc -o wide || true
  kc get events --sort-by=.lastTimestamp | tail -n 30 || true
  for d in grounded-api grounded-worker grounded-fake-models; do kc logs "deploy/${d}" --all-containers --tail=40 || true; done
}

kind_down() {
  if [ "${KEEP:-0}" = 1 ]; then
    echo "kept cluster ${cluster}; kubeconfig: ${kubeconfig}"
    echo "delete it with: ${KIND} delete cluster --name ${cluster}"
  else
    "$KIND" delete cluster --name "$cluster" --kubeconfig "$kubeconfig" >/dev/null 2>&1 || true
    rm -f "$kubeconfig"
  fi
}

# kind_build builds grounded:load from the working tree.
kind_build() {
  echo "--- building ${image}"
  docker build -q --build-arg VERSION=load --build-arg COMMIT="$(git -C "$kind_repo" rev-parse --short HEAD)" -t "$image" "$kind_repo" >/dev/null
}

# kind_create creates the cluster (one node; kind's default CNI enforces
# NetworkPolicies) and loads the image.
kind_create() {
  if "$KIND" get clusters 2>/dev/null | grep -qx "$cluster"; then
    echo "a kind cluster named ${cluster} already exists; delete it or set CLUSTER" >&2
    return 1
  fi
  echo "--- creating kind cluster ${cluster}"
  "$KIND" create cluster --name "$cluster" --kubeconfig "$kubeconfig" --wait 180s
  "$KIND" load docker-image "$image" --name "$cluster"
}

# kind_secrets creates the namespace and random dev-only secrets.
kind_secrets() {
  kc apply -f "${kind_root}/test/kind/namespace.yaml" >/dev/null
  local pg valkey
  pg="$(openssl rand -hex 24)"
  valkey="$(openssl rand -hex 24)"
  kc create secret generic grounded-runtime \
    --from-literal=ENCRYPTION_KEY="$(openssl rand -base64 32)" \
    --from-literal=API_KEY_PEPPER="$(openssl rand -base64 32)" \
    --from-literal=POSTGRES_PASSWORD="$pg" \
    --from-literal=DATABASE_URL="postgres://grounded:${pg}@grounded-postgres:5432/grounded?sslmode=disable" \
    --from-literal=VALKEY_PASSWORD="$valkey" \
    --from-literal=VALKEY_URL="redis://:${valkey}@grounded-valkey:6379/0" >/dev/null
  kc create secret generic grounded-s3 \
    --from-literal=access_key="load$(openssl rand -hex 6)" \
    --from-literal=secret_key="$(openssl rand -hex 24)" >/dev/null
}

# kind_apply renders and applies test/load (or $1).
kind_apply() {
  "$KUSTOMIZE" build "${1:-${kind_root}/test/load}" | kc apply -f - >/dev/null
}

# kind_wait waits until everything in test/load is ready and the demo is
# seeded.
kind_wait() {
  echo "--- waiting for readiness"
  kc wait --for=condition=complete job/grounded-smoke-s3-bucket --timeout=300s >/dev/null
  kc rollout status statefulset/grounded-postgres --timeout=300s
  kc rollout status statefulset/grounded-valkey --timeout=300s
  kc rollout status deployment/grounded-api --timeout=300s
  kc rollout status deployment/grounded-worker --timeout=300s
  kc rollout status deployment/grounded-fake-models --timeout=300s
  kind_wait_seeded
}

# kind_wait_seeded waits for `grounded demo` to print that it serves.
kind_wait_seeded() {
  for _ in $(seq 1 90); do
    if kc logs deploy/grounded-fake-models 2>/dev/null | grep -q "Serving the fake model gateway"; then
      return 0
    fi
    sleep 2
  done
  echo "grounded demo did not finish seeding" >&2
  kc logs deploy/grounded-fake-models --tail=40 >&2 || true
  return 1
}

# kind_wait_indexed waits (up to $1 seconds, default 900) until no crawl is
# queued or running and no document waits: the demo's go.dev crawl done.
kind_wait_indexed() {
  local busy
  for _ in $(seq 1 $((${1:-900} / 5))); do
    busy="$(psql_q -c "SELECT (SELECT count(*) FROM web_crawls WHERE status IN ('queued', 'running'))
      + (SELECT count(*) FROM documents WHERE status IN ('pending', 'queued', 'processing'))" 2>/dev/null || echo 1)"
    [ "$busy" = 0 ] && return 0
    sleep 5
  done
  echo "warning: crawls or documents still in progress" >&2
}

# kind_word_delay sets the fake gateway's pause between answer words.
kind_word_delay() {
  kc set env deployment/grounded-fake-models DEMO_FAKE_WORD_DELAY="$1" >/dev/null
  kc rollout status deployment/grounded-fake-models --timeout=180s >/dev/null
  kind_wait_seeded
}

# kind_metrics_server installs metrics-server (for kubectl top); best effort.
METRICS_SERVER_VERSION="${METRICS_SERVER_VERSION:-v0.8.0}"
kind_metrics_server() {
  kubectl --kubeconfig "$kubeconfig" --context "kind-${cluster}" apply \
    -f "https://github.com/kubernetes-sigs/metrics-server/releases/download/${METRICS_SERVER_VERSION}/components.yaml" >/dev/null &&
    kubectl --kubeconfig "$kubeconfig" --context "kind-${cluster}" -n kube-system patch deployment metrics-server --type=json \
      -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' >/dev/null &&
    kubectl --kubeconfig "$kubeconfig" --context "kind-${cluster}" -n kube-system rollout status deployment/metrics-server --timeout=180s >/dev/null ||
    { echo "metrics-server unavailable: no per-pod CPU figures" >&2; return 0; }
}

# kind_url is the API's base URL from containers on the kind network.
kind_url() { echo "http://${cluster}-control-plane:30080"; }
