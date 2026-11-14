# ADR-0036: Document counters kept by database triggers

- Status: Accepted (2026-11-13; built in #249)
- Date: 2026-11-13

## Context

Four reads aggregated every document of a team or source each time they ran (#249):

- **The usage check.** `TeamDocumentUsage` counted a team's documents and summed their bytes for the `documents` and
  `storage_bytes` limits (DESIGN.md §11.1). It ran for every stored document (each uploaded file, each crawled page, each
  document a connector sync adds) inside the transaction that holds the team's usage lock, so storing documents was
  quadratic in the team's size and the lock was held for the whole scan.
- **The source pages.** `SourceDocumentStats` grouped a source's documents by status, with sums and a JSON read for the
  personal-data review count. The source list and detail pages ran it, the detail page every 2 seconds while documents
  were processing, and retrieval ran it (cached for a minute) to estimate a knowledge base's vector count.
- **The tag list.** `ListSourceTags` unnested every document's tags each time the documents table opened.
- **The admin team pages.** `ListTeamsAdmin` and `TeamCounts` counted and summed each team's documents.

Measured on one source of a seeded team (the numbers are in the PR for #249), at 1M documents storing one document took
95 ms (210 ms each with 8 uploads at once) and the source page's statistics took 825 ms. The design targets more than
1M documents per install (DESIGN.md §1).

Who writes documents matters here. Uploads, crawled pages, connector syncs, the ingestion dispatcher and processor, tag
edits, personal-data reviews, re-crawls and connector removals, deleting a source or a team (by cascade), profile
migrations, test fixtures: about thirty statements in eight packages. During a rolling update (ADR-0013) and after a
rollback, the previous release's servers write documents too, and they would not know about counters the application
kept.

## Decision

### Three counter tables, kept by triggers on `documents`

- `team_document_counts (team_id, slot)`: documents and bytes. Platform-shared sources belong to no team and are not
  counted for one.
- `source_document_counts (source_id, status, slot)`: documents, bytes, chunks, and documents waiting for a
  personal-data review.
- `source_tag_counts (source_id, tag, slot)`: documents carrying the tag.

The reads above sum the slots of the keys they need, which is a few rows. Their results are unchanged; a status with no
documents is left out, as it was.

**The database keeps the counters, not the application.** Three `AFTER ... FOR EACH STATEMENT` triggers with transition
tables (insert, update, delete; Postgres does not allow transition tables on a trigger with several events) call one
function. A statement's inserted rows count +1 each, its deleted rows -1, and an update counts its new rows +1 and its
old rows -1, so a status change moves a document from one status to the other and an update that changes nothing
counted adds nothing. The function aggregates the statement's rows by key first, so deleting a source of a million
documents writes a few counter rows, not a million. Every write is counted, whichever code makes it and whichever
release runs it.

A key whose source or team no longer exists (deleted in the same transaction, its documents going by cascade) is
skipped; the counter rows go by their own `ON DELETE CASCADE`.

### Slots against contention

A counter row is locked from the statement that changes it until its transaction commits, and the ingestion processor
finishes a document (status `ready`, chunk count) in the middle of its commit transaction. One row per source would make
the workers finishing documents of the same source wait for each other. Each counter therefore has 16 slots, and a
transaction writes the slot of its database backend (`pg_backend_pid() % 16`): workers on different connections rarely
share a row. A slot may hold a negative count (a document queued in one slot and finished in another); only the sum
means anything.

The per-team row is written only when documents are inserted or deleted or their size changes, never on a status
change. Uploads, crawled pages and connector syncs insert under the team's usage lock, which already serialises them, so
the team counter adds no waiting there.

Each statement writes its keys in order (sources and statuses, then teams, then tags), so two statements on the same
keys lock them in the same order. Two transactions that each touch several sources in different statements in the
opposite order, on the same slot, can still deadlock; Postgres ends one of them (a job is retried, a request fails).
Only bulk operations touch several sources in one transaction, and they are rare.

### Reconcile: add the difference, in one snapshot

`reconcile_document_counts(kind)` (kind `teams`, `sources` or `tags`) compares the counters with an aggregate over the
documents **in one statement**, so in one snapshot, and adds the difference to slot 0. A change committed meanwhile is
in both the documents and the counters or in neither, because the trigger writes the counter in the change's own
transaction; so the difference is exactly what the counters are off by, whatever is written in the meantime, and
`documents` is never locked. Runs are serialised by an advisory lock (a second run sees the first's result and adds
nothing). If a source or team is deleted between the snapshot and the write, the foreign key error makes the statement
run again. It also removes rows that hold nothing.

It is used three times:

- **Backfill.** Migration 00072 creates the tables, the functions and the triggers; migration 00073 runs the reconcile
  for each kind, each as its own transaction (`NO TRANSACTION`). The counters start at zero when the triggers appear and
  count every write from then on, including the previous release's; the backfill then adds what the documents held
  before. No write to `documents` waits for it (only `CREATE TRIGGER` takes its brief table lock), and running it again
  after an interruption adds nothing. With 1M documents it took 0.5 s (teams), 0.9 s (sources) and 1.9 s (tags).
- **Daily.** A River job (`document_counts.reconcile`, on its own queue so a previous release never takes it) runs it
  and logs a warning with the number of keys it corrected. It should always correct nothing; a correction means a
  trigger was disabled or there is a bug, and the counters are right again within a day.
- **Tests.** The integration tests compare every counter read with the aggregate it replaced after each kind of write,
  and require the reconcile to find nothing.

`grounded doctor` checks that the three triggers exist and are enabled, and says how to repair the counters if not.

### The tag list

The tag list reads `source_tag_counts` (tags with at least one document, alphabetically, the first 200). A cache was
the alternative; it would show a tag removed a moment ago, or miss one just added, while the counter is exact and
cheap.

## Consequences

- Storing a document reads a few counter rows under the usage lock instead of the team's documents: its cost no longer
  grows with the team. The source page, the tag list and the admin team pages read a few rows.
- Every statement that writes `documents` pays for the trigger: a single-row change about a few hundred microseconds
  (two small aggregates, an index lookup per key, an upsert); a statement over many rows builds its transition tables.
  Updating the status of all 100k documents of a source took 38–45 s with the triggers and 22–42 s without them on a
  shared test machine: the cost is within the noise of a statement that mostly rewrites rows and their indexes. Statements that change nothing counted
  write nothing.
- The counters are derived data. A restore from `pg_dump` restores them with the documents. Disabling the triggers
  (`ALTER TABLE documents DISABLE TRIGGER`, `session_replication_role = replica`) lets them drift; the daily reconcile
  corrects them, and `grounded doctor` reports disabled triggers.
- A new counted value needs a column, the trigger function changed in a new migration (`CREATE OR REPLACE`), and a
  backfill by a new kind of reconcile, in the same expand-only way.

## Alternatives considered

- **Counters written by the application** in the upload, crawl, sync, ingest, tag, review and delete transactions.
  Rejected. About thirty statements would each need the right delta, the cascades from a deleted source or team have no
  application statement to put it in, and the previous release's servers would write documents without counting them
  during every rolling update and after a rollback. A reconcile could repair that, but the counters would be wrong in
  between, and the usage limits read them.
- **Row-level triggers.** Simpler functions, but a statement over many rows (a source deleted, a re-crawl's unseen pages,
  a whole source re-queued) would update the same counter row once per document in one transaction.
- **Deferred constraint triggers** (fire at commit, so the counter row is locked only for the commit). Row-level only,
  with the same cost on large statements; slots solve the contention instead.
- **One counter row per team and source, no slots.** Concurrent workers finishing documents of one source would queue on
  that row for the rest of their commit transactions.
- **Insert-only delta rows, folded periodically.** No contention at all, but every read sums the unfolded deltas, and a
  folding job is needed and must be monitored.
- **A backfill inside the migration's transaction** (create the triggers and aggregate in one transaction). Exact, but
  `CREATE TRIGGER`'s lock would block every write to `documents` until the aggregate finished: seconds on a large
  install, longer on a larger one. The difference-in-one-snapshot reconcile needs no lock.
- **A short cache** for the tag list or the source statistics. Rejected for the reasons above; the usage check cannot be
  cached at all, since it must see the last committed document.
