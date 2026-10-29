# Moving a knowledge base to another embedding profile

An embedding profile fixes a knowledge base's model, dimensions, prefixes and passage sizes ([ADR-0007](../adr/0007-embedding-profiles.md)). None of these can change in place. To adopt a new embedding model, or other passage sizes, create a new profile and **migrate** each knowledge base to it. Search keeps working throughout, and nothing is fetched or parsed again.

Platform admins run migrations, under **Admin → Embedding profiles → Migrations** (a page of its own until v0.2.1; `/admin/profile-migrations` opens the tab). Auditors can see them. Team members see their knowledge base's migration on its page.

## How it works

- **Background re-embedding.** Starting a migration gives each source of the knowledge base a second set of passages and vectors for the target profile (an *embedding set*). The `embedding_set.sync` job fills it from each ready document's stored parsed text:
  - When the target's passage settings match the current profile's (size, overlap, chunker version and the model's input limit), the passages are **copied** and only embedded again.
  - Otherwise they're **cut again** from the parsed text with the target's settings, leaving out the repeated blocks the document already dropped (ADR-0021). A document processed before parsed text was stored is parsed again from its stored original. Nothing is fetched from the web or re-uploaded.
- **Throttled.** Requests go through the same batcher as ingestion (`EMBED_BATCH_SIZE`, `EMBED_BATCH_TOKENS`), at background priority and within the target connection's **requests per minute**. Live queries and chat take precedence. Eight documents per source are embedded at a time.
- **Resumable and idempotent.** A document is done once it has passages for the target profile. The job works in bounded steps: after 5 minutes, or when the model asks it to wait (429 or 503 with `Retry-After`), it snoozes and continues where it stopped. A restart, a deploy or a crash loses nothing. One job per source and profile runs at a time; a sweep every 30 seconds requeues any that are missing.
- **Failures are per document.** A document that can't be embedded is recorded with its error. Temporary errors are retried after about 30 seconds and 2 minutes; after the third attempt, or at once for permanent errors (for example the model rejecting the input), it waits for **Retry failed documents**. The knowledge base doesn't switch while any document has failed. Platform admins are notified once when that happens.
- **The switch is atomic.** When every source has passages for every ready document, one transaction points the knowledge base at the new profile. The next search, and every agent using the knowledge base, uses the new profile and its query prefix. Until then it searches the old profile only, so it never mixes the two.
- **New content during a migration.** Uploads, crawls and re-processing continue as usual for the current profile. Each change then queues the same document for the target profile (and for the old one after the switch, during the grace period), so the switch loses nothing and switching back loses nothing either.
- **Shared sources** (a source used by several knowledge bases, including platform-shared sources) keep vectors for every profile a knowledge base using them needs. A source's own profile moves to the new one once every knowledge base using it has moved. A shared source is embedded only once: when a second knowledge base migrates to the same profile, its preflight shows the source as already embedded.
- **Grace period.** After the switch the old vectors are kept, and kept current, for `PROFILE_MIGRATION_GRACE_DAYS` (default 7; each migration may set 0–90). Within it, **Switch back** returns the knowledge base to its previous profile at once. **Delete old vectors now** ends the grace period early. A cleanup job (every 10 minutes, and after each change) then deletes, in batches of 1,000 passages, every set nothing needs any more.
- **Cancel** stops a running migration (or discards an index preview, below). The knowledge base never changed, and the passages made so far are deleted by the cleanup job.
- **Maintenance mode is optional.** It doesn't pause migrations. Turning it on during a large migration keeps new ingestion from competing for the embedding model's requests; chat and search keep working.
- **Audit and notifications.** Starting, cancelling, retrying, switching, switching back, finishing and completing are audited on the knowledge base (`kb.profile_migration_start`, `_cancel`, `_retry`, `kb.profile_switch`, `kb.profile_switch_back`, `kb.profile_migration_finish`, `kb.profile_migration_complete`), with counts and IDs only. Platform admins are notified when a knowledge base switches or needs attention (`platform.profile_migration`), and the team's admins and owners when their knowledge base changes profile (`kb.profile_changed`).

## Before you start

1. **Add the model and create the target profile** (Admin → Models, then Embedding profiles). Test the model; for a Matryoshka model stored at fewer dimensions, set output dimensions on the profile.
2. **Set a request limit** on the target connection (`requestsPerMinute`), just below the gateway key's limit. Without one the preflight can't estimate the time, and the migration sends requests as fast as the gateway answers.
3. For a very large knowledge base, consider **maintenance mode** (Admin → Maintenance) while it runs. It's optional.
4. Check storage: until the old vectors are deleted, the knowledge base holds two sets of passages and vectors.

## Run a migration

1. **Admin → Embedding profiles → Migrations → Migrate a knowledge base**, or **Change embedding profile…** in the "…" menu of the knowledge base's page (platform admins who are members of the team).
2. Pick the knowledge base and the target profile. The **preflight** shows:
   - each source with its documents and passages, whether it's shared with other knowledge bases, and whether it already has vectors for the target;
   - documents, passages (about, when cut again), tokens, embedding requests and the time at the connection's request limit;
   - **blockers**, which keep Start disabled: the target is the current profile, the target is retired, its model or connection is disabled, the knowledge base holds data above the model's classification ceiling, the profile's dimensions exceed the model's or the index limit, or another migration of this knowledge base is running or in its grace period;
   - **warnings**: passages cut again, shared sources, documents still processing (they're embedded for both profiles when they finish), failed documents (not indexed, so nothing to move), no request limit, and maintenance mode for a large migration.
3. Choose how long to keep the old vectors, then **Start migration**. A knowledge base without sources, or whose sources already have the target's vectors, switches at once.
4. Follow the progress in the migration's sheet: a meter for all sources and one per source, and the documents that failed with their errors.
5. After the switch, check search on the knowledge base (**Try it**) and its agents. If the results are worse, **Switch back** within the grace period.
6. When you're satisfied, **Delete old vectors now**, or let the grace period end.

Repeat for every knowledge base on the old profile. Once nothing uses it (Admin → Embedding profiles shows **Used by**), retire or delete the old profile.

## Preview new settings before you switch (index preview)

A migration to another profile switches by itself when its new index is ready. An **index preview** builds the new index **beside** the current one and waits: it runs the knowledge base's evaluation sets on both, shows what got better and what got worse, and you **switch** or **discard**. Search and agents use the current index the whole time. It is for changes you want evidence for: another passage size or overlap, a different embedding model, other prefixes.

### How it works

- **A hidden copy.** The preview copies the knowledge base's profile with the settings you change, as a *candidate* profile. It is in no list, picker or search result, is never the default, and nothing can select it, edit it or delete it: it is only the target of this preview. Its key is generated (`preview-…`); its name is the profile's name and "(new settings)" unless you give one.
- **Built beside the live index.** This is the migration described above, held: the sources are re-embedded in the background for the candidate (copied when the passage settings match, cut again otherwise), and when every source is done the migration becomes **Ready to switch** instead of switching. It counts as the knowledge base's one active migration, so no other migration can start until you switch or discard it.
- **Compared at the same moment.** When it is ready, every evaluation set of the knowledge base that has questions is run twice, retrieval only: on the current index and on the new one, with the same reranking. The current index is always run again (never an older run), so both are scored together. Sets of agents are not run: the preview compares the knowledge base's own retrieval. The runs count against the team's query usage like any evaluation run, and they take a few minutes for hundreds of questions.
- **Numbers for you, questions for the team.** Evaluation sets belong to the team, and platform staff cannot read them. The comparison on the migration's page shows, per set and in all, **recall@k, MRR, questions ranked first, and how many questions got better, worse or stayed**, and no question text. The team's editors, admins and owners see each question that changed, with its rank on both indexes, on the knowledge base's own page.
- **Not the team's history.** The preview's runs are not in the set's run list, its trend, its regression checks or a question's history, and they neither block a team's own run nor wait for one.
- **Switch** makes the same switch the automatic one does: atomic, the old vectors kept for the grace period you chose (**Switch back** works), the team told, the knowledge base's automatic evaluation sets queued. The candidate becomes an ordinary profile, listed and selectable, and can be renamed.
- **Discard** deletes the new index's passages and vectors, drops its vector table and retires the hidden profile. The knowledge base never changed. The migration's record stays, as *Cancelled*, because a profile with migration history is never deleted: each discarded preview leaves one small hidden profile row.
- **Documents that change while it waits** are embedded for the new index too. **Switch** refuses while some lack vectors for it (*try again in a minute*); **Compare again** makes fresh numbers.
- **Storage and time.** Until you switch or discard, the knowledge base holds two sets of passages and vectors. Nothing expires a forgotten preview: **Migrations** lists it as *Ready to switch* with the date it started.
- **Audit.** Starting is audited as `kb.profile_migration_start` (with `hold`), becoming ready as `kb.profile_preview_ready`, asking again as `kb.profile_preview_evaluate`, then `kb.profile_switch` or `kb.profile_migration_cancel`, with counts only. Platform admins are told when a preview is ready.

### Run a preview

1. **Admin → Embedding profiles → Migrations → Preview new settings…**
2. Pick the knowledge base and fill in **only the settings that change** (passage size and overlap, embedding model, prefixes, **chunker**, name, how long to keep the old vectors if you switch). Empty fields keep the current profile's. A preview with nothing filled in builds an identical index, which is a way to check that a comparison shows no change.
3. **Build the new index.** The preview's page opens with the same progress as a migration.
4. When it says **Ready to switch**, read **Compared with the current index**. Ask the team's editors to look at the questions that got worse: they see them on the knowledge base's page.
5. **Switch to the new index**, or **Discard preview**. **Compare again** runs the sets once more (after documents changed, or if a run failed).

### The chunker (version 1 and 2)

A profile's **chunker** decides how a page is cut into passages. **Version 1**, the original and the default, starts a new passage at every heading of level 1 to 3. **Version 2** keeps that and adds two rules: it **merges short neighbouring sections** into one passage (when the passage being filled and the whole next section are each under a quarter of the passage size, they fit together, the next heading is under the same parent heading as the passage started in, and no page boundary lies between them; a level 1 heading always starts a new passage), and it **drops passages that are only headings, rules and images** (version 1 drops such a passage only when it contains an image), unless that is all a document has. With no overlap, version 2 leaves the same text in the same order as version 1, in fewer passages.

It is a setting of the profile, fixed once the profile exists (**Add profile → Chunker**, or `chunkerVersion` in the API); an index preview can change **only** the chunker, which builds the same sizes cut again, beside the live index. **Version 2 has not been measured on a real knowledge base with a real embedding model**: preview it on a knowledge base that has evaluation sets and decide by the numbers. An unknown version is refused (`400 invalid_chunker_version`).

### The tables chunker (version 3)

**Version 3** keeps what version 2 does and keeps **tables structured** ([#24](https://github.com/ncecere/grounded/issues/24), the design is in [`DESIGN.md`](../DESIGN.md), "Tables kept structured"). A table that fits one passage is kept whole (it starts the next passage if it does not fit the room left), with a one-line caption above it. A table longer than a passage is cut between rows, and every piece repeats the caption, the header row and the separator row, so a passage with rows always has their column names; no row is lost or repeated, and a row longer than a passage is cut into rows whose cells stay in their own columns. A table inside a list item is kept and cut the same way. Choose it under **Add profile → Chunker → Keep tables whole**, or `chunkerVersion: 3`.

To see what it does to a knowledge base with tables, **Preview new settings**, change **only the chunker** to *Keep tables whole*, and look at the passages and the comparison before switching; the preview, a migration to a profile with version 3 and new documents on such a profile all cut the same passages. PDF text is never a table (the built-in parser reads lines of text, not table structure), so a table in a PDF is cut as paragraphs by every version. **It has not been measured on a real knowledge base with a real embedding model**: decide by the numbers.

### Reading a comparison

- It measures **retrieval**: whether the page a question expects comes back, and where. It does not measure answer quality.
- Differences of one or two questions are noise. Look at the totals and at questions that moved a lot. With few questions, or questions that are all easy, it cannot tell two indexes apart.
- *Better* and *worse* count questions whose expected page ranked higher or lower, or that one index found and the other did not. The first place count is the most sensitive: recall at the top ranks saturates on a small knowledge base.
- A knowledge base without evaluation sets has nothing to compare (*Nothing to compare*). You can still switch or discard, on the passages and the cost alone; asking the team to add questions first is better.

## The API

Everything the page does is in the API (`api/openapi.yaml`, tag `admin`):

| Call | What it does |
|---|---|
| `GET /v1/admin/knowledge-bases` | Every knowledge base with its team, profile, passages and active migration |
| `POST /v1/admin/profile-migrations/preflight` `{kbId, targetProfileId}` | The preflight; changes nothing |
| `POST /v1/admin/profile-migrations` `{kbId, targetProfileId, graceDays?}` | Start; `409 migration_blocked` with `details.blockers` |
| `GET /v1/admin/profile-migrations[?kbId=]`, `GET …/{id}` | List; one with per-source progress and failed documents |
| `POST /v1/admin/profile-migrations/preview` `{kbId, changes, graceDays?}` | Start an index preview (a hidden candidate profile and a held migration); `409 migration_blocked` with `details.blockers`, and no candidate is left behind |
| `GET …/{id}/preview` | The comparison, numbers only (platform admins and auditors) |
| `POST …/{id}/evaluate` | Compare again (`202`); `409 preview_running`, `409 migration_not_ready` |
| `POST …/{id}/switch` | Switch a ready preview (the same steps as the automatic switch); `409 migration_catching_up` while documents lack vectors, `409 migration_not_ready` |
| `POST …/{id}/cancel`, `…/retry`, `…/switch-back`, `…/finish` | With `If-Match: "<revision>"` (428 without, 412 when stale); cancel also discards a preview |
| `GET /v1/teams/{team}/kbs/{kbId}/profile-migration` | The running or switched migration, for team members |
| `GET /v1/teams/{team}/kbs/{kbId}/index-preview` | The preview's comparison with the questions, for the team's editors, admins and owners (404 for everyone else) |

## Troubleshooting

| What you see | What to do |
|---|---|
| A source shows *The target profile's model or its connection is disabled; the migration waits.* | Enable the model and the connection. The job checks again every minute. |
| **Needs attention** with failed documents | Read the errors in the sheet. `model_error` often means the input is too long for the model: lower the profile's passage size (a new profile), or raise the model's input limit if it was set too low. Then **Retry failed documents**. A document can also be deleted or fixed at its source; its new version is embedded again. |
| Progress pauses now and then | The gateway is at its limit (429 or 503 with `Retry-After`) or the connection's request limit is reached. The job waits and continues; lower `requestsPerMinute` on the connection if other traffic suffers. |
| **Switch back** says documents don't have vectors for the previous profile yet | Documents changed after the switch and are still being embedded for the old profile. Try again in a minute. |
| Switch back is no longer offered | The grace period is over, or the old vectors were deleted early. Start a new migration back to the old profile instead. |
| A preview is refused with a blocker | The same preflight as a migration. A knowledge base has one active migration (running, ready to switch, or in its grace period): switch, discard or finish it first. |
| **Nothing to compare** | The knowledge base has no evaluation set with questions. Ask the team to add some (Evaluations), then **Compare again**. |
| **Switch** says documents don't have vectors for the new profile yet | They changed after the preview was built and are being embedded for it. Try again in a minute, then **Compare again** for fresh numbers. |
| **Comparing…** doesn't finish | The runs wait behind other evaluation runs, or the team's query limit or budget stopped them (the run says why). **Compare again** once it is resolved. |
| A discarded preview left a profile you can't see | By design: the hidden profile is retired and kept because the migration record refers to it. It is in no list. |
| Storage didn't shrink after the grace period | The cleanup job runs every 10 minutes and deletes in batches. A shared source keeps the old vectors while another knowledge base still uses the old profile. |

## Upgrading to this release

Migration `00029_profile_migration.sql` adds `chunks.profile_id` and fills it in from each chunk's source, which rewrites the chunks table once (seconds for a few hundred thousand passages; plan a quiet moment for millions). Code of the previous release keeps working against the new schema during a rolling upgrade: a trigger fills in `profile_id` for chunks it writes.

The index preview (v0.5.0) adds three small migrations, all additive: `00046` (`profile_migrations.hold` and the `ready` status), `00047` (`embedding_profiles.candidate_of`) and `00048` (an `index_preview` trigger for evaluation runs). The previous release keeps working against them during a rolling upgrade: it never creates a held migration or a candidate profile. **Before rolling back to a release without the index preview, switch or discard any preview:** that release does not know hidden profiles and would list one, and its migration page would show a `ready` migration it cannot act on.
