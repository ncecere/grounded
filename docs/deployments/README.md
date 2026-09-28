# Deployment profiles

Grounded is institution-neutral ([ADR-0018](../adr/0018-open-source-institution-neutral.md)). Code, migrations and default configuration name no institution, gateway vendor or jurisdiction. Everything that belongs to one install lives in a **deployment profile**.

**Profiles are kept outside this repository** ([ADR-0023](../adr/0023-no-institution-data-in-the-repository.md)). Each install keeps its own profile, environment file and evaluation data wherever it keeps its other operational documents: a private repository, a wiki, its GitOps configuration. This repository holds only the neutral template below and a neutral example environment file, [`deploy/examples/example.env`](../../deploy/examples/example.env).

A profile records:
- the settings the install runs with, and why;
- the install's policies that the product only provides mechanisms for (what each classification level means, which data is prohibited, retention periods);
- what was measured on the install's gateway and hardware;
- the questions that only the install can answer (hosting, legal sign-off, security review).

To run Grounded on Kubernetes, see [`kubernetes.md`](kubernetes.md): the generic manifests in [`deploy/kubernetes/`](../../deploy/kubernetes), the secrets they expect, and how an install's own overlay consumes them.

[`DESIGN.md`](../DESIGN.md) describes the general system. When a profile and DESIGN.md disagree about product behaviour, DESIGN.md wins and the profile is out of date.

## Writing a profile

Copy the outline below into a Markdown file in the install's own repository or document store. Keep secrets out of it: a profile names where a secret lives, never its value. Start the install's environment file from [`deploy/examples/example.env`](../../deploy/examples/example.env) and keep it next to the profile, with placeholders for secrets.

### 1. Identity and theme
The settings in DESIGN.md §15, "Configuration and instance identity":
- `INSTANCE_NAME`: the product name users see (default `Grounded`).
- `ORG_NAME`: the organisation's name, shown in the UI and used in the agent preamble (empty names none).
- `UI_THEME`: `neutral`, the only theme Grounded ships. Branding comes from the names and the logo; institution themes are not kept in this repository.
- `UI_LOGO_URL`, `SUPPORT_URL` and `TEAM_REQUEST_URL` (where people ask for a team, for example a service-desk form).

The product's identity is exposed to the UI through `GET /v1/auth/config` (`instance`).

### 2. Sign-in
- The identity provider and how it speaks OIDC: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (from a secret), `OIDC_SCOPES`, `OIDC_EMAIL_CLAIM`, `OIDC_REQUIRE_VERIFIED_EMAIL`, and `OIDC_GROUPS_CLAIM` if you map IdP groups to teams ([SSO groups](../operations/sso-groups.md)).
- Who may sign in (`OIDC_ALLOWED_EMAIL_DOMAINS`). Everyone who can sign in counts as `authenticated` for agent audiences (DESIGN.md §7.2), so say who that includes: staff, students, affiliates, guests.
- How the first platform admin is set (`BOOTSTRAP_ADMIN_SUBJECT`).
- Which claims the IdP releases (affiliation, groups), for later audience rules.

### 3. Model gateway and models
- The gateway: product, base URL, how keys are issued, and its measured limits (requests per minute per key, inputs per request, timeouts).
- The connection's `requestsPerMinute`, set just below the key's limit (DESIGN.md §5.5).
- Chat and embedding models, each with its maximum classification and compatibility flags (tool calling, `reasoning_effort`, `tool_choice`, thinking field).
- The default embedding profile: model, dimensions, storage type, document and query prefixes, chunk size and overlap.
- How the gateway reports embedding tokens compared with Grounded's own count (DESIGN.md §18 item 9).
- The moderation provider for public agents, once chosen (ADR-0019).

### 4. Data classification policy
The product enforces levels, model ceilings and audience ceilings (DESIGN.md §4). The profile says what they mean for this install:
- the levels and the wording admins enter as their descriptions;
- which data is prohibited outright, and where the terms of use say so;
- which models may process each level;
- the laws or institutional policies behind these choices.

### 5. Retention and records
- The retention period for each level, anonymous transcripts, conversations users deleted, metadata events, the usage ledger, audit, the access log, deleted content and expired invites (DESIGN.md §8), and whether they are set as `RETENTION_*_DAYS` or in Administration → Retention ([`docs/operations/retention.md`](../operations/retention.md)).
- Who signed them off (records management, legal counsel) and when. Until sign-off, say so.
- Any public records law that applies to transcripts.

### 6. Hosting and operations
- Where it runs (Kubernetes distribution and cluster; the overlay and which [components](kubernetes.md#components) it uses), Postgres (managed or CloudNativePG), S3-compatible storage for data and backups, Valkey topology, ingress and TLS, the secrets backend, the SMTP relay.
- Who operates it, on-call hours and where alerts go.
- Required registries, GitHub organisations or GitOps tools.
- Security review: which process applies, and its status.

### 7. Crawling
- `CRAWL_ALLOWLIST_SEED`: host patterns added to the crawl allowlist once, on first start (for example `*.example.edu`). Without it a fresh install can't crawl anything until an admin adds patterns.
- The install's policy for domain requests from teams.
- `CRAWL_USER_AGENT`. The default, `grounded/1.0 (+<APP_URL>/bot)`, points site owners at a `/bot` page that Grounded doesn't serve yet; set a user agent with a real contact URL if site owners need one.

### 8. Sizing, results and open questions
- Planning estimates (documents, chunks, users, chats, queries per day) and the load-test target (DESIGN.md §1).
- Links to benchmark or evaluation runs made on this install.
- Open questions, each with an owner.

## Self-hosted models

Recipes for OpenAI-compatible model servers an install runs itself (vLLM, SGLang), measured in [`spark-models.md`](../benchmarks/spark-models.md). Record the values an install actually uses in its own profile. The compatibility flags are listed in DESIGN.md §10.

**Connection.** The base URL includes `/v1` (`GET /v1/models` answers on vLLM and SGLang). A single GPU serves few requests at once (about 2 chat streams for a 27B model); further requests queue on the server, since `maxConcurrentRequests` applies only to SystemOne calls so far. Chat and embeddings on the same GPU slow each other.

**Embeddings: Qwen3-Embedding (e.g. `Qwen/Qwen3-Embedding-4B`, 2560 dimensions).**
- Model: kind `embedding`, dimensions 2560, `maxInputTokens` 32768. Set `supportsDimensionsParam` only if the server was started with Matryoshka support (vLLM: `--hf-overrides '{"is_matryoshka": true}'`); otherwise it answers `400 … does not support Matryoshka embeddings` and Grounded must shorten the vectors itself (the default).
- Profile:
  - **query prefix** `Instruct: <task>\nQuery: ` with a one-sentence task, for example `Instruct: Given a question, retrieve passages from the organisation's web pages that answer it` followed by a newline and `Query: `. Without an instruction the model loses 0.04–0.10 nDCG@10;
  - **document prefix** empty (documents take no instruction);
  - **output dimensions 768**, `halfvec`: no measurable loss against 2560, at about a quarter of the storage and a fifth of the exact-search time;
  - **default fusion weights** vector 1, keyword **0–0.02**: keyword fusion lowers this model's scores, unlike nomic's;
  - chunk size 512, overlap 64.
- Switching an existing install to this profile is a profile migration (ADR-0007).

**Chat: Qwen3 on SGLang (e.g. `qwen3.8-27b`).**
- Model: kind `chat`, `supportsTools` true, `contextWindow` the server's `max_model_len` (e.g. 65536), `maxOutputTokens` 8192.
- Compatibility:
  - `extraBody` `{"chat_template_kwargs": {"enable_thinking": false}}`. Thinking is on by default and makes answers take minutes on one GPU (median 83 s against 14 s without it, for the same answer quality), and a small output limit then goes entirely to reasoning;
  - `supportsToolChoice` **true**: SGLang honours `tool_choice: "required"`;
  - `supportsDeveloperRole` false (SGLang rejects the `developer` role), `supportsStreamUsage` true, `maxTokensField` `max_tokens`, `thinkingField` `reasoning_content` or empty, `supportsReasoningEffort` false.
- Reasoning tokens (SGLang reports them at the top level of `usage`) and the blank `"\n\n"` Qwen streams before answers and tool calls need no setting.
- Self-hosted models are candidates for the most sensitive data levels, subject to the install's policy (DESIGN.md §4).

## Keeping profiles current
- When a Grounded release changes settings an install uses, update the install's profile as part of the upgrade.
- New product work stays neutral. If a feature needs an institution-specific value, add a setting with a neutral default; each install records its value in its own profile.
- Nothing institution-specific is added to this repository: no profiles, themes, fixtures, test data or evaluation sets ([ADR-0023](../adr/0023-no-institution-data-in-the-repository.md)).
