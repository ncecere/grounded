# ADR-0025: Community and Enterprise editions

Status: **proposed** (2026-09-30). Decisions are recorded as the owner makes them; open items are listed at the end.

## Context

Grounded is MIT-licensed and public. The owner intends to sell it later. Any licence check placed in MIT code can be removed by a fork, and every released version stays MIT forever, so a licence key alone protects nothing: what protects commercial features is where their code lives and under which licence.

## Decision

1. **Two editions.**
   - **Grounded Community** — everything released so far and the core going forward, under **MIT** (owner, 2026-09-30: stay MIT; adoption matters more than protection at this stage).
   - **Grounded Enterprise** — Community plus features in an `ee/` directory under a source-available commercial licence ("Grounded Enterprise License", modelled on GitLab's: free to read, modify and use for development and testing; production use needs a subscription; reviewed by a lawyer before the first sale).
2. **What goes where.** Community keeps what a team or a single institution needs. Enterprise holds what an organisation needs at scale (identity automation, compliance exports, document-level permissions and enterprise connectors, approvals and delegated administration, advanced MCP governance, chargeback, white-labelling, support). **Features released in Community never move to Enterprise** — a public pledge in the README.
3. **One codebase, two builds.** `grounded` (Community) is built without `ee/`; `grounded-ee` is built with the Go build tag `ee`. Enterprise packages register themselves through small interfaces in the core, so Community compiles and runs without them. Both images are public; the Enterprise image without a licence behaves exactly like Community.
4. **The licence.** A signed JSON licence (Ed25519): customer, edition, features, user tier, not-before and expiry. Verified offline against a public key embedded in the binary; no phone-home. Uploaded in Admin → Licence and shown by `grounded doctor`. After expiry, a 30-day grace period with banners, then Enterprise features become read-only; Community features are never blocked and data is never deleted. The signing key and the issuing tool live in a private repository, the key in OpenBao or a hardware key — never in this repository or its CI.
5. **Pricing** (owner, 2026-09-30): an annual subscription per installation, in tiers of **monthly active users** (for example up to 1,000, up to 10,000, unlimited), with support included. Grounded counts active users locally and shows them in Admin → Licence; customers report the figure at renewal. Nothing is sent automatically. A free non-production licence for testing.
6. **The name** (owner, 2026-09-30): rename the project before the first sale, to a distinctive name cleared by a trademark attorney, and decide it soon (ideally before v0.3.0 ships). "Grounded" is crowded: a UK company, Grounded AI Ltd, sells automated citation verification; Grounded Intelligence (grounded.ai) builds agent-improvement software; several open-source RAG projects share the name. The rename follows ADR-0022's approach (one step across repositories, images, docs, the website and hostnames, with a notice).
7. **Contributions.** A contributor licence agreement (Apache ICLA, via CLA Assistant) before outside pull requests are accepted, so contributions can ship in both editions.

## Consequences

- New organisation-scale features are designed as `ee/` modules behind core interfaces; the core gains extension points (feature registry, hooks) that Community leaves empty.
- CI builds and tests both editions; the authorization matrix and E2E run against both.
- The first Enterprise features follow the plumbing milestone at the start of v0.3 ([`v0.3.0.md`](../v0.3.0.md)).

## Open

- The new name (a shortlist, then an attorney's clearance).
