# ADR-0024: Break-glass as built: transcripts in scope, approval as a setting

- Status: Accepted
- Date: 2026-09-27
- Amends: [ADR-0010](0010-conversation-privacy-and-retention.md) (who can read a transcript) and [ADR-0011](0011-admin-content-access-and-break-glass.md) (what break-glass grants, the open approval question)

## Context

ADR-0011 defined break-glass as time-limited, audited read access to one team's documents, chunks, and KB and agent configuration, and excluded conversation transcripts, which ADR-0010 reserves to the user who had the conversation. It left open whether a second admin must approve a session (DESIGN.md §18 item 5).

For Phase 5 (docs/phase5-deploy.md §5 P4 and §9 decision 3) the owner decided:

- Approval is a platform setting. By default one platform admin starts a session alone with a written reason; an install can require a second platform admin's approval.
- A session's scope is the team's conversations, its documents, or both. Investigating a harmful or wrong answer, or a report that an agent disclosed something it shouldn't have, needs the transcript: the metadata teams see (ADR-0010) doesn't show what was asked or answered.

## Decision

**Scope.** A break-glass session grants one platform admin read access to one team's content of the kinds it names:

- `documents`: the team's data sources, their documents and passages, document tags, crawl history and repeated blocks.
- `conversations`: the list of conversations with the team's agents (title, agent, times, question count; never who had them) and their transcripts.

Nothing else changes. The session is not a role: the admin can't write anything, can't export, rename or delete a conversation, give feedback or chat as the user, and doesn't gain access to KB or agent configuration, keys, usage or analytics beyond what platform admins already see. API keys never carry a session. Deleted conversations stay hidden.

**Time.** Default 1 hour, at most the platform maximum (8 hours by default, 15 minutes to 24 hours). The admin can end it early and any other platform admin can revoke it. Access stops at the end time on the next request, whether or not the expiry sweep has run.

**Approval.** A platform setting (`break_glass_settings`), off by default. When on, a session is pending until a different platform admin approves it (self-approval is refused) or denies it with a reason; a request nobody decides lapses after the approval timeout (1 hour by default). A session's time starts when it is approved.

**Accountability.**

- The start, approval, denial, withdrawal, end, revocation and expiry are audited, and so is every read (`breakglass.read`, with the session ID, the kind of read and the target ID; never content). Reads appear in the team's audit log and in the session's read log.
- The team's owners are notified in the app and by email when a session starts (or is approved) and, when it ends, with a summary of what kinds of things were read and how many. Neither notification can be turned off.
- While a session is active, the reading admin sees a banner with the time left and End now; the team's owners see a notice on the team's pages.

**Transcripts.** ADR-0010's rule becomes: only the user who had a conversation can read its transcript, except a platform admin under an active break-glass session with the conversations scope on that team. Team members, team admins and owners still never read other people's transcripts.

## Consequences

- Admins can investigate harmful or wrong answers and data-disclosure reports from the platform side, which ADR-0011 listed as a cost of excluding transcripts.
- Users' conversations are no longer readable by their user alone. The privacy promise becomes "only you, and a platform admin under an audited, time-limited break-glass session that your team's owners are told about". Installs should say so in their terms of use and privacy notice, and should consider requiring a second admin's approval.
- Owners learn that a session happened and what kinds of things it read, but not which user's conversations; the reads list conversation IDs only.
- Every read is an audit row. A long session over a large team adds many rows; they fall under the audit log's retention and legal-hold rules.
- The admin still controls infrastructure (database, backups); this governs application access only, as in ADR-0011.

## Alternatives considered

- **Keep transcripts out of break-glass (ADR-0011).** Rejected by the owner for Phase 5: investigating answers needs them.
- **Always require a second admin.** Rejected as the default: small installs may have one platform admin. Available as the setting.
- **Show which user had each conversation.** Rejected: the investigation needs the content, not the person; the access log (Sensitive and Restricted agents) already records who used an agent for auditors.
- **Grant break-glass as a temporary team role.** Rejected: a role would also grant writes and every other team page. An explicit grant checked on each content read keeps the scope exact.
