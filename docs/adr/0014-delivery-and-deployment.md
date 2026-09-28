# ADR-0014: Delivery and deployment

- Status: Accepted
- Date: 2026-09-24

> **Note (2026-09-26):** The on-prem Kubernetes below is the first deployment's hosting, not a product requirement. See [ADR-0018](0018-open-source-institution-neutral.md) and [ADR-0023](0023-no-institution-data-in-the-repository.md).

## Context

The platform runs on the institution's on-prem Kubernetes, in staging and prod, and is developed locally. It handles Sensitive and Restricted data, will go through an institutional security risk assessment, and has recovery point and recovery time commitments. yoink already has a working pipeline that we want to reuse. Several hosting details are still unknown (DESIGN.md §18 item 4).

## Decision

- **Environments:** local compose for development, and staging and prod on the institution's Kubernetes.
- **CI (GitHub Actions):** `gofmt`, `go vet`, `go test -race` against a real Postgres, frontend tests and accessibility checks, then the build.
- **Images** are published to GHCR and **deployed by digest, never by `latest`**.
- **Manifests:** Kustomize, with a `base` plus `staging` and `prod` overlays.
- **Secrets:** ExternalSecrets, using whatever backend the cluster provides, or Vault/OpenBao if there isn't one.
  - The app reads only env vars and mounted files.
  - Secrets never appear in the UI or logs.
  - Rotation is documented, including the gateway key, the OIDC client secret and the API key pepper (ADR-0012).
- **Cluster hardening:** namespace NetworkPolicies and the `restricted` Pod Security profile.
- **Backups and DR:**
  - Backed up: Postgres (which, with pgvector, also holds the vectors), object storage, and the vector store if it becomes separate (ADR-0004).
  - Postgres RPO 15 minutes, via continuous WAL archiving.
  - Object storage RPO 24 hours.
  - RTO 4 hours.
  - Backups go to a separate S3-compatible target, not the primary storage.
  - Restores are rehearsed on a schedule. Runbooks live in `docs/operations/`.
- **Observability:** JSON `slog` to Loki, Prometheus metrics to Mimir, optional OpenTelemetry tracing, and dashboards shipped with the app. Alerts go through Grafana alerting.

**Still open (DESIGN.md §18 item 4):** managed Postgres versus CloudNativePG, which S3-compatible storage (primary and backup), ingress and TLS, which ExternalSecrets backend, SMTP relay availability, the alert destination, and whether the institution requires a specific GitHub org, registry or GitOps tool.

## Consequences

- Deploying by digest makes every deployment reproducible and auditable.
- Kustomize overlays keep staging and prod close together, with the differences visible.
- NetworkPolicies and restricted Pod Security support the ISO assessment.
- **Costs and risks:**
  - GHCR and GitHub Actions are external to the institution. If it requires another registry or GitOps tool, the pipeline changes.
  - Restricted Pod Security rules out root containers and privileged features. Every image, including any sidecars, has to comply.
  - NetworkPolicies must allow reaching dependencies outside the namespace (Tika, the gateway, OIDC, SMTP, S3). If they are wrong, things fail at runtime.
  - A 4-hour RTO needs regular rehearsal. Unrehearsed restores are the usual way DR fails.
  - Object storage has a 24-hour RPO, so uploads made after the last backup can be lost even when Postgres is recovered to within 15 minutes. After a restore, some documents can point to missing blobs.

## Alternatives considered

- **Helm charts.** Not chosen. Kustomize matches yoink and is enough for two overlays.
- **Deploying by mutable tags.** Rejected. It isn't reproducible.
- **Secrets in Kubernetes manifests or in the app database.** Rejected in favour of ExternalSecrets.
