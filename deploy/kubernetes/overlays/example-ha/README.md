# example-ha

The highly available topology from [DESIGN.md §15](../../../../docs/DESIGN.md): three API replicas one per node, two workers, CloudNativePG with a primary and two replicas, and backups to a separate S3 target. See [`docs/deployments/kubernetes.md`](../../../../docs/deployments/kubernetes.md).

## Valkey

This overlay runs no Valkey. Grounded connects to one endpoint given by `VALKEY_URL` (`redis://` or `rediss://` for TLS); it does not speak the Sentinel protocol. Use one of:

- a **managed** Redis- or Valkey-compatible service with automatic failover behind one endpoint;
- an **operator** that runs a primary with replicas and keeps a Service pointed at the current primary.

Valkey holds only rebuildable state (rate limits, crawl pacing, caches; [ADR-0015](../../../../docs/adr/0015-valkey-shared-fast-state.md)). A failover resets limits and empties caches; nothing is lost. Adjust `valkey-egress.yaml` to the service's address and port. If the Valkey runs in this cluster, label its pods `app.kubernetes.io/name: grounded` and `app.kubernetes.io/component: valkey` and the base policy already allows the traffic.

## Before applying

- Install the CloudNativePG operator and the Barman Cloud Plugin (namespace `cnpg-system`).
- Create the secrets `grounded-runtime` (without `DATABASE_URL`: the component takes it from the operator's `grounded-postgres-app`), `grounded-s3` and `grounded-postgres-backup-s3`.
- Replace every `example.org` value, the documentation-range address in `valkey-egress.yaml`, the ingress class and namespace, and the image digest.
