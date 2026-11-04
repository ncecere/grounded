#!/usr/bin/env bash
# Local lifecycle check of the generated Helm chart (#31) on a throwaway kind cluster. Needs Docker, the pinned tools
# (install-tools.sh and install-lifecycle-tools.sh, in bin/helm-tools), openssl and python3; pulls public images
# (pgvector, valkey, silo and mc as the CI's S3, nginx) and the v0.7.0 app image, and adds only a throwaway fixture CA.
# Datastores live in another namespace and are selected by namespace + pod labels (the part never proven live).
# Steps: install (1 API, 1 worker) -> readiness + doctor in api and worker -> SQL marker -> values upgrade
# (2/2, new appURL) -> rollback to revision 1 -> marker still there -> negative policy control (wrong pod
# labels: doctor fails) -> restore (doctor passes) -> uninstall. Always deletes the cluster and registry.
set -euo pipefail
WT=$(git rev-parse --show-toplevel)
T=$WT/bin/helm-tools
export PATH=$T:$PATH
W=$(mktemp -d)
CL=g31
export KUBECONFIG=$W/kubeconfig
NS=grounded-g31
DS=datastores
REG=g31-registry
log() { printf '\n=== %s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
cleanup() {
  status=$?
  if [ "$status" != 0 ]; then
    log "failure diagnostics"
    kubectl get pods -A -o wide 2>/dev/null | grep -v kube-system || true
    for ns in datastores grounded-g31; do
      for p in $(kubectl -n "$ns" get pods -o name 2>/dev/null); do
        echo "--- $ns $p"; kubectl -n "$ns" describe "$p" 2>/dev/null | tail -15; kubectl -n "$ns" logs "$p" --all-containers --tail=30 2>/dev/null
      done
    done
  fi
  log "cleanup (exit $status)"
  kind delete cluster --name "$CL" >/dev/null 2>&1 || true
  docker rm -f "$REG" >/dev/null 2>&1 || true
  rm -rf "$W"
  exit "$status"
}
trap cleanup EXIT
cd "$W"

log "certificates"
rm -rf certs && mkdir certs && cd certs
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=g31-fixture-ca" -keyout ca.key -out ca.crt 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=minio.$DS.svc.cluster.local" -keyout private.key -out s.csr 2>/dev/null
printf 'subjectAltName=DNS:minio.%s.svc.cluster.local,DNS:minio.%s.svc,DNS:minio\n' "$DS" "$DS" > ext
openssl x509 -req -in s.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -extfile ext -out public.crt 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=idp.$DS.svc.cluster.local" -keyout idp.key -out idp.csr 2>/dev/null
printf 'subjectAltName=DNS:idp.%s.svc.cluster.local\n' "$DS" > idpext
openssl x509 -req -in idp.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -extfile idpext -out idp.crt 2>/dev/null
cd "$W"

log "app image trusting the fixture CA (v0.7.0 + CA only)"
docker pull -q ghcr.io/ncecere/grounded:v0.7.0 >/dev/null
cid=$(docker create ghcr.io/ncecere/grounded:v0.7.0)
rm -f bundle.crt
docker cp "$cid:/etc/ssl/certs/ca-certificates.crt" - | tar -xO > bundle.crt
docker rm "$cid" >/dev/null
cat certs/ca.crt >> bundle.crt
printf 'FROM ghcr.io/ncecere/grounded:v0.7.0\nCOPY bundle.crt /etc/ssl/certs/ca-certificates.crt\n' > Dockerfile
docker build -q -t localhost:5001/grounded:g31 . >/dev/null

log "registry and kind cluster"
docker rm -f "$REG" >/dev/null 2>&1 || true
docker run -d --restart=no --name "$REG" -p 127.0.0.1:5001:5000 registry:2 >/dev/null
cat > kind.yaml <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
containerdConfigPatches:
- |-
  [plugins."io.containerd.grpc.v1.cri".registry]
    config_path = "/etc/containerd/certs.d"
EOF
kind create cluster --name "$CL" --config kind.yaml --kubeconfig "$KUBECONFIG" --wait 120s
docker network connect kind "$REG" 2>/dev/null || true
for node in $(kind get nodes --name "$CL"); do
  docker exec "$node" mkdir -p /etc/containerd/certs.d/localhost:5001
  printf '[host."http://%s:5000"]\n' "$REG" | docker exec -i "$node" cp /dev/stdin /etc/containerd/certs.d/localhost:5001/hosts.toml
done
docker push -q localhost:5001/grounded:g31 >/dev/null
DIGEST=$(docker inspect --format '{{index .RepoDigests 0}}' localhost:5001/grounded:g31 | cut -d@ -f2)
APP_IMAGE="localhost:5001/grounded@$DIGEST"
echo "app image: $APP_IMAGE"
kubectl get nodes
# Fixture images through the local registry too (kind load fails on multi-platform images here).
for img in nginx:alpine pgvector/pgvector:pg17 valkey/valkey:8-alpine pgsty/silo:RELEASE.2026-09-16T00-00-00Z pgsty/mc:RELEASE.2026-09-16T00-00-00Z; do
  docker pull -q --platform linux/amd64 "$img" >/dev/null
  docker tag "$img" "localhost:5001/$img"
  docker push -q "localhost:5001/$img" >/dev/null
done

log "datastores in namespace $DS (selected by labels, not names)"
kubectl create namespace "$DS"
# A minimal OIDC discovery document over TLS: doctor checks discovery; nobody signs in here.
I="https://idp.$DS.svc.cluster.local"
printf '{"issuer":"%s","authorization_endpoint":"%s/authorize","token_endpoint":"%s/token","jwks_uri":"%s/jwks","response_types_supported":["code"],"subject_types_supported":["public"],"id_token_signing_alg_values_supported":["RS256"]}' "$I" "$I" "$I" "$I" > discovery.json
openssl genrsa -out certs/jwk.key 2048 2>/dev/null
MOD=$(openssl rsa -in certs/jwk.key -noout -modulus | cut -d= -f2)
N=$(python3 -c "import base64,sys;print(base64.urlsafe_b64encode(bytes.fromhex(sys.argv[1])).rstrip(b'=').decode())" "$MOD")
printf '{"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"g31","n":"%s","e":"AQAB"}]}' "$N" > jwks.json
cat > nginx.conf <<'NGX'
server {
  listen 443 ssl;
  ssl_certificate /tls/idp.crt;
  ssl_certificate_key /tls/idp.key;
  location = /.well-known/openid-configuration { default_type application/json; alias /doc/discovery.json; }
  location = /jwks { default_type application/json; alias /doc/jwks.json; }
}
NGX
kubectl -n "$DS" create secret generic idp-tls --from-file=idp.crt=certs/idp.crt --from-file=idp.key=certs/idp.key
kubectl -n "$DS" create configmap idp-doc --from-file=discovery.json --from-file=jwks.json --from-file=default.conf=nginx.conf
kubectl -n "$DS" create secret generic minio-certs --from-file=public.crt=certs/public.crt --from-file=private.key=certs/private.key
kubectl -n "$DS" apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata: {name: postgres}
spec:
  selector: {matchLabels: {app: pg-g31}}
  template:
    metadata: {labels: {app: pg-g31}}
    spec:
      containers:
      - name: postgres
        image: localhost:5001/pgvector/pgvector:pg17
        env: [{name: POSTGRES_PASSWORD, value: g31-only}, {name: POSTGRES_DB, value: grounded}]
        ports: [{containerPort: 5432}]
        readinessProbe: {exec: {command: [pg_isready, -U, postgres]}, periodSeconds: 3}
---
apiVersion: v1
kind: Service
metadata: {name: postgres}
spec: {selector: {app: pg-g31}, ports: [{port: 5432}]}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: valkey}
spec:
  selector: {matchLabels: {app: vk-g31}}
  template:
    metadata: {labels: {app: vk-g31}}
    spec:
      containers:
      - name: valkey
        image: localhost:5001/valkey/valkey:8-alpine
        args: [valkey-server, --requirepass, g31-only]
        ports: [{containerPort: 6379}]
---
apiVersion: v1
kind: Service
metadata: {name: valkey}
spec: {selector: {app: vk-g31}, ports: [{port: 6379}]}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: minio}
spec:
  selector: {matchLabels: {app: minio}}
  template:
    metadata: {labels: {app: minio}}
    spec:
      containers:
      - name: minio
        image: localhost:5001/pgsty/silo:RELEASE.2026-09-16T00-00-00Z
        args: [server, /data, --certs-dir, /certs]
        env: [{name: MINIO_ROOT_USER, value: g31access}, {name: MINIO_ROOT_PASSWORD, value: g31-secret-only}]
        ports: [{containerPort: 9000}]
        volumeMounts: [{name: certs, mountPath: /certs}]
      volumes: [{name: certs, secret: {secretName: minio-certs}}]
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: idp}
spec:
  selector: {matchLabels: {app: idp}}
  template:
    metadata: {labels: {app: idp}}
    spec:
      containers:
      - name: nginx
        image: localhost:5001/nginx:alpine
        ports: [{containerPort: 443}]
        volumeMounts:
        - {name: tls, mountPath: /tls}
        - {name: doc, mountPath: /doc}
        - {name: doc, mountPath: /etc/nginx/conf.d/default.conf, subPath: default.conf}
      volumes:
      - {name: tls, secret: {secretName: idp-tls}}
      - {name: doc, configMap: {name: idp-doc}}
---
apiVersion: v1
kind: Service
metadata: {name: idp}
spec: {selector: {app: idp}, ports: [{port: 443}]}
---
apiVersion: v1
kind: Service
metadata: {name: minio}
spec: {selector: {app: minio}, ports: [{port: 9000}]}
EOF
kubectl -n "$DS" rollout status deploy/postgres deploy/valkey deploy/minio deploy/idp --timeout=240s
kubectl -n "$DS" run mkbucket --rm -i --restart=Never --image=localhost:5001/pgsty/mc:RELEASE.2026-09-16T00-00-00Z --command -- sh -c \
  'mc --insecure alias set s https://minio:9000 g31access g31-secret-only && mc --insecure mb -p s/grounded' 

log "grounded namespace, secrets (generated here, never printed)"
kubectl create namespace "$NS"
kubectl label namespace "$NS" pod-security.kubernetes.io/enforce=restricted
kubectl -n "$NS" create secret generic grounded-runtime \
  --from-literal=DATABASE_URL="postgres://postgres:g31-only@postgres.$DS.svc.cluster.local:5432/grounded?sslmode=disable" \
  --from-literal=VALKEY_URL="redis://:g31-only@valkey.$DS.svc.cluster.local:6379/0" \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  --from-literal=API_KEY_PEPPER="$(openssl rand -base64 32)" \
  --from-literal=OIDC_ISSUER="https://idp.$DS.svc.cluster.local" \
  --from-literal=OIDC_CLIENT_ID=g31 --from-literal=OIDC_CLIENT_SECRET="$(openssl rand -hex 16)"
kubectl -n "$NS" create secret generic grounded-s3 --from-literal=access_key=g31access --from-literal=secret_key=g31-secret-only

values() { # $1 replicas, $2 appURL, $3 postgres pod label
cat > values.yaml <<EOF
appImage: "$APP_IMAGE"
ocrImage: "ghcr.io/ncecere/grounded-ocr@sha256:0000000000000000000000000000000000000000000000000000000000000000"
runtimeSecret: grounded-runtime
s3Secret: grounded-s3
smtpSecret: grounded-smtp
appURL: $2
s3Endpoint: https://minio.$DS.svc.cluster.local:9000
s3Bucket: grounded
postgres: external
valkey: external
apiReplicas: $1
workerReplicas: $1
ocrReplicas: 1
ocr: false
ingress: false
ingressHost: grounded.example.org
ingressClass: ""
ingressNamespace: ingress-controller
tlsSecret: ""
tracing: false
tracingEndpoint: http://tempo.monitoring.svc:4318
tracingNamespace: monitoring
tracingSample: "0.2"
monitoring: false
monitoringNamespace: monitoring
postgresDestination: {host: postgres.$DS.svc.cluster.local, port: 5432, namespace: $DS, podLabels: {app: $3}}
valkeyDestination: {host: valkey.$DS.svc.cluster.local, port: 6379, namespace: $DS, podLabels: {app: vk-g31}}
EOF
}
doctor() { # $1 deployment
  kubectl -n "$NS" exec "deploy/$1" -c "${1#grounded-}" -- /grounded doctor
}
check() {
  kubectl -n "$NS" rollout status deploy/grounded-api deploy/grounded-worker --timeout=300s
  echo "--- doctor in api"; doctor grounded-api
  echo "--- doctor in worker"; doctor grounded-worker
}
psql() { kubectl -n "$DS" exec deploy/postgres -- psql -U postgres -d grounded -tAc "$1"; }

log "helm install (1 API, 1 worker)"
values 1 https://grounded.example.org pg-g31
helm lint "$WT/deploy/helm/grounded" --strict -f values.yaml
helm install grounded "$WT/deploy/helm/grounded" -n "$NS" -f values.yaml --wait --timeout 10m
kubectl -n "$NS" get pods -o wide
check
psql "CREATE TABLE IF NOT EXISTS g31_marker(v text); INSERT INTO g31_marker VALUES ('kept');"
echo "schema version: $(psql 'SELECT max(version_id) FROM goose_db_version' 2>/dev/null || echo n/a)"

log "values upgrade (2 API, 2 workers, new appURL)"
values 2 https://grounded2.example.org pg-g31
helm upgrade grounded "$WT/deploy/helm/grounded" -n "$NS" -f values.yaml --wait --timeout 10m
kubectl -n "$NS" get deploy
check
kubectl -n "$NS" get configmap -o name | grep -c grounded

log "rollback to revision 1"
helm rollback grounded 1 -n "$NS" --wait --timeout 10m
helm history grounded -n "$NS"
kubectl -n "$NS" get deploy
check
echo "marker after rollback: $(psql 'SELECT v FROM g31_marker')"

log "negative control: Postgres destination pod labels that match nothing"
values 1 https://grounded.example.org pg-wrong
helm upgrade grounded "$WT/deploy/helm/grounded" -n "$NS" -f values.yaml --timeout 2m || true
sleep 15
kubectl -n "$NS" get networkpolicy -o name
if kubectl -n "$NS" exec deploy/grounded-api -c api -- /grounded doctor 2>&1 | tee neg.txt; then
  echo "NEGATIVE CONTROL FAILED: doctor passed with a wrong Postgres pod label"; exit 1
fi
grep -i -m3 'postgres\|database' neg.txt || true
echo "negative control ok: doctor fails while the policy names the wrong pods"

log "restore"
values 1 https://grounded.example.org pg-g31
helm upgrade grounded "$WT/deploy/helm/grounded" -n "$NS" -f values.yaml --wait --timeout 10m
check

log "uninstall"
helm uninstall grounded -n "$NS" --wait
kubectl -n "$NS" get all 2>&1 | head -5
echo "marker after uninstall (external DB untouched): $(psql 'SELECT v FROM g31_marker')"
log "ALL STEPS PASSED"
