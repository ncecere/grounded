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
- **Cancel** stops a running migration. The knowledge base never changed, and the passages made so far are deleted by the cleanup job.
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

## The API

Everything the page does is in the API (`api/openapi.yaml`, tag `admin`):

| Call | What it does |
|---|---|
| `GET /v1/admin/knowledge-bases` | Every knowledge base with its team, profile, passages and active migration |
| `POST /v1/admin/profile-migrations/preflight` `{kbId, targetProfileId}` | The preflight; changes nothing |
| `POST /v1/admin/profile-migrations` `{kbId, targetProfileId, graceDays?}` | Start; `409 migration_blocked` with `details.blockers` |
| `GET /v1/admin/profile-migrations[?kbId=]`, `GET …/{id}` | List; one with per-source progress and failed documents |
| `POST …/{id}/cancel`, `…/retry`, `…/switch-back`, `…/finish` | With `If-Match: "<revision>"` (428 without, 412 when stale) |
| `GET /v1/teams/{team}/kbs/{kbId}/profile-migration` | The running or switched migration, for team members |

## Troubleshooting

| What you see | What to do |
|---|---|
| A source shows *The target profile's model or its connection is disabled; the migration waits.* | Enable the model and the connection. The job checks again every minute. |
| **Needs attention** with failed documents | Read the errors in the sheet. `model_error` often means the input is too long for the model: lower the profile's passage size (a new profile), or raise the model's input limit if it was set too low. Then **Retry failed documents**. A document can also be deleted or fixed at its source; its new version is embedded again. |
| Progress pauses now and then | The gateway is at its limit (429 or 503 with `Retry-After`) or the connection's request limit is reached. The job waits and continues; lower `requestsPerMinute` on the connection if other traffic suffers. |
| **Switch back** says documents don't have vectors for the previous profile yet | Documents changed after the switch and are still being embedded for the old profile. Try again in a minute. |
| Switch back is no longer offered | The grace period is over, or the old vectors were deleted early. Start a new migration back to the old profile instead. |
| Storage didn't shrink after the grace period | The cleanup job runs every 10 minutes and deletes in batches. A shared source keeps the old vectors while another knowledge base still uses the old profile. |

## Upgrading to this release

Migration `00029_profile_migration.sql` adds `chunks.profile_id` and fills it in from each chunk's source, which rewrites the chunks table once (seconds for a few hundred thousand passages; plan a quiet moment for millions). Code of the previous release keeps working against the new schema during a rolling upgrade: a trigger fills in `profile_id` for chunks it writes.
