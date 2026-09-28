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

**Needs two releases (contract later):**
- Dropping or renaming a table or column: release N stops reading and writing it (the new code ignores it); release N+1 drops it. A rename is "add the new column, write both, backfill, read the new one" in N, and "drop the old one" in N+1.
- Tightening a constraint (`NOT NULL`, a narrower `CHECK`, a new unique index on existing data): release N writes valid data and backfills; release N+1 adds the constraint (`NOT VALID`, then `VALIDATE CONSTRAINT`).
- Changing a column's type: a new column, as for a rename.
- Removing an enum or status value: stop writing it in N, migrate rows, then drop it in N+1.

**Also compatible across versions:**
- **API:** during a rollout a browser may talk to the old and new API alternately. Don't remove fields or routes in the same release that stops the UI using them.
- **Jobs:** River job arguments are read by whichever worker picks them up. Add fields with defaults; never rename or repurpose one. A new job kind is fine: old workers leave it queued until they're replaced.
- **Valkey keys and cookies:** new names for new formats; old ones expire.

Migrations are forward-only (no `Down` blocks run in production) and create structure, not deployment data (CONTRIBUTING.md). Say in the pull request which kind each migration is, and for a contract step, which earlier release stopped using what it removes.

## The upgrade test

`make upgrade-test` runs [`deploy/kubernetes/scripts/upgrade-test.sh`](../../deploy/kubernetes/scripts/upgrade-test.sh) with Docker. It uses its own network, containers and volume (`grounded-upgrade-<id>-*`) and the host ports 18181 and 18182 on 127.0.0.1, and removes them all when it's done (`KEEP=1` leaves them running).

1. **Infrastructure:** Postgres (`pgvector/pgvector:pg17`) and Valkey, empty.
2. **The old version:** `migrate`; `serve` (API and worker); `grounded demo --serve-fake-models`, which seeds the Demo team and serves the built-in fake model gateway ([demo.md](../demo.md)). The harness then signs in with development sign-in and adds, through the API: an upload source with a known document in the Demo knowledge base (ingested by the old worker), a chat (a stored conversation), and a query API key. The demo's go.dev crawl is cancelled; nothing needs the internet.
3. **Reads on the old version:** readiness, the fixture source, the conversation, retrieval finding the document, and the API key.
4. **The new version's `migrate`,** with the old process still running.
5. **The old version on the migrated schema:** the same reads. This is the expand/contract check: a migration that drops or renames something the old code uses fails here.
6. **The new version** (`api`): readiness, the same reads (data written by the old version, a key hashed by it), and a chat with the fake model.
7. **The old version again,** now next to the new one.

Settings:

| Variable | Default |
|---|---|
| `NEW_IMAGE` | Built from the checkout (`docker build`). |
| `OLD_IMAGE` | `ghcr.io/ncecere/grounded` at `OLD_REF` (`vX.Y.Z` or `sha-<commit>`) if it can be pulled, otherwise built from `OLD_REF` in a temporary git worktree. |
| `OLD_REF` | The last `v*` tag before `HEAD`, or `HEAD^` while there is none. |
| `OLD_PORT`, `NEW_PORT` | 18181, 18182. |
| `RUN_ID` | The script's process ID, used in the names. |

Examples:

```sh
make upgrade-test                               # previous commit (or last release) → this checkout
OLD_REF=v0.1.0 make upgrade-test                # a given release → this checkout
OLD_IMAGE=ghcr.io/ncecere/grounded:v0.1.0 NEW_IMAGE=grounded:dev make upgrade-test
```

**In CI** (`.github/workflows/ci.yml`, job `upgrade`), it runs on every push to `main` after the image is published, against that image. Until v0.1.0 exists the old version is the previous main commit's image; from v0.2.0 on it is the last release, so each release is checked against the one before it. A failure there means the migration (or the code) isn't expand/contract: split it as above.

The harness uses development sign-in and the example keys from `.env.example`, which Grounded accepts only because `APP_URL` is a loopback address. It is a test, not a way to run Grounded.

**What it doesn't cover:** a Kubernetes rollout itself (`make k8s-smoke` checks the manifests), long-running backfills on large data, and downgrades, which aren't supported: go back by restoring a backup taken before the upgrade.

## Upgrading an install

1. Read the release notes for anything to do before or after (a contract step can require the previous release to have run first: don't skip releases that say so).
2. Take a backup, or check that last night's ran (`components/backup-pgdump` or CNPG).
3. Change the image digest in your overlay. The API pods' init container migrates under an advisory lock (concurrent runs wait), then new pods start while old ones keep serving. The worker Deployment rolls at the same time; old and new workers share the queue, which is why job arguments must stay compatible.
4. Check `/readyz`, **Admin → Overview**, and `grounded doctor`.
