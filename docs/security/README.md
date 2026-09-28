# Security package

This directory is what an institution's security review of a Grounded install needs from the project (DESIGN §16, phase 5 P8). It describes Grounded as built at the time of writing (v0.1.0); each install adds its own deployment profile ([`docs/deployments/`](../deployments/README.md)), which records its hosting, identity provider, model gateway, data classification and review status.

| Document | What it covers |
|---|---|
| [`data-flow.md`](data-flow.md) | The components, trust boundaries and the data that crosses each one, as a diagram and a table |
| [`controls.md`](controls.md) | The security controls, mapped to DESIGN §16, with where each is implemented and tested |
| [`threat-model.md`](threat-model.md) | STRIDE per trust boundary: tenant isolation, SSRF, prompt injection, widget origins and CSP, API keys, OIDC, admin powers and break-glass, supply chain; open items |
| [`dependencies.md`](dependencies.md) | How the SBOM is produced, the direct Go and npm dependencies with licenses, and the latest vulnerability and container scan results |

## Scope

In scope: the `grounded` binary (API, worker, migrations, `doctor`, `rotate-keys`, `demo`), the web UI embedded in it, the container image, and the generic Kubernetes manifests in `deploy/kubernetes`.

Out of scope, and the operator's responsibility: the identity provider, the model gateway and any model providers behind it, the Postgres, Valkey and S3 services and their backups, the ingress and TLS termination, the network between them, and the install's configuration choices (for example turning public agents on). The documents say where Grounded depends on these.

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting, as [`SECURITY.md`](../../SECURITY.md) describes. Don't open a public issue.

## Keeping this current

- A change that adds a route must classify it in the authorization matrix (`internal/httpapi/authz_matrix_policy_*_test.go`); CI fails otherwise.
- A change that adds a component, an outbound connection or a new kind of stored data updates `data-flow.md` and, if it changes a boundary, `threat-model.md`.
- `make deps-inventory` regenerates the dependency tables; re-run the scans in `dependencies.md` before a release and record the results there.
