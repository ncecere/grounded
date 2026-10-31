# E8 detailed design (#34)

Status: proposed implementation design, written before code, 2026-10-31.
Base: 1a94c2e1317c787c442fb94c4bfc072f022a051b. ADR0030 is Proposed.

## Contracts and authorization

OpenAPI precedes implementation. Existing signed-in profile and anonymous/public
profile contracts gain optional `about`. Directory listings omit it. Existing
routes retain their authorization. A card is built only after existing resolution
of the published version and audience. Disabled agents, inactive teams and current
classification violations yield no About value (existing status profiles stay
compatible). No editor preview is supplied by this change. Private draft and
cross-team facts are not additional grants. No ACL work is included.

The About projection contains a deliberate generic model label (not an upstream
identifier), audience, strictly-grounded mode, configured check states, bounded
source aggregate, last known successful processing observation and a versioned
ownership note. It never includes source/KB IDs, names, hosts, URLs, model private
fields, instructions, prices, or rates. Each field is explicitly constructed.
Source aggregation is limited to 501 distinct current, nondeleted sources attached
to at most five version KBs of this team; 501 means more than 500 and no exact
count. No source bodies are read. Processing time is MAX(processed_at) for ready
documents of these bounded sources, not an author's edit time. If bounded out,
report update unknown rather than an apparently complete observation.

Check states mean configured/enabled, not passed. Resolve existing effective
SystemOne and moderation plans without invoking them. Errors are unknown. The UI
explains skips, timeouts and fallibility; no certification, privacy, provider
retention, fairness or answer-quality guarantee.

## Publication and validation

`ownershipNote` is the only optional authored card text. It lives in Config JSON,
so draft revision If-Match, immutable publish snapshots, unpublish and revert
already apply. No note for older versions. No migration/backfill. Bounded single
line plain display text (500 runes), no control/format characters, HTML or links;
rendered as text, not Markdown. Reject unsafe values rather than clean silently.
No auto-publication, feature enablement or changes to live-profile permissions.

## Handling and statement

Describe application transcript owner access and audited, scoped break-glass,
optional shared conversations, explicit question-sharing opt-in, classification
retention and holds. Do not disclose hold existence or internal hold targets.
Provider retention remains unknown. Do not promise a deletion deadline.

A public platform statement targets WCAG2.1AA, describes repository axe tests as
an automated mechanism rather than proof, and explicitly states that this lane
has not performed a screen-reader audit. Link it from About on all three chat
surfaces. Reporting initially reuses the existing safe instance support contact.
Independent platform-admin contact/institution links use audited revisioned
settings with admin-write/auditor-read and a public safe projection. Editing is
on the statement itself, never in the shared admin-team settings UI.

## UI and verification

Reuse registry Dialog/IconButton, CSS Modules and tokens; shared component across
signed-in/public/widget. Visible widget info action even before the first message.
Dialog keyboard entry/Escape/focus restoration and axe tested where feasible;
390px screenshots/overflow require a browser run and must not be claimed otherwise.
Regression tests precede code: note default/reject/bounds; public published versus
draft/revoked/disabled and cross-team projection. Fake gateway only. Preserve
existing time/race/size guards. Record exact commands and failures outside repo.
Parent still owns full CI/authz/upgrade/browser acceptance.

## Statement settings implementation decision

Ownership notes are excluded from reusable templates: a new team must supply its own contact.
Use expand-only migration 00060: a dedicated singleton stores contact URL and
optional institutional statement URL with revision, updating actor and time. No
existing table is changed and no deployment data is backfilled; old binaries
ignore the table. Contact defaults to empty, with the safe instance support URL
as the public fallback. Admins edit on the statement page; auditors and everyone
else see the public links, never an editing control. GET /v1/accessibility is a
public safe projection; admin GET/PUT /v1/admin/settings/accessibility use existing
platform middleware, explicit admin-only write checks, If-Match and transactional
audit. Contact accepts HTTPS or a simple mailto URL; the statement accepts HTTPS.
Reject credentials, controls, HTML, fragments on mailto, mailto headers, malformed
URLs and values over 2048 bytes. No link is fetched when read or saved.

## Query ceilings

The About metadata projection has a two-second context deadline. Processing
observations stop at 10,001 ready-document rows; beyond 10,000, the timestamp is
unknown. Count output stops at 500 with a `sourcesLimited` flag for more sources.
These are disclosure ceilings, not source-size or quality limits.

Routers explicitly disclose delegation rather than claiming an answer model of
their own. Their destination checks are unknown here; consult the destination
assistant card, subject to the same existing permissions.
