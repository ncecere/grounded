# ADR-0031: Generated Helm alongside canonical Kustomize

- Status: Proposed
- Date: 2026-10-31

## Context

The owner chose Helm for adoption in v0.7.0 without replacing Kustomize.
ADR-0014's original rejection of Helm remains historical; this proposal adds a
second delivery format, not a second hand-maintained deployment definition.

## Decision

Generate a bounded Helm chart from canonical base/components with pinned
Kustomize. Keep existing installations untouched. Check deterministic generation
and independently compare Helm objects with fresh Kustomize overlays in CI.
Limit values to common typed choices; unusual customizations remain Kustomize.
Require external Secret references and immutable application image digests.
Publish future semver-tagged OCI charts only behind existing release/image gates,
with digest signing and provenance. Never overwrite a chart version.

Detailed design and lifecycle limitations: [design](../specs/generated-helm/DESIGN.md).

## Consequences

There is one deployment source, with a reproducibility check and a semantic oracle.
Fixed resource names require a dedicated namespace per install. Bundled services
are singletons, not HA; database lifecycle and forward migrations remain operator
responsibilities. Helm rollback is not database rollback. No CRDs/hooks are added.

## Alternatives considered

- Hand-maintained templates: rejected because they drift from canonical policies.
- Replace Kustomize: rejected by owner; existing installations must not change.
- Expose arbitrary YAML/env patches: rejected; Kustomize serves that use case.
