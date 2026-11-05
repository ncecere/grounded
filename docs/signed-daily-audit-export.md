# Signed daily audit export — detailed design

Written before implementation; built and reviewed on 2026-11-04 (#36, first part). ADR-0034 is Proposed until the
release that ships it. The review produced a real export from a fresh install and verified it with OpenSSL and an
independently generated key exactly as "Offline standard signature procedure" below describes (signature, payload hash,
line chain, ordinals, coverage; a one-byte change to the manifest or payload is detected), and confirmed that metadata
and non-UUID targets are not exported. SIEM streaming is in [specs/audit-streaming/DESIGN.md](specs/audit-streaming/DESIGN.md) (v0.9.0); external copies are described under "External copy" (v0.9.0).

## Working built-in path (Proposed; not owner acceptance)

Admin → Logs → Audit contains signed export settings, requests, status, safe payload
download and signed verification metadata. Admins explicitly approve configuration;
auditors see semantic read-only facts, not disabled editors. No mount or GET enqueues
work, probes destinations or calls models. Feature approval defaults OFF. External
destinations and streaming are unsupported; whole issue #39 remains open.

Operator-only `AUDIT_EXPORT_SIGNING_KEY_FILE` (or the same lower-case YAML **path
reference**) names a regular, non-symlink mode-0600 file containing exactly 64 raw
Ed25519 private-key bytes. The loader never accepts signing bytes in settings,
generates keys, returns file contents or includes file/error values in responses.
Missing, malformed or permissive files mean unavailable, never unsigned output.
Secret-store mounts must provide a regular private file, not a projected symlink.
Disabling approval does not cancel a publication already in progress. Restart API and workers to rotate the configured key; key ID is SHA-256 of its raw
public key. Each completed envelope records its actual signing key. Operators must
independently retain old public keys. No real key is provided by this repository.

Seven OpenAPI operations under `/v1/admin/audit-export-settings` and
`/v1/admin/audit-exports` require platform browser sessions. Scoped/team/delegated
credentials never grant global audit. Writes require If-Match: config/create use
settings revision, retry uses request revision. Approval/actions and River InsertTx
are transactional. A dedicated queue, at most one outstanding day and one next-day
request per minute bound catch-up without ingestion starvation. Dates are adjacent
closed UTC days, starting at the explicitly approved coverage start. A failed day
blocks progression until explicit admin retry. Pending/completed/failed requests
are durable; claims use expiring ownership tokens, completion CAS, bounded River
attempts, and expired/aborted queued jobs become failed. GET never rescues work.

## Coverage and late commits

The first requested day is the declared coverage start. Every freeze selects
visible facts with timestamps **[coverage start, day end)** that have never been
frozen before, not merely facts timestamped on that day. An indexed global unique
source ID plus anti-join prevents repeated publication. A transaction committing
after an earlier snapshot is carried forward in the next freeze, even if its ID
is lower than earlier exported IDs or it commits during multi-page freeze. IDs
increase within an artifact only, NOT necessarily between artifacts. No existing
ordinary audit writes or global commit-order serialization are changed.

The immutable snapshot is repeatable-read, with 256-row pages and a signed
`coverageStart` field. Watermark is only the maximum visible source ID, never proof
that lower IDs committed. A manifest's day is its coverage *closing* day, not a
claim that every contained timestamp belongs to that day. Late facts retain their
original timestamps and are signed by the key active on publication, not a
historical key. Verifiers check timestamps against coverage start/day-end and check
coverage-start equality across links. Retrying an old day never mutates its facts.
Empty days are explicit zero-byte artifacts, unless they carry late facts.

After approval (or any request), retention conservatively protects covered facts
not yet frozen, including while exports are paused. Frozen projections survive
source retention. This does not restore facts purged **before** approval, facts
before coverage start, or facts lost outside normal retention. In-flight retention
at approval and operator/database actions are not a completeness guarantee.
Disabling approval is a pause, not permission to discard unexported covered facts.
Operators must monitor failures/storage and approve a coverage start honestly.

Freeze is bounded to 100,000 records, a 30-second context, 25-second SQL statement
and 5-second lock limits. A bounded candidate preflight rejects oversized snapshots
before copying; no truncation is committed. Publication is limited to 100,000
records/64 MiB and two concurrent spools per process (including downloads).
Tempfiles are private and unlinked immediately. Jobs/publication are bounded to
two minutes; downloads validate the complete bounded artifact before response
headers and have a 30-second write deadline. A limit/cancellation fails closed,
never publishes an unsigned or truncated artifact.

## Deliberate safe projection

Inventory: `audit.Entry` serializes Before/After through arbitrary JSON;
`authz.Actor.Audit` adds API-key/OAuth metadata; `httpapi.toAPIAudit` exposes raw
states/metadata plus resolved email, display name and target labels.
None of these serializers is reused. The export reads only numeric ID, timestamp,
actor kind and UUID, team UUID, action, target type, and target ID. Metadata is
not selected at all. Action/type accept bounded lowercase protocol identifiers;
unknown unsafe identifiers become the fixed `redacted` marker. Target ID is kept
only when a UUID; arbitrary targets (URLs, patterns, settings keys, names) become
empty. Before/after, metadata (including encoded strings), request ID, client IP,
labels, emails, document/conversation text and instructions are omitted entirely.
This authenticates projected facts, **not** a checksum of the source database row.
No source-content tables or model/provider calls are made. Failures use constant
messages, never raw values. Actor kind distinguishes user/API-key/system; OAuth
attribution and safe nonsecret metadata need a separately reviewed allowlist.

## Canonical bytes and signature

Format `grounded.audit.v1`: Go encoding/json on fixed structs in declaration order,
compact UTF-8, default HTML escaping, no optional keys, RFC3339Nano UTC timestamp,
base-10 signed 64-bit source IDs/ordinals, UUID lowercase strings (or empty).
Each line has ordinal, fact and previous line hash; append one LF. SHA-256 covers
that complete line including LF. First previous hash is empty. Payload SHA-256
covers all emitted bytes. A fixed struct manifest binds coverage start, version, UTC day,
snapshot time, watermark, count, first/last IDs, final chain hash, payload digest,
previous signed-envelope digest, algorithm, and key ID. Key ID is the lowercase
SHA-256 fingerprint of the raw 32-byte Ed25519 public key. Ed25519 signs
`grounded.audit.manifest.v1\n` followed by exact compact manifest JSON. Envelope
holds manifest, base64 raw public key and base64 signature. Its exact compact JSON
is hashed for next-day linkage. Key rotation changes key ID; next manifest still
links the previous envelope hash. Missing/malformed private keys fail closed.
Only caller-supplied disposable fixtures are generated in tests.

Verification requires a separately trusted key-ID/public-key mapping, not trust
in the key bundled with the envelope. Reject noncanonical lines, unexpected
fields, reordered/missing/duplicate ordinals, nonincreasing source IDs, day/range
mismatches, line-chain/hash/count mismatches, wrong key and modified manifests.
The verifier is bounded to 16 KiB per JSONL line. Check previous envelope hash
and next UTC date for a sequence. Missing first/latest artifacts require an
external checkpoint; a signature alone cannot reveal an unknown suffix deletion.

## Publication and retry atomicity

Store.Put overwrites. Each attempt uses a random UUID object prefix, journaled
before upload with a five-minute expiry. Only pending-to-completed database CAS
publishes an envelope/object key, and it rejects expired upload attempts. No lock
spans network I/O. Duplicate attempts return the committed winner. Failed/lost-ack
uploads may be orphaned; periodic cleanup deletes at most ten expired, unreferenced
attempts per minute, retaining a durable deleting marker on deletion failure. Publication locks the journal row and removes it in its commit transaction; cleanup first fences publication with the deleting marker in a short DB statement. Neither lock spans blob I/O. Crash recovery
depends on workers running again; cleanup is not a distributed transaction or
exactly-once guarantee. A backend violating cancellation can still leave an object
after cleanup; operators remain responsible for storage inventory/reconciliation.
Committed payloads are never candidates for orphan deletion.

Download takes only a request UUID, resolves its committed artifact, validates its
bounded signed structure and returns an attachment with no-store/nosniff. Neither
object keys nor public/presigned URLs are exposed. Verification metadata includes
the envelope/public key, not private signing material. Bundled public-key
consistency is not independent trust. Separate external first/latest checkpoints
are still essential: signatures cannot detect an unknown deleted final suffix or
prove all source facts existed or were retained.

## External copy

The signatures can't show that a final day was deleted, so the first and latest checkpoints must also be kept somewhere
Grounded's admins don't control. An operator can name such a bucket in the environment (`AUDIT_EXPORT_COPY_S3_BUCKET` and
the other `AUDIT_EXPORT_COPY_S3_*` settings; never in the UI, never with Grounded's own storage bucket and prefix, which the
configuration refuses). Every five minutes a job copies each completed day, oldest first and at most five at a time:

- `<prefix>audit-exports/<YYYY-MM-DD>/payload.jsonl` and `.../envelope.json`, the exact bytes Grounded holds. Keys are
  deterministic, so a retry writes the same objects; with S3 Object Lock (compliance mode) an earlier copy can't be replaced.
- Before copying, the payload's SHA-256 is checked against the signed manifest: a local payload that no longer matches is
  never copied (class `hash`). After copying, both objects are read back and compared (class `verify` if they differ).
- A failure (`read`, `hash`, `write`, `verify`) is recorded per day and retried with backoff from 1 minute to 6 hours. Admin
  → Logs → Signed exports shows the bucket and each day's state; nothing about the bucket's credentials is shown.
- Days completed before the bucket was configured are copied too, oldest first.

Give the job credentials that can write and read, but not delete or change retention, and keep the bucket's own access
logs. The copy is a delivery, not a new trust root: verify copies with the offline procedure below, pinning the public key
independently.

## Offline standard signature procedure

Keep an independently witnessed previous envelope hash and key fingerprints.
Retrieve payload and canonical envelope through the authorized download
API. Independently pin the raw public-key SHA-256; never
accept the envelope's bundled key as approval. For standard OpenSSL verification:

1. Parse the envelope JSON. Serialize its `manifest` object in the exact field
   order: coverageStart, version, day, snapshot, watermark, count, firstId, lastId, finalHash, payloadHash, previousExport, algorithm, keyId; compact with no spaces, no trailing LF. Prefix the UTF-8 bytes
   with `grounded.audit.manifest.v1` and one LF; save as `signed.bin`.
2. Base64-decode `signature` to `signature.bin`. Convert the **trusted** raw
   32-byte public key to Ed25519 SubjectPublicKeyInfo DER by prefixing hex
   `302a300506032b6570032100`; save as `trusted-public.der`.
3. Run `openssl pkeyutl -verify -pubin -keyform DER -inkey trusted-public.der
   -rawin -in signed.bin -sigfile signature.bin` (one shell command).
4. Compare `sha256sum payload.jsonl` to `payloadHash`; then validate every
   canonical line/ordinal/source ID/coverage interval and previous-line hash as specified above.
   `internal/auditexport.Verify` implements this bounded streaming validation.
5. Reconstruct the canonical envelope in field order manifest, publicKey, signature, using the canonical manifest order above, compact with no trailing LF. API object member order is not a trust signal. Validate its SHA-256 against the next previousExport and check date adjacency;
   `VerifyLink` checks these. Independently reconcile the first/latest checkpoint.

OpenSSL signature success alone does not validate payload structure, coverage,
source completeness, chain continuity or freshness. No compliance certification
is asserted.
