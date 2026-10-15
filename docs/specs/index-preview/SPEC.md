# Spec: index preview: try new ingest settings on a knowledge base and compare before switching

Status: **DRAFT** (2026-10-14). The decisions D1 to D7 are recommendations, applied unless overruled. Tracks [#18](https://github.com/ncecere/grounded/issues/18); the first item of v0.5.0 ("Better knowledge in", [`../../roadmap.md`](../../roadmap.md) § L).

## Objective

Every v0.5.0 item changes **what is indexed** from the same documents: structure-aware chunking (A9, C15), parent/child retrieval (A5), contextual chunks (A4), tables kept structured (A10), boilerplate matching (A11). Today the only way to find out whether such a change helps is to apply it to the live knowledge base and look. A wrong guess means answers get worse for everyone until someone notices.

Index preview lets a platform admin **build the new index beside the live one, run the knowledge base's evaluation sets against both, see which questions got better and which got worse, and then switch or discard.** The live index keeps answering throughout.

It is not a new copy mechanism. It is the existing **profile migration** (P2, [`../../phase5-deploy.md`](../../phase5-deploy.md) § P2, runbook [`../../operations/profile-migration.md`](../../operations/profile-migration.md)) with a hold before the switch and an evaluation of the candidate.

## What exists, and what is new

| | Exists today | New |
|---|---|---|
| Build a second index | A migration re-embeds each source into a target profile's table, keeps the old vectors, reuses stored parsed text (no re-fetch, no re-parse), is throttled, resumable and cancellable | Nothing |
| Settings that differ | An embedding profile carries the passage settings and the model; chunks belong to a profile (`chunks.profile_id`); when settings differ the passages are cut again from stored parsed text | A way to make a **candidate profile** that is a copy of the KB's current one with the new settings |
| Switch | Automatic: the KB flips to the new profile in one transaction when the last source completes; the old vectors are kept for a grace period and the KB can switch back | **Hold before the switch** (the migration reaches `ready` and waits), and a manual switch |
| Evaluate | A run retrieves through the KB (`RetrieveForEvaluation`), which uses the KB's own profile; two runs can be compared (better, worse, same); runs record a configuration snapshot | An evaluation run that retrieves through the **candidate** profile, with the KB's sets, and a side-by-side of old and new |
| Decide | Switch back within the grace period; cancel | **Switch or discard** from the comparison, with the numbers beside the buttons |

## Decisions

- **D1: a candidate index is a held migration, not a new mechanism.** The migration gains a mode (`hold`): when every source is complete it moves to `ready` and waits for an admin, instead of switching. Cancelling or discarding it deletes the candidate vectors through the existing cleanup, then the candidate profile is **retired and stays hidden** and its vector table is dropped (**D8**, below). Reuses preflight, throttling, resumability, shared-source handling and the grace period, all already tested.
- **D2: "new ingest settings" are fields of the embedding profile.** The passage settings are on the profile today; the v0.5.0 strategies (a chunking strategy, parent/child, contextual chunks, table handling) will be added there as fields. A preview therefore starts from "a copy of this KB's profile, with these changes". The copy is marked as a candidate and hidden from the profile pickers, so previews do not clutter the list of profiles teams choose from. Changing the **model** is a preview too (the case P2 already covers) and needs no new field.
- **D3: platform admins start and decide, as migrations do.** The embedding load is platform-wide and sources can be shared across teams. Team editors see that a preview of their KB is running and its result, read-only.
- **D4: retrieval runs only, in v1.** The candidate is evaluated by running the KB's **retrieval** checks (recall@k, rank): deterministic, no model, no cost. Full-answer runs depend on prompts and a model and are out of scope for the preview; the owner can run them after switching. The run retrieves through the candidate by replacing the profile on the KB value passed to `RetrieveForEvaluation` (checked: `kbs/search.go` takes the embedding target and the vector table from `kb.EmbeddingProfileID`); there is no way to ask for a profile from chat or the API.
- **D5: the comparison reuses "compare two runs".** The old index is evaluated first (a baseline run unless a recent one exists, so the comparison is like for like and at the same moment), then the candidate. The result shows recall@k for both, the questions that improved, got worse or stayed, and the per-question rank. **Switch** and **Discard** sit beside it.
- **D6: the cost is shown, not capped.** A candidate index doubles a KB's vectors until it is switched (then until the grace period ends) or discarded. Preflight already estimates sources, passages, tokens, requests and time; it gains an estimate of the extra storage. No platform cap in v1.
- **D7: what a preview can and cannot try.** It covers changes applied **from stored parsed text** (re-chunking: strategy, size, overlap, parent/child, contextual chunks, boilerplate) and, where the existing migration already does it, from the stored original (a document without stored parsed text). A change to **how a document is parsed** (a new parser, a table extractor) needs the document parsed again and is a follow-up; the spec for that item says so.
- **D8 (owner, 2026-10-14): discard retires the candidate; it does not delete it.** A profile with migration history cannot be deleted (AD-15: deleting it would delete the history), and the migration record of a preview is part of the audit trail. So a discarded candidate is set to `retired` (still hidden by `candidate_of`), the cleanup job deletes its passages and vectors, and drops its `emb_<id>` table (nothing else ever drops one). Each discarded preview leaves one small hidden row. A switched candidate stops being a candidate: `candidate_of` is cleared and it becomes a normal profile.
- **D9 (judgement call, T3 and T4): evaluation sets are the team's, so the platform admin's comparison has numbers and no questions.** Sets are visible only to a team's editors, admins and owners (platform staff get 404), so the comparison a platform admin decides on shows, per set, recall@k, MRR, questions ranked first and how many questions got better, worse or stayed, and no question text. The team's editors read the questions and each one's result on both indexes at `GET /v1/teams/{team}/kbs/{kbId}/index-preview` (the same access as the sets). The comparison runs are a platform admin's, left out of the team's run list, trend and regression checks (trigger `index_preview`); the baseline is always a fresh live run made with the candidate's (not a recent old one), so both are scored at the same moment (D5, simplified: a retrieval run costs only query embeddings).

## Assumptions (correct me)

1. A KB with **no evaluation sets** gets a preview that builds and holds but cannot compare; the page says so and offers to open the evaluation sets. (Production has none today; see #25.)
2. The preview's evaluation runs are system-started and tagged as a preview in their configuration snapshot, so they appear in the set's run history but not in its trend line, which would otherwise jump.
3. One preview or migration per KB at a time, as migrations are today.

## Commands and API (sketch; the plan fixes the exact shapes)

- `POST /v1/admin/profile-migrations` gains `hold: true`; its state gains `ready` (all sources complete, not switched). `POST /v1/admin/profile-migrations/{id}/switch` makes the switch from `ready`.
- `POST /v1/admin/profile-migrations/preview` carries the KB and the changed settings; it creates the hidden copy and starts the held migration in one call.
- `GET /v1/admin/profile-migrations/{id}/preview` returns the comparison (both runs' scores and the per-question changes).
- Admin → Embedding profiles → Migrations gains **Preview new settings…** on a KB, and the migration's page gains the comparison and the Switch and Discard buttons.

## Success criteria

1. A preview of a KB with evaluation sets builds the candidate index while the live KB keeps answering, and never changes what a query returns until it is switched.
2. The comparison shows recall@k for the live and the candidate index from runs made at the same time, and lists improved, worse and unchanged questions; a candidate that is identical to the live index shows no changes.
3. Switch makes the candidate live in one transaction and keeps the old vectors for the grace period (switch-back works); Discard removes the candidate vectors, drops the candidate's vector table and retires the hidden profile (it stays hidden; the migration's record stays, as Cancelled), and leaves the live index untouched.
4. A KB with no evaluation sets builds and holds, and says why it cannot compare.
5. Chat, the API and teams cannot select a candidate profile; only the evaluation run can.
6. Every start, hold, switch and discard is audited (counts only) and notifies as migrations do.
7. A migration without `hold` behaves exactly as it does today.

## Boundaries

- **Always:** keep the live index untouched until the admin switches; reuse the migration's tested paths; audit counts only.
- **Ask first:** a platform storage cap; running full-answer evaluations in a preview; previews of parser changes (D7).
- **Never:** a profile choice reachable from chat, the API or a team; deleting live vectors; a switch without an admin deciding it (in `hold` mode).

## Testing strategy

Unit tests for the state machine (`hold` reaches `ready` and waits; a migration without it is unchanged) and for the comparison (improved, worse, same, identical candidate). Integration tests against Postgres: a held migration keeps queries on the live profile; evaluation through the candidate returns the candidate's passages; switch and discard behave as in criterion 3; the hidden profile never appears in the pickers' API. An end-to-end check on a cluster `--demo` environment: preview a changed chunk size on the Demo knowledge base and read the comparison.
