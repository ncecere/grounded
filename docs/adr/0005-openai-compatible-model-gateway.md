# ADR-0005: OpenAI-compatible model gateway

- Status: Accepted
- Date: 2026-09-24 (revised 2026-09-25: generic proxies, connections added by admins)

> **Note (2026-09-26):** "Only institution-hosted models for Restricted" is the first install's policy, not product behaviour: admins tag each model with its maximum classification. See [ADR-0018](0018-open-source-institution-neutral.md) and [ADR-0023](0023-no-institution-data-in-the-repository.md).

## Context

The first institution already runs model gateways: a LiteLLM-based AI gateway and open-model-gateway (OMG). They expose OpenAI-compatible APIs in front of both institution-hosted and external models. We need chat and embedding models, per-team usage attribution, and a guarantee that Restricted data only reaches institution-hosted models (ADR-0006). We don't want provider-specific SDK code or to have to re-release when a model is added.

## Decision

- **Connections to OpenAI-compatible proxies.** Platform admins add one or more connections (name, base URL, API key, timeout) in the admin portal. The key is stored encrypted (AES-256-GCM, `ENCRYPTION_KEY`, with a previous key kept for rotation) and is never returned by the API.
- **No vendor-specific code.** We only use the OpenAI API surface: `/models`, `/embeddings` and `/chat/completions`, with `/rerank` and `/moderations` later. LiteLLM, open-model-gateway and vLLM are all just "an OpenAI-compatible proxy".
- **Models are added by hand.** "Test connection" lists the proxy's model IDs to help fill in forms, but nothing is added automatically. Each model has:
  - a connection and an upstream model ID
  - a kind: `chat`, `embedding`, `rerank` or `moderation`
  - a maximum classification
  - capabilities: context and output limits, tools and vision for chat; dimensions and input limit for embeddings
  - compatibility flags for proxy quirks (ADR-0017)
  - an enabled switch
- **Test model** sends a tiny real request and reports, for example, the actual embedding dimensions.
- **Classification tagging.** At launch, only institution-hosted models are tagged for Restricted. ADR-0006 rule 4 checks these tags at write time and again at query time.
- **Usage tags.** Every call is tagged with team, agent and user, so the proxy's spend reports match our `usage_events` ledger.
- **Concurrency.** A global limit caps how many model calls run at once. Ingestion embedding runs at lower priority than live queries.
- **When a proxy is unavailable,** chat and retrieval return `model_unavailable`. Admin screens and document management keep working, and ingestion jobs retry later.

## Consequences

- Switching or adding proxies is an admin action, not a release. Several proxies can be used at once.
- New models need no release, only admin enablement and tagging.
- Classification is enforced by our own catalog tags, not by trusting gateway routing.
- **Costs and risks:**
  - The gateway is a hard dependency for chat, retrieval (query embedding) and ingestion. Our SLO can't be better than the gateway's (ADR-0013).
  - Correct classification depends on admins tagging models correctly. A mistagged external model could receive Restricted data.
  - We only get what the OpenAI-compatible surface offers. There is no reranker on the gateway today, so reranking isn't in v1.
  - Gateway throughput for `gpt-oss-120b` and `nomic-embed` hasn't been measured against the backfill yet (DESIGN.md §18 item 7).
  - We store proxy API keys ourselves, so `ENCRYPTION_KEY` becomes a critical secret. Losing it means re-entering every key.
  - No automatic import means more admin typing. The model list from "Test connection" reduces this.

## Alternatives considered

- **Provider SDKs (OpenAI, Anthropic, etc.) called directly.** Rejected. That means more code, per-provider credentials, and it bypasses the institution's gateway controls and spend tracking.
- **Trusting the gateway to enforce data classification.** Rejected. The rule has to hold in our own policy checks.
- **Auto-enabling every imported model.** Rejected. An admin must set the classification ceiling first.
- **Vendor-specific catalog adapters (LiteLLM `/model/info`, OMG).** Rejected. They tie us to one proxy's API; `/models` plus manual entry works for any proxy.
- **API keys only from Kubernetes Secrets.** Rejected. Admins need to connect proxies from the portal without a redeploy.
