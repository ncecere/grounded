# ADR-0002: Tenancy: teams and consumers

- Status: Accepted
- Date: 2026-09-24

## Context

Many units of an institution will share the platform. Each needs its own sources, KBs, agents, keys, limits and audit trail, and each is approved up to a maximum data classification (ADR-0006). Many more people will only use agents that others have published. We need a tenancy model that keeps content owned by an accountable unit, survives staff turnover, and lets platform admins decide who may hold what data.

## Decision

- **The team is the tenant.** It owns data sources, KBs, agents, API keys, usage, limits and audit entries.
- **Only platform admins create, archive and delete teams.** They also set each team's limits and approved maximum classification. Team admins can see these settings but cannot change them.
- **There are no personal spaces.** Everything a user builds belongs to a team.
- **Consumers and builders.**
  - Any permitted OIDC identity is provisioned on first sign-in as a *consumer*: a user on no team. Consumers can only use published agents they are allowed to use (ADR-0009). They can't list KBs or documents.
  - To build anything, a user must be a team member. "Builder" is this ADR's shorthand for such a member. Team roles are `owner`, `admin`, `editor` and `member`. The permission matrix is in DESIGN.md §3.5. Editors and above create sources, KBs and agents. Members only use team agents and query team KBs.
- **Members are added by email.** A team admin enters an email address. If that person has never signed in, this creates a pending invite. The invite links to their account when someone with that verified email first signs in. Invites expire after 30 days. Admins can manage members but cannot change owners.
- **Requesting a team.**
  - v1: the app links to a service-desk request form (`TEAM_REQUEST_URL`), and a platform admin creates the team by hand.
  - Later: an in-app request form (purpose, owner, requested maximum classification, justification) feeding an approval queue.
- **Platform-shared sources.** Platform admins can own sources that any team may attach to its KBs, subject to classification rules.
- **Platform roles** (`platform_admin`, `platform_auditor`) are separate from team roles. They grant no content access by default (ADR-0011). The first platform admin is bootstrapped once by exact `(issuer, sub)`. The last active platform admin cannot be demoted or suspended.

## Consequences

- Content, keys and agents belong to a unit, not a person. Team service keys (ADR-0012) and team ownership survive staff changes.
- Platform admins control who may hold Sensitive or Restricted data, because they approve each team's maximum classification.
- Consumers get a simple model: they see agents, never data.
- **Costs and risks:**
  - Platform admins are a bottleneck for creating teams. In v1 it is manual work through the service desk.
  - People who just want to experiment must ask for a team or join one.
  - Email invites depend on the OIDC provider returning a verified email that matches the one entered.
  - Stored OIDC claims (affiliation, groups) aren't used for membership in v1, so there is no automatic sync with institutional groups.

## Alternatives considered

- **Self-service team creation.** Rejected for v1. Admins need to approve each team's classification ceiling and limits before it holds data.
- **Personal workspaces.** Rejected. They leave orphaned content and keys when people leave, and they bypass classification approval.
- **Membership driven by OIDC groups.** Not in v1. Claims are stored so this could be added later, but email invites cover the need now.
