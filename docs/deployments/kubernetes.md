# Deploying Grounded on Kubernetes

Grounded ships a generic Kustomize base, optional components and two example overlays in [`deploy/kubernetes/`](../../deploy/kubernetes). An install writes its own overlay, in its own repository ([ADR-0023](../adr/0023-no-institution-data-in-the-repository.md)), that sets the namespace, pins the image, patches the settings, provides the secrets and picks components.

```
deploy/kubernetes/
  base/                     api + worker Deployments, Services, config.env (grounded-config), PDBs, NetworkPolicies
  components/
    postgres-single/        pgvector Postgres 17 StatefulSet (small installs)
    postgres-cnpg/          CloudNativePG Cluster, 3 instances, WAL archiving + backups (HA)
    valkey-single/          Valkey StatefulSet with a password
    backup-pgdump/          daily pg_dump CronJob, optional off-site S3 copy
    backup-objects/         daily off-site copy of the bucket (rclone sync)
    ingress/                generic Ingress
    tika/                   optional Apache Tika
    ocr-tesseract/          optional OCR sidecar (grounded-ocr, Tesseract)
    monitoring/             ServiceMonitor (Prometheus Operator)
    monitoring-annotations/ prometheus.io/* pod annotations (alternative to monitoring/)
    alerts/                 PrometheusRule with the alert and recording rules
    dashboards/             Grafana dashboards as sidecar ConfigMaps (grafana_dashboard label)
    private-registry/       image pull secret on the ServiceAccount
  overlays/
    example-small/          single Postgres + Valkey, pg_dump backups, Traefik ingress
    example-ha/             CNPG, 3 API replicas one per node, external Valkey, ServiceMonitor
  restore/                  restore Jobs: pg_restore (PVC or off-site), the bucket (docs/operations/restore.md)
  scripts/                  validate.sh, vendor.sh, kind-smoke.sh, restore-rehearsal.sh (make targets below)
  test/kind/                fixture for `make k8s-smoke`
  test/load/                test/kind plus the demo's fake models: `make k8s-load`, `make k8s-restore-rehearsal`
deploy/observability/       Grafana dashboards and Prometheus alert rules (docs/operations/monitoring.md)
```

## Prerequisites

- Kubernetes 1.30 or later (the manifests are validated against the 1.34 schemas), with a CNI that enforces NetworkPolicy.
- `kubectl` 1.27+ or `kustomize` v5.
- An S3-compatible bucket for Grounded's files (documents, parsed text). Postgres backups should go to a *different* storage system.
- An OIDC provider with a confidential client whose redirect URI is `<APP_URL>/auth/callback`.
- An ingress controller (or Gateway) with TLS. `APP_URL` must be https.
- Postgres with pgvector: the `postgres-single` component, the `postgres-cnpg` component (needs the CloudNativePG operator 1.26+ and the Barman Cloud Plugin), or a managed service with the `vector`, `citext`, `btree_gin` and `pg_trgm` extensions available.
- Valkey or a Redis-compatible service: the `valkey-single` component or one endpoint of an HA service (Grounded does not speak the Sentinel protocol).
- Optionally a secrets operator (External Secrets, Sealed Secrets, ...). The base only names secrets.

## Resource names and ports

Overlays patch these names; they are stable.

| Resource | Kind | Ports / notes |
|---|---|---|
| `grounded-api` | Deployment, Service, PDB | containers ports `http` 8080 and `metrics` 9091; Service `http` 80 → 8080 (for the Ingress) and `metrics` 9091 → 9091 (the internal `METRICS_ADDR` listener, never behind the Ingress). Init container `migrate`, container `api`. |
| `grounded-worker` | Deployment, Service (headless), PDB | container `http` 9090 (`/healthz`, `/readyz`, `/metrics` only); Service `metrics` 9090. Init container `migrate`, container `worker`. |
| `grounded-config` | ConfigMap | non-secret settings from `base/config.env`, loaded with `envFrom`; generated as `grounded-config-<hash>` (see [Configuration](#configuration)) |
| `grounded` | ServiceAccount | used by api and worker; no API token mounted |
| `grounded` | Ingress | component `ingress`; backend `grounded-api:http` |
| `grounded-postgres` | StatefulSet + Service (`postgres` 5432) | component `postgres-single`; PVC template `data` (20Gi), so the claim is `data-grounded-postgres-0` |
| `grounded-postgres` | CNPG Cluster | component `postgres-cnpg`; services `grounded-postgres-rw`/`-ro`/`-r`, secret `grounded-postgres-app` |
| `grounded-valkey` | StatefulSet + Service (`valkey` 6379) | component `valkey-single` |
| `grounded-postgres-backup` | CronJob + ConfigMap | component `backup-pgdump`; PVC `grounded-postgres-backups` (20Gi) |
| `grounded-objects-backup` | CronJob + ConfigMap + ServiceAccount | component `backup-objects` |
| `grounded-tika` | Deployment + Service (`http` 9998) | component `tika` |
| `grounded-ocr` | Deployment + Service (`http` 8080) | component `ocr-tesseract` |

Every resource carries `app.kubernetes.io/name: grounded`, `app.kubernetes.io/part-of: grounded` and, per workload, `app.kubernetes.io/component` (`api`, `worker`, `postgres`, `valkey`, `backup`, `tika`, `ocr`). NetworkPolicies select on these labels.

## Secrets

The base references secrets by name only and never contains values. Create them with your secrets operator (an `ExternalSecret` per secret, for example) or by hand.

| Secret | Keys | Used by |
|---|---|---|
| `grounded-runtime` (required) | `ENCRYPTION_KEY`, `API_KEY_PEPPER` (each `openssl rand -base64 32`), `DATABASE_URL`, `VALKEY_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | api, worker and migrate, as environment variables (`envFrom`) |
| | `POSTGRES_PASSWORD` | `postgres-single`, `backup-pgdump` |
| | `VALKEY_PASSWORD` | `valkey-single` |
| `grounded-s3` (required) | `access_key`, `secret_key` | api, worker (mapped to `S3_ACCESS_KEY` and `S3_SECRET_KEY`) |
| `grounded-smtp` (optional) | `SMTP_PASSWORD` and, if the relay needs it, `SMTP_USERNAME` | api, worker (`envFrom`, optional) |
| `grounded-backup-s3` (optional) | `access_key`, `secret_key` | `backup-pgdump` and `backup-objects` off-site copies |
| `grounded-postgres-backup-s3` | `access_key`, `secret_key` | `postgres-cnpg` WAL archive and base backups |
| `grounded-registry` | `.dockerconfigjson` (type `kubernetes.io/dockerconfigjson`) | `private-registry` |

Notes:
- Because `grounded-runtime` is loaded with `envFrom`, any other Grounded setting can live there too (for example `BOOTSTRAP_ADMIN_SUBJECT`, `TURNSTILE_SECRET_KEY`). A key in the secret overrides the same key in `grounded-config`. Keys that aren't Grounded settings (`POSTGRES_PASSWORD`, `VALKEY_PASSWORD`) are harmless.
- `DATABASE_URL` for `postgres-single`: `postgres://grounded:<POSTGRES_PASSWORD>@grounded-postgres:5432/grounded?sslmode=disable`. With `postgres-cnpg`, leave `DATABASE_URL` and `POSTGRES_PASSWORD` out: the component sets `DATABASE_URL` from the operator's `grounded-postgres-app` secret (key `uri`, host `grounded-postgres-rw`).
- `VALKEY_URL` for `valkey-single`: `redis://:<VALKEY_PASSWORD>@grounded-valkey:6379/0`. Use `rediss://` for a TLS endpoint.
- URL-encode passwords inside URLs, or generate them from a URL-safe alphabet (`openssl rand -hex 24`).
- `ENCRYPTION_KEY` encrypts stored connection keys. Losing it makes them unreadable, so back it up in your secrets store. Changing `API_KEY_PEPPER` invalidates every API key unless the old value is kept as `API_KEY_PEPPER_PREVIOUS`. To rotate either, follow [`docs/operations/rotate-keys.md`](../operations/rotate-keys.md): it adds `ENCRYPTION_KEY_PREVIOUS` and `API_KEY_PEPPER_PREVIOUS` to `grounded-runtime` for the duration.
- Grounded refuses to start with the example `ENCRYPTION_KEY` or `API_KEY_PEPPER` from `.env.example` (see [Safety checks](#safety-checks)); generate your own. The example values are still accepted as `ENCRYPTION_KEY_PREVIOUS` and `API_KEY_PEPPER_PREVIOUS`, which is how an install rotates off them.

A development-only example (random values, never reuse them):

```sh
ns=grounded
pg=$(openssl rand -hex 24); vk=$(openssl rand -hex 24)
kubectl -n $ns create secret generic grounded-runtime \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  --from-literal=API_KEY_PEPPER="$(openssl rand -base64 32)" \
  --from-literal=POSTGRES_PASSWORD="$pg" \
  --from-literal=DATABASE_URL="postgres://grounded:$pg@grounded-postgres:5432/grounded?sslmode=disable" \
  --from-literal=VALKEY_PASSWORD="$vk" \
  --from-literal=VALKEY_URL="redis://:$vk@grounded-valkey:6379/0" \
  --from-literal=OIDC_ISSUER=https://idp.example.org \
  --from-literal=OIDC_CLIENT_ID=grounded \
  --from-literal=OIDC_CLIENT_SECRET=change-me
kubectl -n $ns create secret generic grounded-s3 --from-literal=access_key=... --from-literal=secret_key=...
```

## Configuration

`grounded-config` holds the non-secret settings; every setting is described in [`.env.example`](../../.env.example). The base generates it from [`base/config.env`](../../deploy/kubernetes/base/config.env) with a `configMapGenerator`, so its name carries a hash of its content (`grounded-config-<hash>`) and the Deployments reference that name. **A configuration change therefore rolls the api and worker pods**; there is nothing to restart by hand. The base sets:

| Setting | Base value | Overlays usually |
|---|---|---|
| `APP_URL` | `https://grounded.example.org` (placeholder) | set the public origin; it must match the Ingress host |
| `HTTP_ADDR`, `WORKER_HTTP_ADDR`, `METRICS_ADDR` | `:8080`, `:9090`, `:9091` | leave (`METRICS_ADDR` keeps `/metrics` off the port the Ingress serves) |
| `LOG_FORMAT`, `LOG_LEVEL` | `json`, `info` | leave |
| `DEV_AUTH` | `false` | leave (it is refused on a non-loopback `APP_URL`) |
| `BLOB_BACKEND` | `s3` | leave |
| `S3_ENDPOINT` | `https://s3.example.org` (placeholder) | set; for AWS use the regional endpoint |
| `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | `grounded`, `us-east-1`, `true` | set bucket and region |
| `SHUTDOWN_DELAY`, `SHUTDOWN_TIMEOUT` | `10s`, `90s` | raise together with `terminationGracePeriodSeconds` (120s) |

Also commonly set: `OIDC_ALLOWED_EMAIL_DOMAINS`, `OIDC_SCOPES`, `OIDC_GROUPS_CLAIM` (default `groups`, for [SSO group mapping](../operations/sso-groups.md)), `INSTANCE_NAME`, `ORG_NAME`, `UI_LOGO_URL`, `SUPPORT_URL`, `TEAM_REQUEST_URL`, `CRAWL_ALLOWLIST_SEED`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_TLS`/`SMTP_FROM`, and `TRUSTED_PROXIES` (the ingress controller's pod CIDRs, so client IPs are logged and rate-limited correctly).

`MIGRATE_ON_START` is pinned to `false` in the Deployments: migrations run in the `migrate` init container instead.

**Adding or changing keys in an overlay.** Merge them into the generated ConfigMap:

```yaml
configMapGenerator:
  - name: grounded-config
    behavior: merge
    literals:
      - APP_URL=https://grounded.example.org
      - OIDC_ALLOWED_EMAIL_DOMAINS=example.org
    # or: envs: [grounded.env]  (KEY=value lines; values are literal, no quotes)
```

A strategic-merge patch on `grounded-config` (as in the examples) works too: kustomize recomputes the hash after patches. Don't create a ConfigMap named `grounded-config` as a plain resource, and don't set `generatorOptions.disableNameSuffixHash`: the pods would then keep running with the old settings. Secrets are not hashed: after changing `grounded-runtime`, `grounded-s3` or `grounded-smtp`, run `kubectl -n grounded rollout restart deploy/grounded-api deploy/grounded-worker`, or use a reloader your secrets operator provides.

## Safety checks

`grounded api`, `worker`, `serve` and `migrate` refuse to start on a reachable install, meaning any `APP_URL` that isn't a loopback address, when:

- `ENCRYPTION_KEY` or `API_KEY_PEPPER` is the public example value from `.env.example` (only hashes of those values are in the binary). Generate your own with `openssl rand -base64 32`;
- `DEV_AUTH` is on: it lets anyone sign in as a development persona;
- `APP_URL` is `http://`: serve Grounded behind TLS.

`migrate` checks these only when `APP_URL` is set, so a bare `DATABASE_URL=… grounded migrate` still works. The error names each setting and how to fix it; in a pod, `kubectl logs <pod> -c migrate` shows it first, because the init container stops the rollout.

Some settings are allowed but deserve attention. They are logged at startup (`preflight:` at WARN or INFO), shown to platform admins under **Needs attention** on the admin Overview, and printed by `grounded doctor`:

| Code | When |
|---|---|
| `crawl_allowlist_empty` | no crawl allowlist patterns, so no web source can be crawled |
| `public_agents_without_moderation` | public agents are turned on, but the public audience has no moderation provider |
| `smtp_not_configured` | `SMTP_HOST` is empty: notifications are in-app only |
| `oidc_no_domain_restriction` (info) | OIDC is on and `OIDC_ALLOWED_EMAIL_DOMAINS` is empty; fine if the identity provider already limits access |
| `sso_groups_claim_missing` | SSO group mapping rules exist, but no sign-in in the last 30 days carried the `OIDC_GROUPS_CLAIM` claim ([SSO groups](../operations/sso-groups.md)) |

## grounded doctor

`grounded doctor` prints the safety checks and warnings, then checks every dependency with timings: Postgres (version, pgvector, whether migrations are current), Valkey (PING), object storage (writes, reads and deletes a probe object under `doctor/`), the OIDC issuer (discovery document, JWKS, signing algorithms) and each enabled model connection (`GET /models`). It exits 1 if any check fails; warnings don't fail it. The image has no shell and the binary is `/grounded`:

```sh
kubectl -n grounded exec deploy/grounded-api -c api -- /grounded doctor
kubectl -n grounded exec deploy/grounded-worker -c worker -- /grounded doctor --mode worker
kubectl -n grounded exec deploy/grounded-api -c api -- /grounded doctor --json
kubectl -n grounded exec deploy/grounded-api -c api -- /grounded doctor --probe https://ai-gateway.example.org/v1/models
```

- `--mode` picks whose configuration is validated (`api` by default). `--timeout` bounds each check (10s). `--probe URL` (repeatable) times a GET to any URL; any HTTP answer counts as reachable.
- Every HTTP check opens a new connection and prints its phases, for example `DNS 4.02s, connect 3ms, TLS 21ms, first byte 610ms`. The admin **Test connection** and **Test model** buttons show the same phases.
- Failures are named: `certificate not trusted`, `certificate not valid for <host>`, `TLS handshake failed`, `proxy refused the connection`, `connection refused by <host:port>`, `DNS lookup failed for host <name>`, or `timed out after 10s (<phase>; <completed phases>)`.

Sample output, abbreviated (from the kind smoke test, plus a model connection line from an install that has one):

```
ℹ safety production                         APP_URL is loopback (http://localhost:8080): development install, production checks not applied
✓ configuration api                         valid for grounded api
✓ postgres connect                   3.5ms  PostgreSQL 17.11
✓ postgres migrations                       current (version 24)
⚠ warnings smtp_not_configured              Email notifications are off: SMTP_HOST is not set. In-app notifications still work.
✓ valkey PING                        100µs  PONG (average of 3)
✓ storage probe object               3.3ms  s3 bucket grounded at http://grounded-smoke-s3:9000: write, read and delete
✓ models Gateway                     269ms  https://ai-gateway.example.org/v1: GET /models, 12 model(s)
                                            DNS 100ms, connect 25ms, TLS 34ms, first byte 109ms
```

### Slow DNS

If model tests are slow from the cluster but fast from a laptop, look at the phases. When `DNS` takes seconds, the pod's resolver is the cause. With the Kubernetes default `ndots:5`, a name such as `ai-gateway.example.org` is first tried with every search domain (`grounded.svc.cluster.local`, `svc.cluster.local`, `cluster.local`, and any the node adds). Each miss is cheap when CoreDNS answers it: on a kind cluster, `ndots:5` cost 1 to 3 ms per lookup and `ndots:2` under 1 ms, so it isn't worth changing by default. It becomes seconds when those queries leave the cluster to a slow or dropping upstream resolver, or when AAAA queries time out. Then try, in the overlay:

```yaml
patches:
  - target: {kind: Deployment, name: grounded-(api|worker)}
    patch: |-
      - op: add
        path: /spec/template/spec/dnsConfig
        value:
          options:
            - name: ndots
              value: "2"
```

Measure again with `grounded doctor` or a model test before keeping it. Fixing the node's search domains or the upstream resolver helps every workload, not just Grounded. When `connect` or `TLS` is slow instead, look at the network path or an intercepting proxy. When `first byte` dominates, the time is spent in the model gateway or the model.

## Components

Add components in the overlay's `components:` list.

- **`postgres-single`**: `pgvector/pgvector` 17, one replica, a 20Gi PVC, scram-sha-256, UID 999, read-only root filesystem. Patch `volumeClaimTemplates[0].spec` for the size and `storageClassName`. Storage that maps UIDs (NFS with squashing) may need a `runAsUser`/`fsGroup` patch. Not highly available: pair it with `backup-pgdump`.
- **`postgres-cnpg`**: a CloudNativePG `Cluster` of 3 instances with preferred anti-affinity, the "standard" image (includes pgvector), the four extensions created by `postInitApplicationSQL`, WAL archiving and a daily base backup through the Barman Cloud Plugin (`ObjectStore` `grounded-postgres-backup`: patch `destinationPath` and `endpointURL`; 30-day retention), and NetworkPolicies for replication, the operator (`cnpg-system`) and the API server. Some CNIs (Cilium) need an extra rule for API-server egress.
- **`valkey-single`**: Valkey 8 with `requirepass`, no persistence (Valkey only holds rebuildable state, ADR-0015), 400 MB `maxmemory` with LRU eviction.
- **`backup-pgdump`**: a CronJob (03:17 UTC; patch `schedule`/`timeZone`) that runs `pg_dump -Fc`, checks the dump with `pg_restore --list`, keeps it on the `grounded-postgres-backups` PVC and deletes dumps older than `RETENTION_DAYS` (14). Setting `UPLOAD_S3_BUCKET` (and `UPLOAD_S3_ENDPOINT`, `UPLOAD_S3_PREFIX`, optionally `UPLOAD_RETENTION_DAYS`) in the `grounded-postgres-backup` ConfigMap, plus the secret `grounded-backup-s3`, copies each dump off-site with rclone. `PGHOST` etc. in the same ConfigMap point it at another database. Run it on demand with `kubectl create job --from=cronjob/grounded-postgres-backup manual-backup`.
- **`backup-objects`**: a CronJob (03:47 UTC, after the dump) that copies the bucket (`S3_*` from `grounded-config`, credentials from `grounded-s3`) off-site with `rclone sync` into `UPLOAD_S3_PREFIX/current`. Files changed or deleted since the last run move to `previous/<time>` and are kept `PREVIOUS_RETENTION_DAYS` (14). Set the target in the `grounded-objects-backup` ConfigMap (`UPLOAD_S3_ENDPOINT`, `UPLOAD_S3_BUCKET`, `UPLOAD_S3_PREFIX`) with the secret `grounded-backup-s3`; with `UPLOAD_S3_BUCKET` empty it does nothing. Restoring both: [`operations/restore.md`](../operations/restore.md).
- **`ingress`**: an `Ingress` named `grounded` for `grounded.example.org` → `grounded-api:http`. Patch the host, add `spec.ingressClassName` and `spec.tls`.
- **`tika`**: Apache Tika 4 on `grounded-tika:9998`, and `TIKA_URL` set in `grounded-config`. To make Tika the OCR backend, patch its image to the `-full` variant (it includes Tesseract; [`operations/ocr.md`](../operations/ocr.md)).
- **`ocr-tesseract`**: the OCR sidecar `ghcr.io/ncecere/grounded-ocr` (Tesseract 5, common languages) on `grounded-ocr:8080`, a NetworkPolicy that lets only the api and worker call it, and `OCR_TESSERACT_URL` set in `grounded-config`. Pin its image by digest in the overlay, like Grounded's. OCR stays off until a platform admin turns it on in Admin → Parsing ([`operations/ocr.md`](../operations/ocr.md)).
- **`monitoring`** or **`monitoring-annotations`**: see [Monitoring](#monitoring). Use one of them.
- **`alerts`** and **`dashboards`**: Grounded's alert rules as a `PrometheusRule`, and its Grafana dashboards as ConfigMaps for the Grafana sidecar; see [Monitoring](#monitoring).
- **`private-registry`**: adds the pull secret `grounded-registry` to the `grounded` ServiceAccount (the image is private until v0.1.0).

## Overlays

Copy an example into your repository and adapt it:

- [`example-small`](../../deploy/kubernetes/overlays/example-small/kustomization.yaml): namespace `grounded` with the restricted Pod Security labels, `postgres-single`, `valkey-single`, `backup-pgdump`, `ingress` (Traefik, cert-manager TLS), the API NetworkPolicy opened to the `traefik` namespace.
- [`example-ha`](../../deploy/kubernetes/overlays/example-ha/kustomization.yaml): `postgres-cnpg`, `ingress`, `monitoring`; 3 API replicas (one per node, so at least 3 schedulable nodes); 2 workers; Valkey outside the overlay ([README](../../deploy/kubernetes/overlays/example-ha/README.md)).

**Scheduling.** The base spreads API replicas across nodes with `whenUnsatisfiable: DoNotSchedule` (`maxSkew: 1` on `kubernetes.io/hostname`, ignoring nodes whose taints the pods don't tolerate): a replica stays `Pending` rather than share a node while another node has fewer. With fewer nodes than replicas they spread as evenly as possible. Workers spread with `ScheduleAnyway`. Both PodDisruptionBudgets allow one pod down at a time (`maxUnavailable: 1`), whatever the replica count, and never let a pod that isn't ready block a node drain (`unhealthyPodEvictionPolicy: AlwaysAllow`).

A minimal overlay:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: grounded
resources:
  - <base: vendored directory or remote URL, see below>
components:
  - <components, when the base is referenced remotely>
images:
  - name: ghcr.io/ncecere/grounded
    digest: sha256:<digest>
patches:
  - patch: |-
      apiVersion: v1
      kind: ConfigMap
      metadata: {name: grounded-config}
      data:
        APP_URL: https://grounded.example.org
        S3_ENDPOINT: https://s3.example.org
```

The base's image tag is the deliberate placeholder `pin-a-digest-in-your-overlay`: an overlay that forgets `images:` fails with `ErrImagePull` instead of running an unknown version.

## Consuming the base

**While the repository is private**, render the base and the components you use into your GitOps repository:

```sh
make vendor-k8s DEST=../gitops/apps/grounded/vendor COMPONENTS="postgres-single valkey-single backup-pgdump ingress"
```

This writes `grounded.yaml` (the rendered manifests, no namespace), `grounded-config.env` (the settings of the base and the chosen components) and a `kustomization.yaml` that lists the manifests and generates `grounded-config` from the env file, all headed with the source commit, the date and "generated, do not edit". Because the vendored kustomization generates the ConfigMap, your build hashes it, and the `behavior: merge` generator and `grounded-config` patches of [Configuration](#configuration) work as with the remote base. Your overlay lists the directory under `resources:` and patches it like any base. To upgrade, re-run the command at the new commit or tag and review the diff. Never edit the vendored files.

**Once the repository is public** (v0.1.0), reference the base and components remotely, pinned to a tag, and delete the vendored copy:

```yaml
resources:
  - https://github.com/ncecere/grounded//deploy/kubernetes/base?ref=v0.1.0
components:
  - https://github.com/ncecere/grounded//deploy/kubernetes/components/postgres-single?ref=v0.1.0
  - https://github.com/ncecere/grounded//deploy/kubernetes/components/valkey-single?ref=v0.1.0
```

Flux and Argo CD both build remote bases. Keep the `?ref=` on a tag, and bump it together with the image digest.

## Images

`.github/workflows/image.yml` (run by CI after the tests and manifest checks pass) publishes `ghcr.io/ncecere/grounded` for linux/amd64 and linux/arm64:

- pushes to `main`: `sha-<short commit>`;
- `vX.Y.Z` tags: `vX.Y.Z`, `vX.Y` and `latest-release` (the last two not for pre-releases).

There is no `latest` tag. Each image has an SBOM and provenance attestation, is scanned with Trivy and is signed with cosign (keyless). The job summary prints the digest; pin that:

```yaml
images:
  - name: ghcr.io/ncecere/grounded
    newTag: v0.1.0          # informational
    digest: sha256:<digest> # what is deployed
```

Verify a signature:

```sh
cosign verify ghcr.io/ncecere/grounded@sha256:<digest> \
  --certificate-identity-regexp '^https://github.com/ncecere/grounded/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The image is distroless, runs as UID 65532 and needs no writable root filesystem. `docker run --rm ghcr.io/ncecere/grounded@sha256:<digest> version` prints the version and commit.

## Security

- **Pods**: non-root, read-only root filesystem, all capabilities dropped, no privilege escalation, seccomp `RuntimeDefault`, `emptyDir` for `/tmp`, no service account token, no service links. Everything meets the `restricted` Pod Security Standard; label the namespace as the examples do.
- **NetworkPolicies**: the base denies all ingress and egress in the namespace, then allows DNS (kube-dns in kube-system), ingress to the API on 8080 from the ingress controller's namespace (`grounded-api-ingress`, placeholder `ingress-controller`: patch it), and egress from api and worker to Postgres and Valkey pods in the namespace, to in-cluster S3 on TCP 9000 (`grounded-app-egress-object-storage`, any namespace by default: narrow it), and to TCP 443 and 80 anywhere (`grounded-app-egress-web`: model gateways, OIDC, external S3 and the crawler). **The crawler's SSRF guard still applies inside the app** whatever the policy allows: private, loopback and link-local addresses and ports other than 80/443 are refused. Components add their own policies.
- **Add egress** in your overlay for anything else: a managed Postgres or Valkey outside the namespace, SMTP (587/465), self-hosted model servers on other ports or private addresses. Assume Grounded has its namespace to itself: the default-deny and DNS policies select every pod in it.

## Ingress

- The host must match `APP_URL`, and TLS must terminate at or before the ingress (`APP_URL` is https).
- **Chat answers stream over SSE.** The controller must not buffer responses and must allow reads of a few minutes. Traefik and most Gateway implementations need nothing. For NGINX-based controllers, turn off proxy buffering and raise the read timeout (for example `proxy-buffering: "off"`, `proxy-read-timeout: "600"`), and allow uploads up to `MAX_UPLOAD_BYTES` (100 MB by default).
- Set `TRUSTED_PROXIES` to the addresses the controller connects from.
- `/metrics` is served on the API's public listener. If metrics shouldn't be public, block `/metrics` at the ingress controller or the proxy in front of it (for example a Traefik middleware or a deny rule), and scrape the pods directly as below.

## Monitoring

API metrics are on `:9091/metrics` (the internal `METRICS_ADDR` listener; the public port answers 404), worker metrics on `:9090/metrics`.

- **Prometheus Operator**: add `components/monitoring`. Its `ServiceMonitor` `grounded` scrapes the `metrics` port of `grounded-api` and `grounded-worker`. Add the label your Prometheus selects on (for example `release: <name>`).
- **Annotation-based scraping** (plain Prometheus pod discovery, Grafana Alloy, the OpenTelemetry Collector): add `components/monitoring-annotations`.
- Both add `grounded-allow-metrics-scrape`, admitting the scraper from the `monitoring` namespace; patch it to where yours runs.
- **Alert rules:** `components/alerts` adds a `PrometheusRule` (for the Prometheus Operator, or Grafana Alloy's `mimir.rules.kubernetes` loading them into Mimir). **Dashboards:** `components/dashboards` adds one ConfigMap per dashboard with the `grafana_dashboard: "1"` label for the Grafana sidecar. Both are generated from [`deploy/observability/`](../../deploy/observability/README.md); loading them without these components, the metrics reference and the SLOs: [`operations/monitoring.md`](../operations/monitoring.md). Runbooks: [`operations/alerts.md`](../operations/alerts.md).
- Logs are JSON on stdout.

## Health checks

| Endpoint | Meaning | Used by |
|---|---|---|
| `/healthz` | the process is running; never checks dependencies, so an outage doesn't restart pods | liveness and startup probes |
| `/readyz` | Postgres, Valkey and object storage answer within 2s, and the pod isn't draining; otherwise 503 with the failing checks | readiness probe |

The API serves both on 8080 (and again on its internal metrics listener, 9091), the worker on 9090. `kubectl -n grounded port-forward svc/grounded-api 8080:80` then `curl localhost:8080/readyz` shows each check.

## Upgrades

1. **Pin the new digest** (and bump the vendored base or the remote `?ref=`) in the overlay and let GitOps apply it. Never deploy by a mutable tag.
2. **Migrations** run in the `migrate` init container of every new api and worker pod. A Postgres advisory lock serialises them, so concurrent pods are safe and only the first does any work. New pods only start after the schema is current.
3. **Expand/contract** ([ADR-0013](../adr/0013-availability-and-zero-downtime-migrations.md)): each release's schema works with the previous release's code, and destructive steps ship at least one release later. Old and new pods run side by side during the rollout (`maxUnavailable: 0`, `maxSurge: 1`), so skip no release that the release notes mark as required.
4. **Draining**: on termination a pod fails `/readyz`, waits `SHUTDOWN_DELAY` (10s) for load balancers to notice, then gives in-flight requests, including SSE chats, and running jobs `SHUTDOWN_TIMEOUT` (90s). Jobs still running are cancelled and retried elsewhere. `terminationGracePeriodSeconds` is 120s.
5. **Rolling back** means pinning the previous digest. Because of expand/contract, the previous release runs on the newer schema; migrations are never rolled back automatically.

## First platform admin

Grounded has no default admin account. The first admin is named by their OIDC subject:

1. Deploy with OIDC configured and sign in once as the future admin. You get an ordinary account.
2. Find your `sub`, the IdP's stable user ID (for some providers a hash, not your username):
   ```sh
   kubectl -n grounded exec -it grounded-postgres-0 -- psql -U grounded -d grounded \
     -c "SELECT email, oidc_subject FROM users ORDER BY created_at"
   ```
   (With CNPG: `kubectl -n grounded exec -it grounded-postgres-1 -- psql -d grounded -c ...` on the primary.)
3. Set `BOOTSTRAP_ADMIN_SUBJECT` to it, in `grounded-config` or in `grounded-runtime`, and let the pods roll.
4. Sign in again: you are promoted to platform admin. The promotion is recorded once (`platform_bootstrap`), so a later deliberate demotion isn't undone. You may remove the setting afterwards.

To see the install working before any team exists, seed the demo: a Demo team with two agents over the Go documentation ([`../demo.md`](../demo.md)). Add your model connection, a chat model and a default embedding profile in the admin UI first; the demo then uses them, acts as the bootstrap admin, and needs outbound HTTPS to go.dev:

```sh
kubectl -n grounded exec deploy/grounded-worker -c worker -- /grounded demo
```

(`--models=openai-compatible` would need the gateway key on the command line, since the image has no shell to set `DEMO_CHAT_KEY`.)

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `ErrImagePull` for `ghcr.io/ncecere/grounded:pin-a-digest-in-your-overlay` | the overlay doesn't set `images:` |
| `ImagePullBackOff` with 401/403 | the image is private: add `components/private-registry` and the `grounded-registry` secret |
| `CreateContainerConfigError` | a required secret or key is missing (`grounded-runtime`, `grounded-s3` with `access_key`/`secret_key`, `POSTGRES_PASSWORD`, `VALKEY_PASSWORD`); `kubectl describe pod` names it |
| `migrate` init container fails | `DATABASE_URL` wrong or Postgres unreachable (NetworkPolicy, password encoding); `kubectl logs <pod> -c migrate`. On a managed or CNPG database: the `vector` extension must be created by a superuser first |
| Pod exits with `invalid configuration` | the log lists every problem: missing keys, the example `ENCRYPTION_KEY` or `API_KEY_PEPPER`, `DEV_AUTH` on, `APP_URL` not https, no sign-in method (`OIDC_ISSUER` empty), `OIDC_CLIENT_SECRET` missing ([Safety checks](#safety-checks)) |
| Something is wrong but it isn't clear what | `kubectl -n grounded exec deploy/grounded-api -c api -- /grounded doctor` checks every dependency and names the failure |
| Model tests are slow from the cluster only | the test's phases show where the time goes; see [Slow DNS](#slow-dns) |
| API pod `Pending` with `didn't match pod topology spread constraints` | fewer schedulable nodes than the spread needs: add a node, or lower the replicas |
| Settings changed in a Secret don't take effect | Secrets aren't hashed: `kubectl rollout restart` the Deployments ([Configuration](#configuration)) |
| Pods run but never become Ready | `curl /readyz` through a port-forward shows which of postgres, valkey or storage fails. Storage: bucket missing, wrong endpoint or credentials, or egress to the S3 port not allowed |
| DNS lookups time out | cluster DNS isn't `k8s-app: kube-dns` in `kube-system`: patch `grounded-allow-dns` |
| 502/504 from the ingress | `grounded-api-ingress` doesn't admit the controller's namespace |
| Chat answers arrive all at once or cut off | the ingress buffers responses or times out reads (see [Ingress](#ingress)) |
| Sign-in fails with a redirect error | the IdP's redirect URI must be exactly `<APP_URL>/auth/callback` |
| Everyone shares one rate limit / wrong client IPs in logs | set `TRUSTED_PROXIES` to the ingress controller's addresses |
| Crawls fail for internal sites | by design: the SSRF guard refuses private addresses, whatever the NetworkPolicy allows |
| Postgres `CrashLoopBackOff` on NFS | UID mapping: patch the StatefulSet's `runAsUser`/`fsGroup` to what the storage expects |

## Validating changes

- `make k8s-validate` renders the base alone, the base with each component, two full component sets, every overlay and the kind fixture, and validates everything with `kubeconform -strict`. It also checks that the Deployments reference the hashed `grounded-config`, and that a vendored base with a consumer overlay merges keys and changes the hash when they change (CRD schemas from a pinned [CRDs-catalog](https://github.com/datreeio/CRDs-catalog) commit). CI runs it in the `k8s` job. Tools are installed at pinned versions into `bin/k8s-tools/`.
- `make k8s-smoke` builds the image, creates a throwaway kind cluster (kubeconfig in a temporary file; your own kubeconfig and context are never touched), deploys [`test/kind`](../../deploy/kubernetes/test/kind/kustomization.yaml) (the example-small shape with a disposable S3 server, random dev-only secrets and `DEV_AUTH` on a loopback `APP_URL`), waits for every workload, runs the backup job once, checks `/readyz`, `/healthz`, `/metrics` and the UI, runs `grounded doctor` in the api and worker pods, applies a configuration change and checks that the pods roll, and deletes the cluster. `KEEP=1` keeps it; `CLUSTER=<name>` names it.
- `make k8s-load` runs the k6 load tests on a throwaway kind cluster running [`test/load`](../../deploy/kubernetes/test/load/kustomization.yaml) ([`deploy/loadtest`](../../deploy/loadtest/README.md); results in [`benchmarks/load.md`](../benchmarks/load.md)).
- `make k8s-restore-rehearsal` backs up, destroys and restores Postgres and the bucket on a throwaway kind cluster, following [`operations/restore.md`](../operations/restore.md), and prints the time of each step.
