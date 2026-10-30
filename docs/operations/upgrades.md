# Upgrades and the upgrade test

Grounded upgrades without downtime: new pods run `grounded migrate` (in the Kubernetes base, an init container) while the previous version keeps serving, and for the length of a rollout old and new code share one database ([ADR-0013](../adr/0013-availability-and-zero-downtime-migrations.md)). That works only if every migration is **expand/contract**. This page gives the rules for contributors and describes the harness that checks them.

## Rules for migrations (contributors)

A release's schema must work with the previous release's code and with its own.

**Allowed in one release (expand):**
- New tables, views and functions.
- New columns that are nullable or have a default. The old code doesn't write them, so the new code must cope with rows where they are `NULL` or the default.
- New indexes: `CREATE INDEX CONCURRENTLY` for large tables. (A migration file that does this needs `-- +goose NO TRANSACTION`.)
- New enum values or `CHECK` values the old code never writes.
- Backfills that the new code doesn't depend on for correctness until they finish, in bounded batches (or as a River job, not in the migration).
- **No `UPDATE` of existing rows in the same migration that adds a column.** `ALTER TABLE` holds `ACCESS EXCLUSIVE` until the migration's transaction ends, so an unbounded `UPDATE` (a scan of the table and of whatever it looks up) keeps every reader and writer of the table waiting. Add the column with a constant default (metadata only) and have the code resolve the old rows when it reads them, from an **indexed** lookup, or fill them later in bounded batches outside the migration. (Migration 00055 did this: `team_requests.approved_classification`, below.)

**Needs two releases (contract later):**
- Dropping or renaming a table or column: release N stops reading and writing it (the new code ignores it); release N+1 drops it. A rename is "add the new column, write both, backfill, read the new one" in N, and "drop the old one" in N+1.
- Tightening a constraint (`NOT NULL`, a narrower `CHECK`, a new unique index on existing data): release N writes valid data and backfills; release N+1 adds the constraint (`NOT VALID`, then `VALIDATE CONSTRAINT`). The previous release's pods run during a rollout and after a rollback, and they know only the constraints they shipped with: a violation of a new one is an error they don't recognise (a 500). In release N the **application** may enforce the stricter rule (inside its transaction, under a transaction-level advisory lock taken before the check), so current code never writes what the later constraint will refuse; the database refuses nothing new yet. See [Staged constraints](#staged-constraints) for the one open example.
- Changing a column's type: a new column, as for a rename.
- Removing an enum or status value: stop writing it in N, migrate rows, then drop it in N+1.

**Also compatible across versions:**
- **API:** during a rollout a browser may talk to the old and new API alternately. Don't remove fields or routes in the same release that stops the UI using them.
- **Jobs:** River job arguments are read by whichever worker picks them up. Add fields with defaults; never rename or repurpose one. A new job kind is fine: old workers leave it queued until they're replaced.
- **Valkey keys and cookies:** new names for new formats; old ones expire.

Migrations are forward-only (no `Down` blocks run in production) and create structure, not deployment data (CONTRIBUTING.md). Say in the pull request which kind each migration is, and for a contract step, which earlier release stopped using what it removes.

## Staged constraints

Open staged changes, recorded here so that the later releases are not forgotten. Each step names the release that may ship it; none of them is in the release before it.

**Agent template names are unique ignoring case, for every script (#140, #195).** The previous index, `agent_templates_name_key` on the database's own `lower(name)`, folds ASCII only in a cluster created with `--locale=C`, so "qa über" and "QA ÜBER" were two templates. Migration 00054 first added a unique index on `lower(name COLLATE "und-x-icu")` together with the code that needs it; v0.6.2 pods, which recognise only the old index name, would have answered a violation of the new one with a 500 during a rollout or an image rollback. It is staged instead:

| Release | What ships |
|---|---|
| **v0.6.3** | Migration 00054 renames existing duplicates ("Name (2)", "Name (3)" …, the oldest keeps its name) and adds a plain, **non-unique** lookup index `agent_templates_name_fold_idx`. The service saves and renames templates inside one transaction that takes a transaction-level advisory lock **before** it asks whether the folded name is taken (`agents.claimTemplateName`; a rename excludes the template itself, a description edit needs no name check). Taken is `409 template_name_taken`. The code already recognises both unique index names (`isTemplateNameTaken`). |
| **A later release** (when no pod older than v0.6.3 can run; the next minor at the earliest) | A migration renames any Unicode-only twin an old pod saved in the meantime (the same renaming as 00054), then `CREATE UNIQUE INDEX CONCURRENTLY agent_templates_name_fold_key ON agent_templates (lower(name COLLATE "und-x-icu"))` and drops `agent_templates_name_fold_idx`. Written in v0.6.3 code, so nothing is refused that the code did not already refuse. |
| **The release after that** | Drops `agent_templates_name_key` (the contract step: nothing older than the previous one runs, and the folded index makes it redundant). `isTemplateNameTaken` then loses the old name. |

*During a v0.6.3 rollout and after a rollback to v0.6.2:* a v0.6.2 pod can save or rename a template to a Unicode-only twin of another (in a cluster created with `--locale=C`; in other locales its own index folds the name and refuses it), because the database does not refuse it yet. That is a temporary legacy behaviour and is accepted deliberately: the alternative is a 500. Only v0.6.3 and later code enforces the rule. The twin stays editable (a description change needs no name check) and can be renamed to a free name; the later release renames leftovers. The upgrade test (below) saves such a twin with the old image after the new schema is in place.

**ICU is required (migration 00054).** The folded name uses PostgreSQL's ICU root collation `und-x-icu`, which does not depend on the cluster's locale, so the Postgres must be built with ICU (the official `postgres` and `pgvector/pgvector` images, CloudNativePG and the usual managed services are). The migration checks it first and stops, before changing anything, with a message that says what is missing: `migration 00054 needs the ICU collation "und-x-icu"` (not built with ICU, or the collations were not imported into the database) or `cannot use the ICU collation ...` (it exists but does not fold case: check the server's libicu). To check by hand: `SELECT lower('ÜÉ' COLLATE "und-x-icu");` must return `üé`.

**After an ICU, libicu or operating-system update of the database server,** PostgreSQL may warn `collation "und-x-icu" has a version mismatch`. An index on an ICU-collated expression is ordered by that library: rebuild it, then record the new version:

```sql
REINDEX INDEX CONCURRENTLY agent_templates_name_fold_idx;
ALTER COLLATION "und-x-icu" REFRESH VERSION;
```

The templates table holds the few templates platform admins saved, so this takes moments; until it is rebuilt a lookup could miss a name (the same applies to the unique index of the later release, and then it also needs doing before a rollout). Take a backup before a major Postgres or image upgrade as usual; restoring a dump into a server with a different ICU version needs the same two statements.

**Team requests keep the level the reviewer approved (#140, #195).** Migration 00055 only adds `team_requests.approved_classification text NOT NULL DEFAULT ''`: metadata only, no row is touched, and nothing is backfilled now or later (a backfill migration would only hold the same `ACCESS EXCLUSIVE` lock differently, over an unbounded update). `''` means "not recorded": a request approved before v0.6.3 or by a v0.6.2 pod running next to it. The API resolves it when it reads the request: what the approval recorded in the audit log (`team_request.approve`, `afterState.classification`, looked up with `target_type = 'team_request'` and the request ID, newest first, on `audit_log_target_idx`), else the team's level now, else the level asked for. Only approved requests with an empty column look anything up. v0.6.3 code writes the approved level itself. There is no later step: the lookup can be removed when nothing could have an empty value, which needs a backfill that is not worth a release.

## The upgrade test

`make upgrade-test` runs [`deploy/kubernetes/scripts/upgrade-test.sh`](../../deploy/kubernetes/scripts/upgrade-test.sh) with Docker. It uses its own network, containers and volume (`grounded-upgrade-<id>-*`) and the host ports 18181 and 18182 on 127.0.0.1, and removes them all when it's done (`KEEP=1` leaves them running).

1. **Infrastructure:** Postgres (`pgvector/pgvector:pg17`) and Valkey, empty.
2. **The old version:** `migrate`; `serve` (API and worker); `grounded demo --serve-fake-models`, which seeds the Demo team and serves the built-in fake model gateway ([demo.md](../demo.md)). The harness then signs in with development sign-in and adds, through the API: an upload source with a known document in the Demo knowledge base (ingested by the old worker), a chat (a stored conversation), and a query API key. The demo's go.dev crawl is cancelled; nothing needs the internet.
3. **Reads on the old version:** readiness, the fixture source, the conversation, retrieval finding the document, and the API key.
3a. **Writes on the old version** (#195; the Postgres is created with `--locale=C`, where the old template index cannot tell a Unicode-only twin): two template names that differ only in a non-ASCII letter's case, and a team request asked by one person and approved by the admin with a *different* classification than the one asked for.
4. **The new version's `migrate`,** with the old process still running.
4a. **Writes on the old version, on the migrated schema:** a template saved as a Unicode-only twin of another, a template renamed onto a twin name, a second request approved with a changed classification. None may be a 5xx.
5. **The old version on the migrated schema:** the same reads. This is the expand/contract check: a migration that drops or renames something the old code uses fails here.
6. **The new version** (`api`): readiness, the same reads (data written by the old version, a key hashed by it), and a chat with the fake model. And the writes' consequences: the later duplicate of 3a was renamed, a new twin is refused (`409 template_name_taken`), a rename onto a twin is refused and changes nothing, and both approved requests show the classification that was approved, not the one asked for.
7. **The old version again,** now next to the new one (a twin saved by it next to a template of the new version is accepted, as described under Staged constraints; the new version refuses the next one).

Settings:

| Variable | Default |
|---|---|
| `NEW_IMAGE` | Built from the checkout (`docker build`). |
| `OLD_IMAGE` | `ghcr.io/ncecere/grounded` at `OLD_REF` (`vX.Y.Z` or `sha-<commit>`) if it can be pulled, otherwise built from `OLD_REF` in a temporary git worktree. |
| `OLD_REF` | The last `v*` tag before `HEAD`, or `HEAD^` while there is none. |
| `OLD_PORT`, `NEW_PORT` | 18181, 18182. |
| `RUN_ID` | The script's process ID, used in the names. |
| `PG_INITDB_ARGS` | `--locale=C --encoding=UTF8`: the cluster the template-name steps need. |

Examples:

```sh
make upgrade-test                               # previous commit (or last release) → this checkout
OLD_REF=v0.1.0 make upgrade-test                # a given release → this checkout
OLD_IMAGE=ghcr.io/ncecere/grounded:v0.1.0 NEW_IMAGE=grounded:dev make upgrade-test
```

**In CI** (`.github/workflows/ci.yml`, job `upgrade`), it runs on every push to `main` after the image is published, against that image. Until v0.1.0 exists the old version is the previous main commit's image; from v0.2.0 on it is the last release, so each release is checked against the one before it. A failure there means the migration (or the code) isn't expand/contract: split it as above.

The harness uses development sign-in and the example keys from `.env.example`, which Grounded accepts only because `APP_URL` is a loopback address. It is a test, not a way to run Grounded.

The write steps run only for features the old version has (templates and team requests exist from v0.6.0); an older `OLD_REF` skips them and says so.

**What it doesn't cover:** a Kubernetes rollout itself (`make k8s-smoke` checks the manifests), long-running backfills on large data, and downgrades, which aren't supported: go back by restoring a backup taken before the upgrade.

## Upgrading an install

1. Read the release notes for anything to do before or after (a contract step can require the previous release to have run first: don't skip releases that say so).
2. Take a backup, or check that last night's ran (`components/backup-pgdump` or CNPG).
3. Change the image digest in your overlay. The API pods' init container migrates under an advisory lock (concurrent runs wait), then new pods start while old ones keep serving. The worker Deployment rolls at the same time; old and new workers share the queue, which is why job arguments must stay compatible.
4. Check `/readyz`, **Admin → Overview**, and `grounded doctor`.
