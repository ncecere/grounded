# Configuration as code: import, dry run and apply (#32)

Status: **accepted** (owner, 2026-11-04: all six decisions as recommended below; deleting objects missing from the file may come later behind an explicit opt-in) and **built** (see "As built" at the end).  Builds on the export that is parked on
[`parked/32-config-as-code`](https://github.com/ncecere/grounded/tree/parked/32-config-as-code)
([design](https://github.com/ncecere/grounded/blob/parked/32-config-as-code/docs/configuration-as-code.md),
ADR-0033 Proposed). That design left five decisions to "the parent". This document makes them, so import can be
built and reviewed against a fixed contract. Scope and the owner's earlier decisions are unchanged
([`v0.8.0.md`](../../v0.8.0.md): export, a dry-run diff, then apply, in the UI and through the API; never files,
passages, conversations or secrets).

## 1. Matching: by kind and exact name, same name = update

The parked design blocked every existing object with the same name "unless explicit reviewed matching proves an
intended update". That makes the main use, keeping a team in step with a file in Git, impossible. Decision:

- An object in the file **matches** the team's object of the same kind and exact, case-sensitive `name`.
  Match = **update**; no match = **create**. Nothing else is inferred: a renamed object is a create, and the
  old one stays.
- **Omission never deletes** in v1. The plan lists objects the team has that the file doesn't, as `not in file`
  (information, no action). Pruning can come later behind an explicit `prune: true` and its own review.
- Changes the domain forbids in place stay **blockers**: a source's type or embedding profile (that is a profile
  migration), an agent's address (slug: changing it breaks links people already have), a knowledge base's embedding profile.
- Shared (platform) sources are references only, as in export: an import can attach one to a knowledge base,
  never create or change it.

## 2. The plan digest: drift detection, not a capability

The parked design asked for signing, expiry and replay rules for the dry run's "precondition digest". Decision:
**none are needed**, because the digest never authorizes anything.

- Dry run returns the diff and `planDigest` = SHA-256 over the canonical source, the team ID, and the revision of
  every object and policy the plan read (matched objects, referenced profiles, classifications, models, the
  team's limits). Nothing is stored.
- Apply sends the same YAML with `If-Match: <planDigest>`. Under the team's advisory lock it **rebuilds the whole
  plan from the YAML** with the caller's own current grants, recomputes the digest, and refuses with `412` (and
  the fresh plan) if it differs. Then it applies in one transaction, rows locked in a fixed order (kind, then name).
- Replay is harmless: re-applying an applied plan either finds the same digest (every change is now a no-op, so
  nothing is written or audited) or a different one (`412`). A digest leaked to someone else gives them nothing:
  they still need their own write grant on the team, and the digest covers the team.

## 3. Agents: drafts only

- Import writes an agent's **draft** (settings, instructions, model, knowledge bases, ownership note when #34
  lands). It never publishes, unpublishes or changes the live audience. The diff shows "published version differs
  from the new draft" so the editor knows to publish.
- `versions` in an exported file are history. Import ignores them and the plan says so once per agent; a file
  without them is equally valid.
- Router destinations and knowledge bases are resolved by name in the same file or the team; missing = blocker.

## 4. Sources: never fetch on import

- New web sources are created **paused**, with their crawl rules. The plan says "created paused: start the crawl
  from the source page". An updated source keeps its status. No crawl, re-index, OCR or contextual-chunk spend
  starts from an import; changing crawl rules on an active source takes effect at its next scheduled crawl, as
  when edited in the UI.
- Upload sources are created empty (there are no files in the file).
- Crawl hosts must already be allowed (Admin → Crawl domains); an unlisted host is a blocker, not a domain request.

## 5. Webhooks: no secret in the file, a new one in the target

This removes the export's refusal of webhooks.

- Export includes webhooks without any signing material (name, URL, description, events, enabled).
- Import **creates** a webhook **disabled**, with a fresh signing secret generated in the target install and shown
  once after apply (as when created by hand). An **update** keeps the existing secret. Turning it on is a separate
  action, so nothing is delivered to a URL from a file alone.
- The URL must pass the platform's destination allowlist; otherwise it is a blocker.

## 6. API keys and evaluation sets

- `configuration:export` (parked, migration 00061) stays read-only. Apply needs a **new** scope,
  `configuration:apply`, plus `manage`, on a key of that team with no KB or agent restrictions. Personal keys also
  need current editor-or-higher membership. Platform roles and break-glass give nothing.
- Evaluation questions stay out of reach of API keys, as today: a key whose plan touches evaluation sets gets a
  blocker. Signed-in editors can import them. (Opening them to keys is a separate decision about evaluation
  privacy, not part of D4.)

## 7. Contract

- `POST /v1/teams/{team}/configuration/plan`: body `application/yaml` (at most 1 MiB). Returns `planDigest`, counts,
  and rows `{kind, name, action: create|update|no-op|not-in-file, changes: [{field, from, to}], blockers: [...],
  notes: [...]}`. Field values are shown for settings, never for secrets (there are none) and never for free text
  over 200 characters (shown as "changed"). No writes, jobs, network or audit.
- `POST /v1/teams/{team}/configuration/apply`: the same body plus `If-Match`. `200` with the applied rows,
  `409` with blockers, `412` with a fresh plan. One audit event per changed object with the existing action names,
  plus `team.configuration_apply` with counts; nothing for a no-op.
- The same strict decoder, limits and refusals as export (1 MiB, 500 resources, 1,000 dependents, no aliases or
  tags). A file from a newer schema version is refused, not partially applied.

## 8. UI

Team settings → General → **Configuration**: Export (exists) and **Import…**, a page (long forms are pages, not
dialogs, since the v0.1 walkthrough). It has a file picker or a paste box, then **Check changes**, which shows the
plan as a table grouped by kind (create, update, blockers first) with the notes. **Apply** is enabled only for a
plan with no blockers, and is disabled again as soon as the YAML changes. On `412` the YAML is kept and the new
plan is shown. It uses the polished bitop-ui components (segmented filters for the action kinds, the description
list for changes). It is tested at 390 px, by keyboard and with axe.

## 9. Order of work

1. Rebase `parked/32-config-as-code` after #34 merges (00060 is #34's; the export's 00061 follows), and close
   the gaps its note lists.
2. Webhook export without secrets (§5), so a full team round-trips.
3. Plan endpoint and the diff (read-only; most of the risk is here, and it ships useful on its own).
4. Apply, the new scope, and the UI page.
5. ADR-0033 updated with §1–6 and accepted.

## Not in v1

Deleting or pruning, renames, cross-team or cross-install references by ID, uploading files, publishing,
starting crawls or evaluation runs, a CLI (owner: may come later, on the same endpoints), and SDKs (owner: no).

## As built (2026-11-04)

Implemented as designed, with these refinements found while building, each following an existing rule of the domain:

- **Identities follow the unique indexes.** Sources and knowledge bases match by name case-insensitively (their
  unique indexes are on `lower(name)`). **Agents match by address (slug)**: agent names are not unique in a team, the
  slug is, so a file that changes a slug makes a new draft agent rather than renaming one (consistent with "renames are
  not inferred"; the slug-change blocker of §1 is therefore unnecessary). Evaluation sets match by name and name their
  agent by slug; webhooks match by exact URL (they have no name). Two team objects that a file cannot tell apart (two
  sets with one name, two webhooks on one URL) block the row.
- **References may be in the file or the team.** A knowledge base can list a team source the file does not carry, an
  agent a knowledge base the team already has, so a small hand-written file can change one object. A file still names
  all five kinds (empty lists are fine).
- **A knowledge base's source list is one of its settings.** Applying makes it search exactly the listed sources:
  others are detached, never deleted.
- **Questions match by their exact text.** New text is added; the same text with other expectations is updated;
  questions only in the team stay. Every question needs an expected page, as in the app.
- **Status and on/off are never applied.** A source keeps its status, an agent its status, a webhook whether it is on;
  the plan notes any difference. New web sources are paused, new agents are drafts, new webhooks are off.
- **Planning is lenient, export strict.** A team object a file cannot carry yet (MCP tools, contextual chunks,
  saved-answer settings, short names, picked evaluation documents) is left out of the comparison and blocks only a row
  that touches it; export still refuses the whole download, as before.
- **The credential check looks for syntax, not words:** an Authorization or Cookie value, `password=…`-style
  assignments, known token prefixes and private keys. "Help students reset their password" is ordinary text.
- **Writes go through the domain services.** Each service's transaction body moved verbatim into a method its public
  operation and a new `…Tx` variant share (sources, knowledge bases and their links, agents, evaluation sets and
  questions, webhooks), so a file meets the same validation, limits, live-profile rule, revisions and audit entries as
  the app; the importer adds one `team.configuration_apply` entry. Evaluation writes still refuse API keys in the
  service, and the plan blocks them first.

API: `POST /v1/teams/{team}/configuration/plan` and `.../apply` (If-Match), and the `configuration:apply` key scope
(admins and owners, only with `manage`). UI: Team settings → General → Import configuration.
