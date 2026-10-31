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
and HA topology remain Kustomize-only. **External datastores currently must be in
the same namespace with canonical Grounded datastore labels and ports**; arbitrary
managed services need explicit Kustomize egress. This is a known first-chart scope
limitation, not a claim of general external-service support.

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
