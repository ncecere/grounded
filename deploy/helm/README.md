# Generated Helm chart (proposed, unreleased)

Kustomize remains canonical. Existing overlays/installations do not change.
[Design](../../docs/specs/generated-helm/DESIGN.md), Proposed
[ADR-0031](../../docs/adr/0031-generated-helm.md). No chart has been published or
installation/upgrade certified by this change.

## Tools and source workflow

Python 3 with PyYAML 6.0.1; Go from go.mod. Install the pinned render tools:

```sh
bash deploy/helm/scripts/install-tools.sh
export PATH="$PWD/bin/helm-tools:$PATH"
python3 deploy/helm/scripts/generate.py --check
python3 deploy/helm/scripts/generate.py
python3 deploy/helm/scripts/test_chart.py
python3 deploy/helm/scripts/mutation.py /tmp/grounded-helm-mutation
```

Commit generated templates/provenance with source changes; never edit templates.
The generator renders every bounded component combination, deduplicates objects
and emits minimized selection conditions. Provenance records canonical file and
recipe SHA-256 hashes. CI checks unchanged output **before** regenerating, then
compares 64 equivalent settings with an independent Kustomize oracle, Helm lint,
negative values and strict kubeconform (Kubernetes schema 1.34.0). These are render
checks, not cluster acceptance. Do not disable schema validation.

## Install preparation

Use a dedicated namespace (restricted Pod Security), one release per namespace:
resource names intentionally remain `grounded-*` regardless of Helm release name.
Create it and required Secrets through your normal approved provisioning process;
this chart creates no Namespace, Secret, CRD, hooks or credentials. Do not put
credential data in values or pass secrets through `--set` (Helm retains values in
release history). See the [Kubernetes secrets contract](../../docs/deployments/kubernetes.md).

The existing runtime Secret needs DATABASE_URL, VALKEY_URL, ENCRYPTION_KEY,
API_KEY_PEPPER and appropriate OIDC settings. The existing S3 Secret needs
`access_key` and `secret_key`. SMTP Secret is optional. Bundled Postgres additionally
needs POSTGRES_PASSWORD and a matching, URL-encoded DATABASE_URL targeting
`grounded-postgres:5432/grounded`; bundled Valkey needs VALKEY_PASSWORD and matching
VALKEY_URL targeting `grounded-valkey:6379/0`. Credentials are never constructed by
the chart. Keep DEV_AUTH=false; do not use runtime Secret envFrom to override the
chart's public-origin or safety configuration. The application enforces its own
production safety checks. Template checks validate required reference names and
syntax, not existence/contents of Secrets or reachability of dependencies; verify
those out of band before installing.

Prepare an install-owned nonsecret values file, copying values.yaml. Required:

- `appImage`: full repository reference **with `@sha256:` and 64 hex digits**;
  obtain and verify the release's signed image digest, not `latest` or a tag.
- `runtimeSecret`, `s3Secret`: existing Secret names, nonempty.
- `appURL`, `s3Endpoint`, `s3Bucket`: your public HTTPS origin and blob storage.

Example command after preparing those values (not executed by this change):

```sh
helm lint deploy/helm/grounded --strict -f install-values.yaml
helm template grounded deploy/helm/grounded -n install-namespace -f install-values.yaml
helm install grounded deploy/helm/grounded -n install-namespace -f install-values.yaml --wait --timeout 10m
```

## Values and boundaries

| Values | Behavior |
|---|---|
| `postgres`, `valkey` | Exactly `external` (default) or `bundled`; no fallback alternative is deployed |
| `apiReplicas`, `workerReplicas`, `ocrReplicas` | 1..32; defaults 2, 2, 1; canonical resource limits retained |
| `ocr`, `ocrImage` | Deploy Tesseract only when opted in; digest required; OCR remains off until a platform admin enables it |
| `ingress` | Off by default; enabling requires ingressClass/tlsSecret and appURL equal to `https://ingressHost` |
| `ingressHost`, `ingressClass`, `tlsSecret`, `ingressNamespace` | Host, controller class, existing TLS Secret and controller namespace; policies continue restricting API ingress |
| `tracing`, `tracingEndpoint`, `tracingNamespace`, `tracingSample` | Off by default; OTLP/HTTP :4318, sampler fraction 0..1, scoped collector egress; credentials only in existing runtime Secret |
| `monitoring`, `monitoringNamespace` | Off by default; canonical prometheus.io annotations and scoped scraper ingress |
| `smtpSecret` | Optional existing SMTP Secret, default reference grounded-smtp |

Unknown values are errors. No arbitrary env/pod/policy patches, model configuration,
demo seeds, or DEV_AUTH switch. OCR's deny-all egress is preserved, including DNS
exclusion; network policy enforcement needs a compatible CNI. SSE controller tuning,
private image pulls, backups, CNPG, unusual ports/routing, resource customization
and HA topology remain Kustomize-only. External datastores require explicit
`postgresDestination` / `valkeyDestination`; bundled modes require `{}`. Each is
exactly one destination with `host` and a TCP `port` (1024..65535, except 9000):

```yaml
postgresDestination:
  host: postgres.databases.svc.cluster.local
  port: 5432
  namespace: databases
  podLabels: {app: postgres}
valkeyDestination:
  host: cache.example.org
  port: 16379
  cidr: 10.24.8.19/32
```

Namespace plus nonempty pod labels are an AND peer, not two OR peers.
The URL port and actual datastore listener port must agree; differing Service
port/targetPort mappings are outside this bounded interface. Managed
IPv4 destinations are single-address `/32` CIDRs only; IPv6, address pools and
more elaborate routing stay Kustomize-only. DNS changes require reviewing the
pinned address and repeating deployment checks. The canonical datastore rule is
**replaced**, not supplemented: external mode leaves no same-namespace fallback.
Existing canonical web (80/443) and object-storage (9000) policies are unchanged;
external datastore ports cannot reuse these broad grants. No new internet grant
is added. These are bounded patches of canonical policy leaves, like an overlay.

Before deployment, run offline checks then the explicit live Secret preflight:

```sh
python3 deploy/helm/scripts/preflight.py --kubeconfig /approved/install-kubeconfig \
  --context install-context --namespace install-namespace --values install-values.yaml
```

This read-only check fetches only the named runtime/S3/optional SMTP Secrets, with 10s
request deadlines; it never prints contents and is never called by `helm template`.
It checks required keys, rejects all rendered ConfigMap keys in runtime and non-SMTP
keys in the optional SMTP Secret, matches datastore
URL host/port, and requires external Postgres `sslmode=verify-full` and authenticated
Valkey `rediss` without query overrides. Provision trusted server certificates using
the application's normal trust store; no skip-verify/plaintext fallback is provided.
It does not resolve DNS, inspect peer labels, establish TLS or test reachability.
Run readiness and `grounded doctor` in both API and worker after install; verify
actual routing and positive/negative policy controls on an enforcing CNI. Helm
cannot validate Secret content offline. Secret rotation requires repeating preflight.

## Persistence, migrations and rollback

Bundled Postgres is the canonical pinned pgvector 0.8.6/Postgres 17 image with ICU,
20Gi RWO persistence and restricted security contexts. The migrate init container
runs before each new API/worker process; advisory locking serializes migration.
Bundled services are singletons, **not HA**. No automatic backup is installed;
arrange/rehearse backups of database and blobs first. Valkey is deliberately
nonpersistent: restarting it resets rate-limit counters/caches, not durable data.

Do not flip dependency modes on an existing install: migrate data/URLs and plan
ownership, service and policy changes separately. Do not change Postgres major
version or PVC class/size as an ordinary Helm upgrade; these need operator planning
and storage-specific procedures. StatefulSet-generated PVCs normally remain after
uninstall; inspect and retain them, never delete them to make an upgrade pass.

Helm upgrade changes manifests, not database history. ConfigMap content-addressed
names roll pods when settings change. Helm rollback/`--atomic` **cannot undo SQL or
restore data**, even if Helm reports rollback succeeded. Follow forward-only
[expand/contract](../../docs/operations/upgrades.md) and
[restore](../../docs/operations/restore.md) policies; do not skip required versions.
No local Helm install/upgrade or data-preservation claim is made by template tests.

## Future OCI publication

The caller in ci.yml waits for existing protected image and release jobs and the
new chart checks. Only future semver tags from v0.7 onward are eligible. It packages
with the tag-derived version and signed app/OCR digests, refuses existing registry
versions, pushes to `oci://ghcr.io/<owner>/charts`, signs the resulting chart digest
and attaches source/hash/image provenance. No mutable alias is moved. Failures do
not bypass existing signing/scanning/checksum gates. Parent must review workflow
permissions, registry identity/cosign compatibility and protected-CI/publication
acceptance before enabling a release. This worker never runs publish.sh.

## Isolated lifecycle evidence

The follow-up exercised a real owned local kind install, same-source values
upgrade, rollback, SQL/PVC retention, reinstall and a separate managed TLS release.
See the [design evidence and limits](../../docs/specs/generated-helm/DESIGN.md#local-follow-up-evidence-not-parent-acceptance).
This is not previous-release upgrade certification or parent acceptance.
An independent rerun on 2026-11-04 (`deploy/helm/scripts/kind-lifecycle.sh`) added the
live cross-namespace proof: external Postgres and Valkey in another namespace, selected
by `namespace` and `podLabels`, through install, values upgrade, rollback, a negative
policy control and uninstall ([results](../../docs/specs/generated-helm/DESIGN.md#independent-check-2026-11-04)).
For Linux amd64 local lifecycle tools, `bash deploy/helm/scripts/install-lifecycle-tools.sh`
uses the repo's kind pin and checksummed kubectl matching the pinned test node.

Registry HEAD preflight plus push is not atomic registry-enforced no-overwrite;
workflow concurrency cannot exclude other registry writers. Parent gating remains.
