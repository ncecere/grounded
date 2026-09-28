# ADR-0009: Agents and audience grants

- Status: Accepted
- Date: 2026-09-24

> **Note (2026-09-26):** `all_authenticated` means anyone who can sign in to the install, not one institution's SSO specifically; moderation providers are pluggable (ADR-0019). See [ADR-0018](0018-open-source-institution-neutral.md).

## Context

Teams want to share Q&A over their KBs with their own team, with the whole institution, or with the public. Consumers must never see raw KBs or documents. Every audience must fit the classification of the data behind it (ADR-0006). v1 audiences are coarse, but we expect to need finer ones (OIDC groups, affiliation, other teams) without redesigning.

## Decision

- **The agent is the access grant.** Consumers never get direct KB access. The query path checks one thing: may this principal use this agent version? If so, it retrieves from that version's KBs on the principal's behalf. Consumers can't list KBs or documents or download original files. Citations show a snippet, plus the original public URL for web sources. Uploads are cited by title only.
- **Versioning and publishing.** Edits change a draft. **Publish** creates an immutable `AgentVersion` (instructions, chat model and parameters, 1..n KB references, retrieval mode, grounding, citation and moderation settings). Users always talk to the latest published version. `effective_rank` is computed from the published version. Editors can publish to `team`. Team admins and owners can publish to `all_authenticated` or `public`, without platform approval.
- **Audience grants table:** `agent_audience_grants(agent_id, principal_type, principal_id)`. v1 allows exactly one grant per agent:

| Grant type | Who | Allowed when (default policy) |
|---|---|---|
| `team` | Members of the owning team | Always |
| `all_authenticated` | Anyone signed in with the institution's SSO, including students, affiliates and guests | Effective rank ≤ Sensitive |
| `public` | Anyone, no login | Effective rank = Open |

- **Extending audiences later.** Specific users, OIDC groups, affiliation and other teams can be added as new principal types, using the OIDC claims stored at login. The same rule applies to them: every grant must be allowed for the agent's effective rank.
- **Platform controls:** a global switch that turns off all public agents, and a kill switch per agent (`disabled_by_platform`).
- **URL scheme:** `/a/{team-slug}/{agent-slug}`. An optional short name `/a/{short-name}` is assigned only by platform admins. The stable URL `/a/id/{uuid}` is used by widgets so renames never break them. The OpenAI-compatible model name is `agent:{team-slug}/{agent-slug}`.
- **Strict grounding** is on by default. When nothing scores above the threshold, the agent refuses with the team's custom message. When it is off, the agent may answer from general knowledge but must label the answer as not from sources. Retrieved text is delimited and treated as untrusted.
- **Moderation hook.** Input and output checks are built into the pipeline now. They are required for `public` agents and optional for others. Enabled in Phase 4, once a guardrail or classifier on the institution's infrastructure is available.
- **Public agent guardrails:** per-IP and per-session rate limits, daily query and token caps, concurrency limits, publishable keys (ADR-0012), allowed origins and optional CAPTCHA.

## Consequences

- One authorization check on the query path is easy to reason about and audit.
- Immutable versions make it clear exactly what a user talked to, for analytics and incident review.
- New audience types need a new principal type, not a schema redesign.
- **Costs and risks:**
  - Teams publish `public` agents without platform review. Mislabeling data as Open is the main exposure. The global switch and per-agent kill switch are the backstop.
  - The `public` audience can't be selected until a moderation provider is configured. Public publishing and moderation both arrive in Phase 4.
  - One grant per agent means a team that wants two audiences needs two agents.
  - The UI calls this audience "authenticated". The stored grant type is `all_authenticated`.

## Alternatives considered

- **Granting consumers read access to KBs.** Rejected. It exposes documents and bypasses agent-level controls.
- **Storing the audience as an enum column on the agent.** Rejected. A grants table extends to finer principals without migration.
- **Platform approval for public agents.** Rejected in review. The team decides.
