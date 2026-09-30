# Grounded documentation

This index lists every document, grouped by who it's for. New to Grounded? Start with the [project README](../README.md), then [try the demo](demo.md).

- [Everyone](#everyone)
- [Users](#users)
- [Team owners and editors](#team-owners-and-editors)
- [Platform admins](#platform-admins)
- [Operators](#operators)
- [Security reviewers](#security-reviewers)
- [Contributors](#contributors)

## Everyone

| Document | What's in it |
|---|---|
| [`../README.md`](../README.md) | What Grounded is, how to try it and deploy it, and the project status |
| [`demo.md`](demo.md) | The demo: `make demo` with Docker only, fake and real models, and what `grounded demo` creates |
| [`releases/v0.1.0.md`](releases/v0.1.0.md) | Release notes for v0.1.0: requirements, installing, known limitations, verifying images |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Every release's changes |
| [`roadmap.md`](roadmap.md) | Candidates for future work, by ID |

## Users

People who chat with agents in the web UI, the widget or the API. There's no separate user guide yet. The UI explains itself, and these sections describe how things work:

| Document | What's in it |
|---|---|
| [DESIGN §2, Concepts](DESIGN.md#2-concepts) | Teams, sources, knowledge bases, agents and classification levels |
| [DESIGN §7.2, Audience](DESIGN.md#72-audience) and [§7.6, Access paths](DESIGN.md#76-access-paths) | Who can use an agent, and through which channels |
| [DESIGN §8, Conversations and analytics](DESIGN.md#8-conversations-and-analytics-adr-0010) | Who can read your conversations (only you, apart from audited break-glass), export and deletion, and what teams see |
| [`../api/openapi.yaml`](../api/openapi.yaml) | The API contract, including the OpenAI-compatible `POST /v1/chat/completions` and API keys |

## Team owners and editors

People who build sources, knowledge bases and agents for a team:

| Document | What's in it |
|---|---|
| [DESIGN §3.5, Team roles](DESIGN.md#35-team-roles) | What owners, admins, editors and members can do |
| [DESIGN §5, Data sources](DESIGN.md#5-data-sources-adr-0008) | Uploads, the web crawler, the allowlist and domain requests, shared sources, the ingestion pipeline |
| [DESIGN §6, Knowledge bases](DESIGN.md#6-knowledge-bases) | Hybrid retrieval and fusion weights |
| [DESIGN §7, Agents](DESIGN.md#7-agents-adr-0009) | Agent settings, strict grounding, citations, audiences, URLs, public guardrails |
| [`phase2-web-sources.md`](phase2-web-sources.md) | The web source in detail: crawl modes, scheduling, repeated-block suppression |
| [`phase3-agents.md`](phase3-agents.md) | Agents, chat and the OpenAI-compatible API in detail |
| [`phase4-publishing.md`](phase4-publishing.md) | Audiences, moderation, the directory, short names and the widget |
| [`systemone.md`](systemone.md) | Optional SystemOne features: passage judging, citation checks and scope checks |

## Platform admins

People who run the admin portal: models, classifications, policies and governance.

| Document | What's in it |
|---|---|
| [DESIGN §4, Data classification](DESIGN.md#4-data-classification-adr-0006) | Levels, model ceilings and audience ceilings |
| [DESIGN §10, Models and gateway](DESIGN.md#10-models-and-gateway-adr-0005-adr-0007) | Connections, models, compatibility flags and embedding profiles |
| [DESIGN §11, Limits and usage](DESIGN.md#11-limits-and-usage) | Limit defaults, ceilings and team overrides |
| [`deployments/README.md`](deployments/README.md) | Deployment profiles, and recipes for self-hosted models (vLLM, SGLang) |
| [`operations/retention.md`](operations/retention.md) | Retention periods, the dry run, and the legal hold procedure |
| [`operations/break-glass.md`](operations/break-glass.md) | Reading a team's content under a break-glass session |
| [`operations/profile-migration.md`](operations/profile-migration.md) | Moving a knowledge base to a new embedding profile |
| [`operations/sso-groups.md`](operations/sso-groups.md) | Mapping identity-provider groups to team roles (SSO group mapping) |
| [`operations/ocr.md`](operations/ocr.md) | OCR for scanned documents: deploying the sidecar, choosing a backend, languages, retrying scanned documents, costs |
| [`operations/costs.md`](operations/costs.md) | Prices, cost modes and monthly team budgets; handling a team whose budget is used up |
| [`operations/evaluations.md`](operations/evaluations.md) | Evaluation sets for knowledge bases and agents: building, running, reading results, automatic runs (team editors and platform admins) |
| [`operations/health.md`](operations/health.md) | Stored health of connections and models: what Test and the scheduled check send, the schedule, error classes, retention, the metrics and alert |
| [`benchmarks/`](benchmarks/README.md) | Measurements that inform model and setting choices: [scale](benchmarks/scale-10k.md), [vector store](benchmarks/vector-gate.md), [boilerplate](benchmarks/boilerplate.md), [self-hosted models](benchmarks/spark-models.md), [SystemOne](benchmarks/systemone.md), [load at 2× the sizing](benchmarks/load.md) |

## Operators

People who deploy, upgrade and monitor an install:

| Document | What's in it |
|---|---|
| [`deployments/kubernetes.md`](deployments/kubernetes.md) | Deploying on Kubernetes: prerequisites, secrets, configuration, safety checks, `grounded doctor`, components, overlays, images, upgrades, troubleshooting |
| [`../deploy/kubernetes/README.md`](../deploy/kubernetes/README.md) | The manifests and their `make` targets |
| [`deployments/README.md`](deployments/README.md) | The deployment profile template and checklist |
| [`../deploy/examples/example.env`](../deploy/examples/example.env), [`../.env.example`](../.env.example) | An example environment file, and every setting described |
| [`operations/upgrades.md`](operations/upgrades.md) | Upgrading an install, expand/contract migrations and the upgrade test |
| [`operations/rotate-keys.md`](operations/rotate-keys.md) | Rotating `ENCRYPTION_KEY` and `API_KEY_PEPPER` |
| [`operations/restore.md`](operations/restore.md) | Backups, and restoring Postgres and the bucket (rehearsed) |
| [`operations/monitoring.md`](operations/monitoring.md) | Metrics, dashboards, alerts and SLOs |
| [`operations/alerts.md`](operations/alerts.md) | A runbook for each alert |
| [`../deploy/observability/README.md`](../deploy/observability/README.md) | The dashboards and alert rules |
| [`operations/retention.md`](operations/retention.md), [`operations/break-glass.md`](operations/break-glass.md), [`operations/profile-migration.md`](operations/profile-migration.md), [`operations/sso-groups.md`](operations/sso-groups.md), [`operations/ocr.md`](operations/ocr.md), [`operations/costs.md`](operations/costs.md), [`operations/evaluations.md`](operations/evaluations.md), [`operations/health.md`](operations/health.md) | Runbooks shared with platform admins |
| [DESIGN §15](DESIGN.md#15-architecture-deployment-and-operations-adr-0001-adr-0013-adr-0014) | Architecture, availability target, backups and delivery |

## Security reviewers

| Document | What's in it |
|---|---|
| [`../SECURITY.md`](../SECURITY.md) | How to report a vulnerability, supported versions, scope |
| [`security/README.md`](security/README.md) | The security package: scope, and how it's kept current |
| [`security/data-flow.md`](security/data-flow.md) | Components, trust boundaries and the data that crosses each one |
| [`security/controls.md`](security/controls.md) | Security controls mapped to DESIGN §16, with their implementation and tests |
| [`security/threat-model.md`](security/threat-model.md) | STRIDE per trust boundary, findings and accepted risks |
| [`security/dependencies.md`](security/dependencies.md) | SBOM and provenance, direct dependencies with licenses, scan results |
| [DESIGN §16, Security and compliance](DESIGN.md#16-security-and-compliance) | The security design |
| [`releases/v0.1.0.md`](releases/v0.1.0.md#verifying-the-images) | Verifying image signatures |

## Contributors

| Document | What's in it |
|---|---|
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Development setup, tests, code style, generated code, how to propose changes |
| [`../CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | The Code of Conduct |
| [`DESIGN.md`](DESIGN.md) | The system design; §19 has the phases and their status |
| [`adr/README.md`](adr/README.md) | Architecture decision records: the format, the process, and an index of all 24 |
| [`../api/openapi.yaml`](../api/openapi.yaml) | The API contract, written before the code (a test checks the server against it) |
| [`../web/README.md`](../web/README.md) | The web UI: layout, bitop-ui components, end-to-end tests, styling policy |
| [`phase2-web-sources.md`](phase2-web-sources.md), [`phase3-agents.md`](phase3-agents.md), [`phase4-publishing.md`](phase4-publishing.md), [`phase5-deploy.md`](phase5-deploy.md) | Phase specifications, with what was built and any deviations |
| [`ui-review/README.md`](ui-review/README.md) | The UI and information-architecture review, with its [workspace](ui-review/workspace-findings.md), [admin](ui-review/admin-findings.md) and [functional](ui-review/functional-findings.md) findings and [verification](ui-review/verification.md) |
| [`benchmarks/README.md`](benchmarks/README.md) | How the benchmarks were run, the tools, and the evaluation data formats |
