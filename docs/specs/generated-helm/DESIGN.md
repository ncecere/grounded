# Generated Helm delivery design (#31)

Source baseline: `1a94c2e1317c787c442fb94c4bfc072f022a051b`.
Status: proposed implementation for parent review, not deployment acceptance.

## Inventory and boundaries

`deploy/kubernetes/base` supplies api/worker Deployments, their migrate init
containers, PDBs, Services, a tokenless ServiceAccount, default-deny and narrowly
scoped allow policies, and a content-addressed ConfigMap from config.env.
The base intentionally has placeholder images and no namespace or credentials.
Common optional components are postgres-single (pgvector 0.8.6/Postgres 17,
20Gi RWO StatefulSet), valkey-single (password-protected, ephemeral rebuildable
state), ingress, ocr-tesseract (service/config wiring, admin enable still required),
tracing (OTLP and scoped egress), and monitoring-annotations (pod annotations and
scraper ingress). All resource/probe/security/selector details remain canonical.
Other components (CNPG/Barman, backup jobs, Tika, Operator monitoring, alerts,
dashboards, private registry) remain Kustomize-only initially.

example-small uses bundled singletons and pg_dump backup; example-ha uses CNPG
and external Valkey with a separately scoped external egress policy. test/kind
is the small shape with disposable S3, loopback DEV_AUTH and reduced CPU requests;
test/smoke adds OCR/fake models; test/load adds access and object backup. None of
these test-only settings or fake models are included in the chart.

ci.yml gates image.yml on tests, authz, e2e, OCR, K8s validation and kind smoke.
image.yml builds both multiarch images, emits SBOM/provenance, scans and signs
immutable digests. Release job consumes those digests and github-release.sh adds
checksummed assets. Chart publication must follow these gates, not branch-images
(which intentionally lacks release signing/scanning). No current release changes.

## Generator

Use pinned Kustomize to render all 64 combinations of the six bounded components.
Deduplicate identical semantic objects, reduce boolean selection predicates, and
emit conditional templates. This deliberately delegates all component patching,
image placeholders and ConfigMap content to the canonical Kustomize engine, not a
second YAML interpretation. Canonical source hashes and tool versions are recorded.
`--check` compares complete generated trees without changing them, including extra
files. A canonical mutation must make it fail before regeneration.

Only explicit typed leaves may become values: application/OCR digest image refs,
api/worker/OCR replica counts, public HTTPS origin, S3 endpoint/bucket, ingress
host/class/TLS/namespace, secret *names*, tracing endpoint/namespace/sample share,
and monitoring namespace. No arbitrary pod/env/security/network-policy escape
hatch. Unknown values fail schema validation. Fixed names mean one release per
dedicated namespace, no release-name rewriting of selectors or discovery.

ConfigMap content hashes differ between Helm and Kustomize algorithms; references
must resolve to their own immutable content-addressed ConfigMap. Equivalence
normalizes only these generated names, verifies references, and compares every
other semantic object field (including policies and security contexts). Namespace
comes from the Helm release, never a chart-created Namespace. No CRDs or hooks.

## Safety and lifecycle

No Secret objects, credential strings or generated credentials. Installers supply
existing runtime/S3 Secrets, optional SMTP Secret, and TLS Secret. Runtime includes
DATABASE_URL, VALKEY_URL, ENCRYPTION_KEY and API_KEY_PEPPER plus OIDC configuration;
bundled choices additionally require POSTGRES_PASSWORD/VALKEY_PASSWORD and URLs
pointing at canonical services. Never print these values. Template validation can
validate reference syntax/required names, not prove external Secret contents exist.
Modes are a single bundled/external enum per service; external never creates a
bundled alternative. External routing replaces the two canonical datastore peers/ports with explicit
namespace-AND-pod-label selectors or a managed IPv4 /32 and port. No fallback
canonical peer remains for an external mode. Modes and destination shapes are
mutually exclusive in schema; broad existing web/object-storage ports cannot be
selected. The independent oracle patches canonical Kustomize policy leaves with
identical destination semantics (not normalization). Explicit live preflight reads
only named runtime/S3/optional SMTP Secrets with bounded deadlines, without logging data; it
checks URL destination/authentication and verified TLS for external services.
Ordinary rendering never contacts a cluster. Preflight is not live reachability;
doctor/readiness and enforcing-CNI controls remain deployment gates.
DEV_AUTH remains false and cannot be overridden through chart values. No model
configuration, demo seed or OCR admin enable. Canonical resource limits preserved;
replicas bounded 1..32. Required digest values are empty by default: unconfigured
chart fails safely, tests supply synthetic nonresolving digests, never pull them.

Bundled Postgres is not HA and has no automatic backup component in this first
chart; arrange backups/restore rehearsal before use. StatefulSet PVCs survive
normal deletion by Kubernetes retention defaults; Helm uninstall removes workloads
and configuration, not a data reset. Changing modes, storage size/classes, database
major version or release ownership is a manual migration, not a safe values flip.
No automatic down SQL or reset: migrate init containers retain advisory locking
and forward-only expand/contract ordering. Helm rollback only changes manifests;
it cannot undo schema/data. Follow operations/upgrades.md and restore.md.

## Tests and release

Independent oracle creates fresh Kustomize overlays directly from base/components
with equivalent images/replicas/strategic patches, never reads chart templates or
generator transformation functions. Matrix covers default external, mixed modes,
bundled, OCR, ingress and tracing/monitoring, plus nondefault leaves. Compare all
objects; mutation controls cover stale source and semantic mismatch. Helm lint,
template/schema negatives, strict kubeconform and existing K8s validation follow.
Only isolated local kind may be used for install/upgrade evidence; rendering is
not installation. Protected CI and real upgrade acceptance belong to parent.

Future OCI job is tag-only and after image/release gates, read-only by default,
packages/id-token write only for publishing/signing. Package version derives from
future immutable semver tag, app/OCR values from signed build digests. Refuse an
existing OCI version rather than overwrite it; sign chart digest and attach source
provenance. No mutable aliases. Local worker never invokes publication code.

## Local follow-up evidence (not parent acceptance)

Follow-up #31 exercised a uniquely owned local kind v0.33.0 / pinned Kubernetes
1.37 node, with an isolated kubeconfig. A locally built source application image
(base `13d206057b43fe858aad019a707d015859b6ceab`) gained only a local fixture CA;
its manifest digest was loaded/pinned locally, never pushed. No models were used.
The first placeholder-S3 attempt was cancelled, retained as failed evidence,
and replaced with local TLS S3/OIDC fixtures (not a readiness bypass). Fixture-only
/32 egress covered their real post-DNAT ports; chart policies stayed unchanged.

Bundled install, public-origin/replica values upgrade (1 to 2 API and workers),
manifest rollback, Postgres restart, uninstall/PVC retention and reinstall passed.
A SQL marker remained, and the PVC UID stayed unchanged. API/worker health and
readiness returned 200; doctor passed on both, including S3 write/read/delete.
Migration init completion preceded application startup. This was a **same-source
values upgrade**, not a previous-release SQL upgrade or full app/upgrade suite.
Helm rollback demonstrably left SQL data in place; no down migrations were tested.

A separate fresh external release reached authenticated TLS Postgres/Valkey on
custom ports, with /32 destinations and no bundled StatefulSets. Wrong-port and
wrong-address policy mutations each made a fresh doctor connection fail; exact
restoration returned doctor to passing. This establishes datastore policy controls
on the installed local CNI only, not generic kindnet support. The existing
OCR acceptance helper subsequently passed all baseline/standalone/composed-base
positive/negative controls and its additive-DNS mutation/restoration, on this
same owned cluster. Its five unit controls also passed. Cross-namespace pod-label routing has independent render coverage, not a
live cross-namespace datastore lifecycle proof. IPv4 /32 only is intentional.
Exact commands, exits, logs, source identity and cleanup proof are handed to Pi
outside the repository in `grounded-jobs/issue31-lifecycle-2/artifacts`. Proposed
ADR-0031 remains Proposed; protected CI, release compatibility, OCI publication
and parent review are still gates. No publication/signing was executed.

## Independent check (2026-11-04)

Reproduced from the repository with `deploy/helm/scripts/kind-lifecycle.sh` (kind
v0.33.0, Kubernetes 1.37.0, kindnet enforcing NetworkPolicies) against the chart on
this branch after rebasing onto `main` (generated output unchanged: `generate.py
--check`, `test_chart.py` 7 tests and 14 negatives, and `mutation.py` all pass). The
app image is v0.7.0 plus a throwaway fixture CA, pushed to a local registry and
pinned by digest. Postgres 17 (pgvector 0.8.7), Valkey and S3 (the CI's Silo
image, TLS) run in a **separate `datastores` namespace**, and the chart reaches
Postgres and Valkey through `postgresDestination` and `valkeyDestination` with
`namespace` and `podLabels`: the first **live** proof of cross-namespace pod-label
routing. A minimal TLS OIDC discovery document stands in for the identity provider.

| Step | Result |
|---|---|
| `helm install` (1 API, 1 worker), restricted Pod Security | `grounded doctor` in api and worker: 13 checks, 0 failed (safety, Postgres, pgvector, migrations 59, Valkey, S3 write/read/delete, OIDC discovery and JWKS) |
| Values upgrade to 2 API and 2 workers with a new `appURL` | doctor passes in both |
| `helm rollback` to revision 1 | doctor passes; a SQL marker written after install is kept |
| Negative control: Postgres `podLabels` that match nothing | doctor fails on `postgres connect` only (Valkey, S3 and OIDC still pass) |
| Restore the right labels | doctor passes |
| `helm uninstall` | the external database and its marker are untouched |

The cluster and registry are deleted on exit, success or failure. Not covered: a
previous-release SQL upgrade, the bundled datastores (exercised by the earlier
follow-up) and a production cluster. ADR-0031 was accepted with v0.8.0 (2026-11-04), the first release that publishes the chart.

