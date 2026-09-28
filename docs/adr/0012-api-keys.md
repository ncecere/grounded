# ADR-0012: API keys

- Status: Accepted
- Date: 2026-09-24

## Context

The API is first-class. Scripts, integrations and OpenAI-compatible clients call the same `/v1` routes as the browser. Some keys belong to people for personal automation. Others belong to a team's integrations and must survive staff changes. Public widgets need a credential that can be exposed in a browser. Any key that leaks has to be limited in what it can do and in how long it works.

## Decision

- **Personal keys.**
  - Tied to one user and one team.
  - Revoked automatically when the user leaves the team.
  - Members (the lowest team role) can create `query`-scoped keys only. Editors, admins and owners can create personal keys.
- **Team service keys.**
  - Only team admins and owners can create them.
  - They belong to the team, not a person, and survive staff changes.
  - Each has a named responsible contact who can be reassigned.
- **Rules for all keys:**
  - Scopes: `query`, `ingest`, `manage`.
  - Can be restricted to specific KBs or agents.
  - Have an expiry date.
  - Only a digest, hashed with a server-side pepper, is stored. The secret is shown once at creation.
  - Can never administer the platform.
  - Creation and revocation are audited.
- **Classification limits.** Each classification level sets whether team API keys may call `/retrieve` directly (ADR-0006). Queries through keys go through the same query-time policy checks as browser sessions.
- **Agent publishable keys.** They can call only one published agent. They are meant for the embeddable widget and are restricted to that agent's allowed origins (CORS). Along with rate limits and optional CAPTCHA, they are one of the guardrails for public agents (ADR-0009).
- **Limits** apply per API key as well as per team, user and agent (DESIGN.md §11). Usage events record the key.
- The credential decides what a request may do. The same `/v1` routes serve sessions and keys.

## Consequences

- Team integrations don't break when staff leave, and each service key has an accountable contact.
- A leaked key's damage is bounded by scope, KB/agent restriction, expiry and rate limits.
- Peppered digests mean a database dump alone doesn't reveal usable keys.
- **Costs and risks:**
  - The pepper becomes a critical secret. Losing it invalidates every key, and rotating it needs a plan (ADR-0014 documents secret rotation).
  - Keys that are shown once will be lost by users, who then have to create new ones.
  - Publishable keys are public by design. Origin checks don't stop non-browser clients, so rate limits and caps are the real control.
  - Personal key scopes are capped by role: members get `query`, editors get `query` and `ingest`, admins and owners get all scopes. Team admins and owners create publishable keys when they publish an agent for embedding.

## Alternatives considered

- **Personal keys only.** Rejected. Integrations would break when their creator leaves.
- **Storing keys encrypted instead of hashed.** Rejected. We never need to recover a secret.
- **Keys that can perform platform administration.** Rejected. Admin power stays with interactive, audited sessions.
