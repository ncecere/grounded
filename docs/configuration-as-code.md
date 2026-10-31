# Lane 32 design, written before implementation

## Delivery boundary
This checkpoint implements the hostile-YAML ingress boundary only, not the product
workflow. It must not be exposed as a validated plan, export, dry run or apply.
The full D4 workflow is not feasible to complete and verify coherently in this
checkpoint. No endpoint, UI, database mutation or migration is added. This is a
code/test increment, not an assertion that #32 is complete.

## Full workflow proposal (requires parent review)
Team Settings gets download YAML and a YAML import dialog. A textarea/file picker
has an accessible label, bounded size hint and path errors. Dry run freezes the
exact input and shows add/change/no-op/conflict/blocker rows. Editing invalidates
the displayed plan; apply stays disabled until another dry run. On stale 412,
retain the user's YAML and offer revalidation, not automatic retry. Use existing
readonly/dialog patterns, installed bitop-ui, CSS Modules/tokens; test 390 px,
keyboard, focus, axe, loading/error/empty and disabled states.

Before any HTTP implementation, extend OpenAPI with GET configuration,
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
meaningful settings. Schema field tables and per-kind validators remain to be
implemented before v1 can be exposed; draft syntax does not define these tables.

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
or credential canaries). Syntax output remains untrusted, nonsecret-unsafe input:
per-resource unknown-field/type/reference validation is explicitly NOT complete.
No database/network/model/job/audit dependencies or dependency injection hooks.

## Verification
Red compile regression before implementation, then Go 1.26.10 GOMAXPROCS=4
GOFLAGS=-p=2 race/coverage tests, fuzz seed corpus and bounded fuzz, vet and size
checks. Save full outputs and actual failures outside repo. No code edits during
compilation/tests. Test single docs, aliases/anchors, nesting/bytes/items/nodes,
strict envelope/version/name duplicate rejection, tags/types, deterministic JSON,
resource kind separation, no value echo (raw/urlencoded/base64 canaries), reader
errors, and fresh output ownership. Full PG fake-gateway mechanics, authz matrix,
API/generated checks and UI acceptance remain required before feature integration.
