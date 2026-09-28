# Break-glass: reading a team's content

Platform admins can't read a team's documents or anyone's conversations. When an incident or a support problem needs that, a platform admin opens a **break-glass session**: time-limited, read-only access to one team's conversations, documents or both, with a written reason. Every read is audited, and the team's owners are told. The decision behind it is [ADR-0024](../adr/0024-break-glass-scope-and-approval.md), which amends ADR-0010 and ADR-0011.

## What a session allows

| Scope | The admin can read | Through |
|---|---|---|
| Documents | The team's data sources, their documents and passages, document tags, crawl history and repeated blocks | The team's **Data sources** pages, and the same `GET /v1/teams/{team}/sources/…` routes as members |
| Conversations | The list of conversations with the team's agents (title, agent, times, number of questions; never who had them) and their transcripts | **Admin → Break-glass → Read conversations**, `GET /v1/teams/{team}/conversations` and `GET /v1/conversations/{id}` |

Nothing else changes. The admin can't upload, edit, sync, delete, export, rename, give feedback or chat, and sees no knowledge base or agent settings, keys or usage beyond what platform admins always see. Sessions work in a browser session only, never with an API key. Deleted conversations stay hidden.

## Settings

**Admin → Break-glass → Settings** (platform admins change them; auditors read them). Changes are audited as `platform.break_glass_settings_update` and apply to sessions started afterwards.

| Setting | Default | Range |
|---|---|---|
| Require a second admin's approval | Off: one admin with a written reason | On or off |
| Longest session | 8 hours | 15 minutes to 24 hours |
| Requests lapse after (with approval on) | 1 hour | 5 minutes to 7 days |

A session lasts 1 hour unless the admin picks another length (never more than the longest). Consider turning approval on if your install has more than one platform admin, especially where Restricted data or sensitive conversations are expected. Say in your terms of use or privacy notice that platform admins can read conversations under break-glass.

## Starting a session

1. **Admin → Break-glass → Start a session.**
2. Choose the team, write the reason (at least 20 characters; the team's owners see it, so name the ticket or incident), tick **Documents**, **Conversations** or both, and pick the duration.
3. Without approval the session starts at once. With approval it waits: the other platform admins get a notification, and one of them approves it (the time starts then) or denies it with a reason. You can withdraw your request, and nobody can approve their own. A request nobody decides lapses.
4. While it's active, a banner at the top of every page shows the team, the time left and **End now**. Use **Documents** to open the team's data sources and **Conversations** to open the conversation reader.
5. End it as soon as you're done. Another platform admin can revoke it from the session's page.

One admin can have one open session per team. Access stops at the end time on the next request, even before the expiry is recorded.

## What the team's owners see

- **When it starts** (or is approved): an in-app notification and an email with the admin's name, what they can read, until when, the reason and who approved it. It can't be turned off.
- **While it's active:** a notice at the top of the team's pages with the same details.
- **When it ends** (ended, revoked or expired): a notification with a summary, for example "Conversation transcripts: 3 conversations (5 reads)" and "Documents: 12 documents (14 reads)". It names kinds and counts, never which conversation or what it said. It can't be turned off either.
- **The team's audit log** (Team settings → Audit log, owners and admins) lists the session and every read.

## Audit

Every step is in the audit log, with the session as the target and the team set, so the platform log and the team's log both show it:

| Action | When |
|---|---|
| `breakglass.start` | A session was started, or requested when approval is on |
| `breakglass.approve`, `breakglass.deny` | Another admin decided a request (the denial with its reason) |
| `breakglass.cancel` | The admin withdrew a request |
| `breakglass.end` | The admin ended it, or another admin revoked it (`metadata.revoked`) |
| `breakglass.expire`, `breakglass.request_expire` | The session's time ran out, or a request lapsed (system) |
| `breakglass.read` | One read: `metadata.sessionId`, `metadata.kind` (for example `document`, `passages`, `conversation_list`, `conversation`) and the target (team, source, document or conversation ID). Never content. |

A read is recorded when it's allowed, before the content is fetched; if recording fails, the read fails. **Admin → Break-glass** lists every session; open one for its counts by kind and its read log. Auditors can see all of it.

The worker records expiries every minute (`breakglass.sweep`). Opening Admin → Break-glass records any that are due, too.

## Checks for a security review

- Without a session, a platform admin gets 404 on the team's content routes and on transcripts, and 403 on the team conversation list, like any non-member. Team members and admins get 403 on the conversation list and 404 on others' transcripts, with or without a session.
- The grant is read from the database on every content request (`internal/authz` `BreakGlassSession.Allows`): the same admin, the same team, the scope, and the time window. Demoting the admin ends their access at once.
- The rules are unit-tested in `internal/authz/breakglass_test.go`; the API behaviour (audit per read, notifications, approval, expiry, denial after end) in `internal/httpapi/breakglass_integration_test.go`.
