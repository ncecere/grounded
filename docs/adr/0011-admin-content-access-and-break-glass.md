# ADR-0011: Admin content access and break-glass

- Status: Accepted (amended by [ADR-0024](0024-break-glass-scope-and-approval.md): break-glass can include transcripts; approval is a platform setting)
- Date: 2026-09-24

## Context

Platform admins run the service and need to change policy, models, teams and limits. Teams load Sensitive and Restricted data (ADR-0006), and users expect that nobody else reads their conversations (ADR-0010). Operators occasionally need to look at a team's content to investigate an incident or a support problem, and that access has to be exceptional, visible and accountable.

## Decision

- **No content access by default.** `platform_admin` manages policy, the gateway and models, embedding profiles, source types, the crawl allowlist, classification rules, teams and their limits, shared sources, short names, agent kill switches, the global public-agent switch and legal holds. It cannot read team content (documents, chunks, KB and agent configuration) without break-glass.
- **`platform_auditor`** can read metadata, usage, the audit log and the access log across the platform. It can't change anything or read content.
- **Break-glass:**
  - **Grants** time-limited read access to one team's content: documents, chunks, and KB and agent configuration.
  - **Requires** the admin to give a reason.
  - **Safeguards:** every read under the grant is audited. The grant expires automatically and can be revoked. Team owners are notified in the app and by email when it starts. This notification can't be turned off. The start, every read and the end are all written to `audit_log`.
  - **Excluded:** conversation transcripts. No admin role or break-glass grant can read them.
  - It is read-only. Break-glass doesn't grant write access to team content.
- **Open question:** whether starting a break-glass session needs a second admin's approval (DESIGN.md §18 item 5). This ADR doesn't decide it either way.

## Consequences

- Teams and users can trust that admin access to their data is exceptional and visible to them.
- Auditors can review admin behaviour without having content access themselves.
- **Costs and risks:**
  - Support and incident work is slower. Admins must open a session, give a reason and accept that owners are notified.
  - Auditing every read creates a lot of audit data during a session. That data has its own retention and legal-hold rules.
  - With no second approver (if it stays that way), one admin can start break-glass alone. Notification and audit are the only checks.
  - Admins still control infrastructure (database, backups). This ADR governs application access, not someone with direct database credentials. Those controls sit in operations and the ISO risk assessment.
  - Because transcripts are excluded, some user-reported problems can't be investigated from the platform side.

## Alternatives considered

- **Admins have full content access.** Rejected. It's incompatible with Restricted data and with user trust.
- **No break-glass at all.** Rejected. Incidents and support need a controlled way in.
- **Including transcripts in break-glass.** Rejected. Only the conversation owner can read a transcript (ADR-0010).
- **Always requiring a second approver.** Not decided. It is still an open item.
