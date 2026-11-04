# Configuration as code: export (#32)

**Superseded as the design of record by [`specs/config-as-code-import/DESIGN.md`](specs/config-as-code-import/DESIGN.md)**
(import, dry run and apply, accepted 2026-11-04) and [ADR-0033](adr/0033-team-configuration-as-code.md). This page keeps
the export increment's detailed notes; where they say import is not built, or webhooks refuse, the spec is current:
webhooks now export without signing material, agents are identified by slug, and references may be in the file or the
team.

## Export increment notes (2026-10-31)

## Delivery boundary: read-only export

Team Settings → General now offers **Export configuration** to actual team
editors, admins and owners. GET `/v1/teams/{team}/configuration` downloads
`team-configuration.yaml` as `application/yaml`. It is deterministic
JSON-compatible YAML: decimal literals survive without float conversion or YAML
implicit scalar coercion. No import/dry-run/apply control or executable endpoint
exists. **#32 remains open** for those separate increments and the limits below.

API keys require the explicit `configuration:export` scope, the exact team and
no KB/agent restrictions. `manage` alone is insufficient. Export scope confers
no general REST role or write authority. Personal keys additionally require
current editor-or-higher membership. Platform roles, auditor and break-glass
alone confer no membership. Classification ceilings are rechecked; delegated
callers also refuse classifications that forbid direct retrieval. Key last-use
and pepper-rotation writes are suppressed on this endpoint, not authentication.

Export runs in one repeatable-read **READ ONLY** transaction. It selects only
configuration projections, never content/secret/connection-detail columns.
No network/model/job/audit work occurs. All bytes pass the public strict domain
decoder before any download headers are sent. The filename is fixed, not
interpolated from tenant metadata; responses use no-store and nosniff.

### Strict v1 field inventory and portability

Every resource has a unique exact case-sensitive `name`; unknown keys, including
nested agent settings, are rejected with non-echo structural errors. Existing
syntax/depth/nodes/scalars/aliases/duplicate budgets remain unchanged.

- **sources**: name, description, type, classification key, embeddingProfile
  **key** (not ambiguous display name), status, ocrEnabled, boilerplate optional
  enabled/minDocs/ratio/fuzzy overrides. Web sources additionally carry typed
  web settings: mode, urls, maxDepth, maxPages, includePrefixes, exclude,
  allowSubdomains, useSitemaps, schedule, tags. Uploads contain no file data.
- **knowledgeBases**: name, description, embeddingProfile key, topK, optional
  vectorWeight/keywordWeight, sources as `{namespace: team|platform, name}`.
  Platform links contain names only, never private shared-source configuration.
  Foreign-team source links fail closed.
- **agents**: name, slug, description, accentColor, welcomeMessage,
  starterQuestions, status, draft, publishedVersion number, versions with
  version/note/config. Config has model `{connection, name}` (connection name,
  model key), knowledgeBases `{name, topK?}`, and settings. Settings admit exactly
  the existing agents.Config fields/types/ranges except chatModelId/kbs/tools:
  instructions, temperature, maxOutputTokens, reasoningEffort, retrievalMode,
  maxTurns, contextTokenBudget, filters, minSimilarity, strictlyGrounded,
  refusalMessage, citationMode, queryRewrite, moderation, audience, systemOne,
  rerank, rerankTopN, followUpSuggestions, routable, router.
  All immutable versions are configuration history, not publication requests.
  Null optional stored object members become omission (inherit).
- **evaluationSets**: name, description, knowledgeBase XOR agent name, autoRun,
  cases with question, urls, mustMention, note. No results or picked document data.
- **webhooks**: reserved typed name/url/description/events/enabled/signingSecretRef
  vocabulary; **nonempty lists currently refuse**, for the reason below.

### Explicit whole-export refusals (no silent partial file)

Current webhooks have encrypted signing values but **no unique named signing
credential**. No fabricated UUID/digest/description secret reference is exported.
A reviewed named target-install signing-credential mechanism is still required
before successful webhook export. Similarly MCP tools lack a reviewed portable
identity mapping. Agents using tools, short names or custom answer-cache rows,
source-ID retrieval filters, and sources with contextual configuration rows, currently refuse the whole file
rather than silently lose meaningful settings/consent/spend policy.

Evaluation picked-document UUIDs and filenames are not portable non-content
references and refuse; only explicit URL expectations are supported. The
existing evaluation feature switch applies. API keys continue to have **no
evaluation-question access**, even with export scope: teams with evaluation sets
refuse for keys. This is a bounded refusal, never a filtered “full export”.

Credential-bearing URLs refuse: userinfo, any query/fragment, encoded paths.
Recognizable authorization/cookie/password/key markers in configuration text
also refuse under bounded URL/base64 decoding. This is not general-purpose DLP:
ordinary settings/instructions are explicitly authorized configuration text.
Secrets, raw headers, encrypted values, signing values/hints, key hashes/digests,
model/connection details, uploads, passages and conversations are never selected.

Limits: 1 MiB including final newline; 500 aggregate resources; 1,000 total
evaluation cases, links and versions; existing 16-depth/20,000-node/64 KiB-scalar
budgets. SQL first refuses protected/unnamed kinds using presence-only queries, then
preflights bounded counts and aggregate raw configuration/text byte lengths
(also at most 1 MiB) before selecting any payload. Sentinel limits are 501
resource rows and 1001 dependent rows; per-object config JSON above 64 KiB
refuses. No source bodies are read. Web maxPages is conservatively capped at 1,000,000
by the strict domain validator; ordinary resource-service ranges also apply. Worst-case queries are bounded by these resource/dependency limits.
Missing/ambiguous/out-of-scope references, unknown settings or any limit refuse
with 409 `configuration_unsupported`, no secret-bearing details.

Migration 00061 only expands the API-key scope constraint; no new tables or
deployment data. Downgrade refuses while new-scoped keys remain rather than
silently granting query/write authority. 00060 remains reserved for #34.
No #34 card fields are invented; parent must extend and verify after integration.

## Full workflow proposal (requires parent review)
Team Settings gets download YAML and a YAML import dialog. A textarea/file picker
has an accessible label, bounded size hint and path errors. Dry run freezes the
exact input and shows add/change/no-op/conflict/blocker rows. Editing invalidates
the displayed plan; apply stays disabled until another dry run. On stale 412,
retain the user's YAML and offer revalidation, not automatic retry. Use existing
readonly/dialog patterns, installed bitop-ui, CSS Modules/tokens; test 390 px,
keyboard, focus, axe, loading/error/empty and disabled states.

Future increments must extend OpenAPI beyond the implemented GET configuration with
POST configuration/dry-run, POST configuration/apply under /v1/teams/{team}.
Generate types, never edit generated output. Dry run returns no stored plan: a
canonical source digest, canonical bounded diff, and opaque precondition digest
covering every depended-on object/revision/policy plus actor/team/key grant.
Apply resubmits source and the exact precondition. Rebuild and validate the whole
plan under locks in one transaction, reject stale or altered input before writes.
Plan digest is not authorization or a reusable bearer capability. Parent must
settle signing/expiry/replay semantics before wiring endpoints. No audits from
dry run, even for errors; successful nonempty apply audits nonsecret metadata
in the mutation transaction. Equivalent input yields no rows/jobs/audits.

Existing authorization is not uniform: evaluations currently deny API keys, while
D4 requests pipeline access. This needs an explicit narrowly reviewed policy
extension, not RoleForKey's admin mapping as a blanket bypass. Session callers
need actual editor/admin/owner membership in the named team. Staff/break-glass
alone confer no grant. Read and write checks are separate. API key requires its
own team and manage for configuration writes; query/ingest/mcp are not manage.
Restricted keys must not see out-of-scope objects; an aggregate dependency not
fully in grant produces a blocker, never silently filtered YAML. Evaluate every
source/KB/agent/eval/webhook grant and classification at export, planning and
locked apply; recheck live public-profile restrictions for editors.

Schema: proposed grounded.team/v1; no team UUID or arbitrary IDs. Typed resource
records sorted by kind then exact case-sensitive name; reject name ambiguities
including target-install collisions. Reference identities are typed names within
the target team or explicit permitted platform namespaces. Models use an exact
connection-name/model-name pair; profiles/classifications use exact safe names.
Never auto-discover, synthesize defaults, create keys or resolve across teams.
Shared sources are references only, never copied/reconfigured by team import.
Missing/unavailable/ambiguous refs are blockers. No partial export on unsupported
meaningful settings. The supported strict export inventory and explicit refusals are listed above.

File scope: team sources/settings and web crawl rules, KB source sets/retrieval,
agent live settings/drafts/immutable version configuration, eval sets/questions
with stable non-content expected refs, and webhook settings. No uploads, blobs,
passages, transcripts, evaluation results, secret values, encrypted values or
signing secrets. Only explicitly permitted existing credentials referenced by
safe unique names. Credential-bearing URLs fail closed (including encoded forms
and sensitive query/fragment/path credentials); never merely redact a required
setting then claim lossless round trip. Free text may itself contain user-entered
secrets: export policy and canary tests must cover raw and encoded values.

Conservative semantics: omission never deletes, renames are not inferred, existing
name collisions block unless explicit reviewed matching/precondition proves an
intended update. Immutable source type/profile changes block; profile migration
is separate. Imported agents change drafts only; exported immutable versions are
configuration history, not a request to publish or overwrite published history.
Publication/audience, webhook activation, automatic evals, source crawling and
contextual model opt-in must be separate explicit operations with normal grants,
consent and spend admission. No jobs from loading a file. Existing live/draft and
rollback semantics must be preserved, not routed through privileged handlers.
Any eventual queued effect must use transactional outbox/River insertion after
all validation, with no side effect before commit. Reuse/refactor transaction-
scoped domain validation rather than recursively calling HTTP handlers.

Apply needs deterministic lock ordering and a per-team creation advisory lock;
include reference/policy revisions and detect phantom name collisions from old
writers. Existing resource caps stay inside the transaction. A team revision
alone does not track all object edits. Migration 00061+ if needed, create-only,
no deployment data, compatible with old writers; do not use reserved 00060.
No card fields: parent must extend/verify schema for #34, without inventing its
ownership/contact interface here. No Helm, registry, tracking or release edits.

## Implemented ingress design
Use already-pinned gopkg.in/yaml.v3 as a syntax parser only, constructing no Go
objects from arbitrary tags. Read at most 1 MiB plus one byte. Parse exactly one
nonempty mapping document; reject aliases AND anchors, merge keys, duplicate
mapping keys, non-string keys, custom tags, timestamps/binary, non-JSON scalar
spellings, nonfinite numbers, nulls, nesting > 16, > 20,000 nodes, scalar > 64 KiB,
sequence > 1,000 elements, > 500 total resources. Reject explicit tags to avoid
alternative interpretations. Decode only a fixed versioned team envelope and
five resource-array fields. Each resource must be a mapping with a unique safe
name (1-100 bytes), not bound to any persisted identity by this stage. Empty/whitespace-padded names rejected,
not trimmed into another identity. JSON output is deterministic (sorted map keys
by encoding/json); sequence order remains intact because semantic order is not
yet known. Canonical JSON is for the next strict typed schema stage, not export.

Errors contain fixed codes, line/column and structural paths built from ordinals,
not attacker-supplied keys/values. Do not echo parser errors (they may quote YAML
or credential canaries). Syntax output alone remains untrusted: DecodeDocument adds strict per-resource
field/type/reference checks; Export always uses that boundary.
No database/network/model/job/audit dependencies or dependency injection hooks.

## Verification

Behavioral endpoint red (actual 404 before wiring) and Settings red (missing
control when only its mount is removed) precede green tests. Regression suites
include strict domain/encoding/reference tests, the preserved bounded-parser
tests/fuzz corpus, real isolated PG source/KB/agent/version/evaluation fixtures,
namespaced shared-source refs without configuration extraction, key/role/tenant/
classification denials, config/key/audit/job snapshots, and fake-provider request
counts. Web tests cover no unauthorized control/request, error handling, Blob
download and fixed filename. A Chromium test uses the real endpoint at 390 px,
keyboard activation, axe and a download event. The full web typecheck includes
e2e. Import/dry run/apply and successful named-secret webhook export remain gaps,
not “covered” features. Full commands, failures and actual coverage are retained
in the increment's external artifacts for independent parent review.
