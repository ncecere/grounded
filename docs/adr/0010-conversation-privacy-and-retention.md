# ADR-0010: Conversation privacy and retention

- Status: Accepted (amended by [ADR-0024](0024-break-glass-scope-and-approval.md): break-glass can include transcripts; approval is a platform setting)
- Date: 2026-09-24

> **Note (2026-09-26):** The state public records law and records-management sign-off below apply to the first install; every install confirms its own retention defaults. See [ADR-0018](0018-open-source-institution-neutral.md) and [ADR-0023](0023-no-institution-data-in-the-repository.md).

## Context

Users ask agents questions that can reveal personal, academic or employment matters. Teams want to know whether their agents work. The first institution is subject to a state public records law and needs legal holds. We need to balance user privacy, useful team analytics and records obligations, without hard-coding any deletion period before Records Management and General Counsel confirm the defaults.

## Decision

**Transcripts belong to the user.**
- Only the user who had a conversation can read its transcript. This applies to team members too. Team admins, platform admins and break-glass (ADR-0011) cannot read transcripts.
- **Delete:** users can delete their own conversations. The transcript disappears from their view immediately and is permanently removed according to retention, unless a legal hold applies.
- **Export:** users can export a conversation as Markdown or JSON, including citations.

**Teams see aggregates and metadata only.** Each message event records, without message content:
- agent and version, timestamp, latency, model and token counts
- retrieval hit count, top score, and a no-context flag
- IDs of cited documents
- feedback: thumbs up or down with a fixed reason category (no free text in v1)
- audience type

Teams never see who a user is. Unique-user counts use pseudonymous IDs. Dashboards show conversations over time, satisfaction, the no-context rate, most-cited documents, and latency and tokens by model.

**Access log.** Every use of a Sensitive or Restricted agent is logged (who, which agent, when). Platform auditors can see it.

**Retention.**
- Every retention period is configurable. Nothing is hard-coded to delete. This covers transcripts (per classification level), anonymous transcripts (default 24h, no history across sessions), metadata events, audit logs, the access log and deleted-content grace periods.
- Retention runs as background jobs.
- **Legal hold:** platform admins can place a hold on a team, agent or conversation. A hold pauses all deletion, including user-requested deletions and team purges.
- **Public records caveat:** transcripts may be public records under state public records law. Default periods must be confirmed with the institution's records management and legal counsel before production (DESIGN.md §18 item 6).

**Amendment (v0.4.0, owner 2026-09-30): failed questions and the gap report.** To show teams what their agents can't answer (docs/v0.4.0.md §2):
- The question of an answer that failed (no context, a refusal, every passage judged out, out of scope, a thumbs-down) is kept apart from the transcript, with its embedding and a pseudonymous asker key (an anonymous session counts as one asker). It follows the agent classification's transcript retention and is deleted with its conversation; it is never linked to a person.
- Teams' editors, admins and owners see **topics**: a short label written by the team's chat model from the topic's questions, counts, signals and trend. A topic shows only once **at least 3 different askers** are in it. They never see a question's text or who asked, unless the asker shared it.
- **Shared questions:** on a thumbs-down, the person may tick "Share this question with the team" (off by default). A shared question is shown in full to the team's editors, admins and owners and can be added to an evaluation set.
- Platform admins and auditors see failure counts per team only. Public agent pages tell visitors that questions that can't be answered may be grouped, without their details, to improve the agent.

## Consequences

- Users can trust that their team and admins can't read their questions, which encourages honest use.
- Teams still get enough signal (no-context rate, feedback, citations) to improve their KBs.
- **Costs and risks:**
  - Teams can't read failed conversations to debug an agent. They have to rely on metadata, feedback categories and their own testing.
  - Without free-text feedback, the reasons behind poor answers are coarse.
  - A user-requested deletion isn't immediate if a hold or grace period applies. The UI must say so honestly.
  - Legal and records requirements could force retention defaults that conflict with user expectations. The defaults are unknown until confirmed.
  - Pseudonymous IDs and the access log still hold personal data and need their own retention.

## Alternatives considered

- **Team admins read transcripts for their agents.** Rejected in review. Teams see aggregates and metadata only.
- **Fixed retention periods in code.** Rejected. Periods must be configurable and set by the institution's records policy.
- **No transcript storage at all.** Rejected. Users need history and export, and records law may require retention.
