# ADR-0027: Content health reports are bounded, opt-in, ID-only snapshots

- Status: Proposed
- Date: 2026-10-30

## Context

Roadmap B8 ([`roadmap.md`](../roadmap.md), #22) asks for a report of stale pages, broken links, duplicates across sources, pages never cited and parse failures. Each signal reads data that is private to a team in some way: document titles and URLs (editors only, never platform staff without break-glass, ADR-0011, ADR-0024), which documents answers cited (derived from conversations, ADR-0010), and which files two sources share. A report that is computed on demand could also scan without limit, or probe the network, from a page view. And a stored report is a second copy of team data that has to follow deletion and retention.

## Decision

1. **A report is a snapshot built by a background job on request**, never by opening a page. Opening reads stored rows in pages; it never computes, never makes a network request and never re-checks a link. The job runs on its own queue, off the question and answer path. Its package imports nothing directly from retrieval, answering, models, the crawler or an HTTP client (a test enforces the direct imports; the package reaches `net/http` transitively through `teams`, so what is claimed is that no code on the report's path makes a call, shown by a test that counts HTTP and model requests during a report: evidence, not proof).
2. **It is opt-in twice**: a platform admin switches the feature on (off by default), and a team editor makes each report (no schedule).
3. **It is bounded**: one active report per team, a cooldown between reports, a stored-findings cap per signal, a time limit per signal (a context deadline on the report's queries; the driver cancels the statement on the server; not a server statement timeout) and per report, a scan bound for answer events and a bound on the agents read, the latest 5 reports per team and 30 days. It can be cancelled. A bound that is hit is shown (`truncated`, or the signal is `unavailable` with a reason); it is never silently a smaller or empty answer.
4. **Signals say what they observed.** Staleness is last successful processing, not last edit. Broken links are failures the latest completed crawl recorded, not a probe. Duplicates are byte-identical files (the raw SHA-256 already stored) among the team's own sources in the report's scope. "No retained citation evidence" (key `never_cited`) is absence from the retained, content-free answer events inside a **team-wide** window that starts no earlier than the oldest remaining event; it is not a claim that a document is never cited, unused or poor, nor that it had a fair chance of being cited. Only documents of sources an active published agent reaches through a knowledge base are judged, only when enough answers that could have cited something were kept since the source became reachable (the later of its attachment and the agent's publish time, rounded up to a UTC day, never invented), and the signal is unavailable below the minimum or when the agents or events exceed their bounds. Anything not measurable is `unavailable` or `not_applicable`, never zero.
5. **The snapshot holds IDs, enums, counts and times, and the one URL a link failure is about.** Titles and file names are joined live when read; hashes, parser messages, passages, questions, answers, users, agents and conversations are never copied. Rows reference documents and sources with `ON DELETE CASCADE`, so a deleted document, source or team takes its findings with it, and reads re-join the live team's rows and show a finding only while it still holds (live scope, source revision and classification and the latest crawl for a link's address, two sources for a duplicate group). A link's address is stored without credentials, query and fragment (its path can still be sensitive). A store skips what was deleted since collection and never leaves the report running.
6. **Access is the team's existing content-management grant** (editors, admins, owners), in the app only. Members, API keys, platform staff and break-glass sessions get nothing. While the feature is off, the same people can still cancel and delete (and see kept reports as metadata-only stubs), so switching it off never strands a copy; nothing a report found is readable then. Platform-shared sources and other teams are never compared or listed. Each report action is audited with IDs and thresholds only.
7. **Extension point, not a feature**: signals register in a small typed registry; the PII report (#37) can add one without a schema change, under the rule that a finding is an ID and an enum, never matched text. No PII signal exists in this decision.

## Consequences

- A team gets a defensible list of places to look, with the evidence's limits beside it, at no model cost. It cannot get a quality score, and the report says it is not one.
- Because the snapshot omits content and titles are joined live, a deleted or renamed document cannot leak through an old report; the cost is that a finding can quietly disappear, which the report explains ("findings follow deletions").
- "No retained citation evidence" sees only what the analytics events keep. Deleting a conversation does not delete its event (`message_events.message_id` is `ON DELETE SET NULL`); the platform-wide analytics-events period does, so a short period shrinks the window. It needs a minimum of answers (team-wide and per source) to say anything, so teams with little traffic, or traffic concentrated in one agent, see it unavailable or partial. Exposure is known only at the knowledge-base level and only from the current attachment and publish times.
- Link results depend on what the crawler keeps (the latest completed crawl's frontier). A later single-page re-fetch discards them; the report then says unknown. Referring pages are not recorded, so none are shown.
- One more feature switch and four tables to maintain; the migration is create-only (ADR-0013), so old and new code run together.

## Alternatives considered

- **Compute on page load.** Rejected: unbounded work and latency from a GET, and no as-of time.
- **Live link probing from the report.** Rejected: a crawler's allowlist, SSRF and robots controls would have to be re-applied to a new egress path, and a page view could schedule remote requests.
- **Copy titles and URLs into the snapshot.** Rejected: an old report would keep showing a removed or renamed document.
- **A near-duplicate or parsed-text hash.** Deferred: it needs reading stored files or passages in bulk; a later signal can add it with its own bounds.
- **Platform staff see aggregate counts per team** (as for gaps). Rejected for now: counts per team reveal nothing the platform needs to operate, and the conservative boundary costs nothing.
- **Include shared sources.** Rejected: team members cannot read shared sources' documents, so listing them, or matching a team file to one, would disclose more than the team can see.

## Amendments before acceptance (2026-10-30)

An independent review of the first implementation found its authorization boundaries sound and these statements or behaviours wrong. This record is still **Proposed**; the decision above is amended in place, and the changes are listed here so the review history is not lost.

- **Concurrent deletion.** A report is stored minutes after it is collected. A source or document deleted in between used to roll the store back on a foreign-key error and leave the report running until the hourly job marked it failed, wrongly as timed out. The store now claims the report, locks what it references, skips what vanished (adjusting the counts) and ends the report failed on any other error.
- **"Not cited" was misleading.** Its window began at the first retained team event, not at any document's exposure to an agent, so a source attached late, a newly published agent or traffic concentrated in one agent could make documents look uncited. It is renamed in words to *no retained citation evidence*, restricted to sources a published agent reaches, judged only against answers since they became reachable, counts only answers that could have cited something, and bounds its agent list.
- **Retention was described wrongly.** Conversation deletion does not delete analytics events (`ON DELETE SET NULL`), and the analytics period is global, not the classification's conversation retention. The documents now say so; no retention period changes.
- **Link addresses** are stored without credentials, query and fragment and are hidden once they no longer describe the source (revision, classification, newer crawl) or its scope.
- **Switching the feature off** now stops a running report at the next boundary, and cancel and delete stay available to the team.
- **Duplicates** are read-time eligible only while they span two sources, counted in groups, paged in whole groups.
- **The "imports nothing transitively" claim** was too strong (the package reaches `net/http` through `teams`) and the 45 s limit is a client deadline, not a server statement timeout. Both are reworded; tests count HTTP and model requests, and cancel a real `pg_sleep` on the server.
