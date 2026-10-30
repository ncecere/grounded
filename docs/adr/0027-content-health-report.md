# ADR-0027: Content health reports are bounded, opt-in, ID-only snapshots

- Status: Proposed
- Date: 2026-10-30

## Context

Roadmap B8 ([`roadmap.md`](../roadmap.md), #22) asks for a report of stale pages, broken links, duplicates across sources, pages never cited and parse failures. Each signal reads data that is private to a team in some way: document titles and URLs (editors only, never platform staff without break-glass, ADR-0011, ADR-0024), which documents answers cited (derived from conversations, ADR-0010), and which files two sources share. A report that is computed on demand could also scan without limit, or probe the network, from a page view. And a stored report is a second copy of team data that has to follow deletion and retention.

## Decision

1. **A report is a snapshot built by a background job on request**, never by opening a page. Opening reads stored rows in pages; it never computes, never makes a network request and never re-checks a link. The job runs on its own queue, off the question and answer path, and imports nothing from retrieval, answering, models, the crawler or an HTTP client (a test enforces this).
2. **It is opt-in twice**: a platform admin switches the feature on (off by default), and a team editor makes each report (no schedule).
3. **It is bounded**: one active report per team, a cooldown between reports, a stored-findings cap per signal, a time limit per signal and per report, a scan bound for answer events, the latest 5 reports per team and 30 days. It can be cancelled. A bound that is hit is shown (`truncated`, or the signal is `unavailable` with a reason); it is never silently a smaller or empty answer.
4. **Signals say what they observed.** Staleness is last successful processing, not last edit. Broken links are failures the latest completed crawl recorded, not a probe. Duplicates are byte-identical files (the raw SHA-256 already stored) among the team's own sources in the report's scope. "Not cited" is absence from the retained, content-free answer events inside a window that starts no earlier than the oldest remaining event, and is unavailable below a minimum number of answers. Anything not measurable is `unavailable` or `not_applicable`, never zero.
5. **The snapshot holds IDs, enums, counts and times, and the one URL a link failure is about.** Titles and file names are joined live when read; hashes, parser messages, passages, questions, answers, users, agents and conversations are never copied. Rows reference documents and sources with `ON DELETE CASCADE`, so a deleted document, source or team takes its findings with it, and reads re-join the live team's rows.
6. **Access is the team's existing content-management grant** (editors, admins, owners), in the app only. Members, API keys, platform staff and break-glass sessions get nothing. Platform-shared sources and other teams are never compared or listed. Each report action is audited with IDs and thresholds only.
7. **Extension point, not a feature**: signals register in a small typed registry; the PII report (#37) can add one without a schema change, under the rule that a finding is an ID and an enum, never matched text. No PII signal exists in this decision.

## Consequences

- A team gets a defensible list of places to look, with the evidence's limits beside it, at no model cost. It cannot get a quality score, and the report says it is not one.
- Because the snapshot omits content and titles are joined live, a deleted or renamed document cannot leak through an old report; the cost is that a finding can quietly disappear, which the report explains ("findings follow deletions").
- "Not cited" will under-report use for teams whose conversations are deleted or whose analytics retention is short, and it needs a minimum of answers to say anything. Teams with little traffic see it unavailable.
- Link results depend on what the crawler keeps (the latest completed crawl's frontier). A later single-page re-fetch discards them; the report then says unknown. Referring pages are not recorded, so none are shown.
- One more feature switch and four tables to maintain; the migration is create-only (ADR-0013), so old and new code run together.

## Alternatives considered

- **Compute on page load.** Rejected: unbounded work and latency from a GET, and no as-of time.
- **Live link probing from the report.** Rejected: a crawler's allowlist, SSRF and robots controls would have to be re-applied to a new egress path, and a page view could schedule remote requests.
- **Copy titles and URLs into the snapshot.** Rejected: an old report would keep showing a removed or renamed document.
- **A near-duplicate or parsed-text hash.** Deferred: it needs reading stored files or passages in bulk; a later signal can add it with its own bounds.
- **Platform staff see aggregate counts per team** (as for gaps). Rejected for now: counts per team reveal nothing the platform needs to operate, and the conservative boundary costs nothing.
- **Include shared sources.** Rejected: team members cannot read shared sources' documents, so listing them, or matching a team file to one, would disclose more than the team can see.
