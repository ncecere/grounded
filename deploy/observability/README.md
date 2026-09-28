# Observability

Grafana dashboards and Prometheus alert rules for Grounded. Reference, loading instructions and SLOs: [`docs/operations/monitoring.md`](../../docs/operations/monitoring.md); alert runbooks: [`docs/operations/alerts.md`](../../docs/operations/alerts.md).

- `dashboards/`: Grafana dashboards (JSON, schema 39): Overview (SLOs and error budgets), API, Chat & retrieval, Ingest & jobs, Models & moderation. They select their data source with the `DS_PROMETHEUS` variable, so they import into any Grafana.
- `alerts/grounded.rules.yaml`: alerting and recording rules in Prometheus format, usable by Prometheus, Mimir, Cortex or Thanos; `grounded.rules.test.yaml` holds their `promtool test rules` unit tests.
- `scripts/install-promtool.sh`: installs a checksum-pinned promtool for `make obs-validate`.

The Kubernetes components `alerts` (a `PrometheusRule`) and `dashboards` (Grafana sidecar ConfigMaps) are generated from these files: after editing, run `make obs-generate`, then `make obs-validate`.

Metrics are scraped from `/metrics` on port 9091 of the API (its internal `METRICS_ADDR` listener) and port 9090 of the worker; see [`docs/deployments/kubernetes.md`](../../docs/deployments/kubernetes.md#monitoring).
