# Plan: index preview

Implements [`SPEC.md`](SPEC.md) (draft; decisions D1 to D7 are recommendations). Tracks [#18](https://github.com/ncecere/grounded/issues/18).

## What the code does today (read, not assumed)

A migration is one row of `profile_migrations` (migration `00029`) with a status of `running`, `switched`, `completed`, `cancelled` or `switched_back`; a unique index allows one `running` or `switched` migration per KB. When the last source is ready, `internal/profilemig/switch.go` locks the migration and the KB, checks `complete(...)`, then in one transaction: `flip` (points the KB and its sources at the new profile), `SwitchProfileMigration`, an audit entry (`kb.profile_switch`), a notification, `switched()` (which fires the evaluation trigger `profile_switched`), and a cleanup kick if the grace period is 0. Retrieval takes its embedding target and vector table from `kb.EmbeddingProfileID` (`kbs/search.go`); an evaluation run retrieves through `kbs.RetrieveForEvaluation(kb, ...)`.

So the hold is a small change in one place: stop before `flip` when the migration is a preview, and expose the rest as a step an admin takes.

## Slices (each is built, tested and works on its own)

| # | Slice | Done when | Size |
|---|---|---|---|
| T1 | **Hold mode** (backend only). Migration `00046`: `profile_migrations.hold boolean NOT NULL DEFAULT false`, status `ready` (added to the CHECK and to the one-active-per-KB index). The start request takes `hold`. When every source is complete and `hold` is set, the migration becomes `ready`, audited (`kb.profile_preview_ready`) and notified, and the KB keeps its profile. `POST /v1/admin/profile-migrations/{id}/switch` (admin, `If-Match`) runs the existing flip, audit, notification, `switched()` and cleanup. Cancel works from `ready`. | A held migration reaches `ready` while queries still use the old profile; the manual switch flips it exactly as the automatic one does; a migration without `hold` behaves as before (the existing tests pass unchanged). | M |
| T2 | **Candidate profile.** `embedding_profiles.candidate_of` (nullable, the KB's profile it was copied from): hidden from the pickers and the usable-profiles API, created by `POST /v1/admin/profile-migrations/preview` (`kbId` and the changed settings), which also starts the held migration. Discard (cancel, then the cleanup job) deletes the candidate's passages and vectors, drops its `emb_<id>` table and retires the profile, which stays hidden (**D8**: a profile with migration history cannot be deleted, and the record is audit trail); a switch clears `candidate_of`. **First step, done (2026-10-14): only `key` is unique (it must match a pattern; `name` is free), the model, dimensions, prefixes and chunk settings are plain columns, so a copy is possible with a new key and `is_default` false. The `emb_<id>` table is created lazily at ingest and nothing ever dropped one, so T2 adds that.** | A preview creates a hidden copy and a held migration in one call (and leaves no copy behind if the start is refused); the copy is absent from the admin list, the pickers, ⌘K and the default count, and a source or knowledge base cannot select it; discard leaves no passage, vector or table behind and the live index untouched; a switch makes the copy an ordinary profile. | M |
| T3 | **Evaluate the candidate.** When a held migration becomes `ready`, the system starts retrieval runs of the KB's evaluation sets: a baseline on the live profile (unless a run exists from the last hour) and one on the candidate, which retrieves through a KB value with `EmbeddingProfileID` replaced. The run's configuration snapshot records `preview: {migrationId, profileId}`; such runs are left out of the set's trend line. | Both runs complete and record the same questions; the candidate run's hits come from the candidate's chunks (an integration test with different chunk sizes shows different passages); the trend line is unchanged. | L |
| T4 | **The comparison.** `GET /v1/admin/profile-migrations/{id}/preview` (numbers only, **D9**) and `GET /v1/teams/{team}/kbs/{kbId}/index-preview` (the team's editors, with the questions): per set, recall@k, MRR and first places for both, and how many questions improved, got worse or stayed, reusing the compare-two-runs logic and showing the latest pair that finished. A KB without sets says so. | Correct on a fixture with a known improvement and a known regression; an identical candidate shows no change. | S |
| T5 | **Admin UI.** **Preview new settings…** (on the KB's page and in Embedding profiles › Migrations); the migration's page shows building, then the comparison with **Switch** and **Discard**; team editors see a read-only note on their KB. Accessibility checked (axe) and the walk covers the new page. | A preview can be started, read and switched or discarded without the API. | L |
| T6 | **Documentation and acceptance.** Runbook section in `operations/profile-migration.md`, `evaluations.md`, the CHANGELOG; an acceptance run on a cluster `--demo` environment: import the docs-site evaluation set ([`evalset/grounded-docs.csv`](evalset/README.md)) into a knowledge base that crawls the docs site, preview a changed chunk size, read the comparison, switch, switch back, discard a second one. | The acceptance passes and leaves nothing behind. | M |

**Checkpoints (stop and review with the owner):** after T1 (the backend core, reviewable on its own); after T3 (a preview works end to end through the API); after T5 (before documentation and release).

## Order and dependencies

T1, then T2 (a preview needs a candidate), then T3, T4, T5, T6. T4's logic can be written alongside T3. Nothing is released until T5 is done, since a half-built preview has no user-facing surface; T1 to T4 are API only and invisible to everyone but admins.

## Risks

- **Shared sources.** A source can belong to several KBs; migrations already keep both sets of vectors until every KB has switched (ADR-0007). A preview of one KB must not change what another KB sees: check in T1 and T2 with a shared-source fixture.
- **The `profile_switched` trigger.** A manual switch must still fire it (the KB's sets run automatically after a switch, opt-in per set); T1 reuses `switched()` for that reason.
- **Storage.** A candidate doubles a KB's vectors until switched or discarded; preflight will report an estimate (D6, new: today it reports passages, tokens, requests and time). A forgotten `ready` preview keeps that storage: T5 shows how long a preview has been waiting, and a follow-up (not v1) could expire it.
- **No evaluation sets in production today** (#25), so the first real use needs questions: [`evalset/grounded-docs.csv`](evalset/README.md) has 96 about the docs site, and the cluster acceptance imports it.

## Not in this plan

Previews that change how a document is **parsed** (a new parser or table extractor; spec D7), full-answer evaluation of a candidate, a storage cap, and previews of anything other than a KB's index.
