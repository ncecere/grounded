// Package ingest turns uploaded or fetched documents into searchable chunks:
// fetch the original, parse, chunk, embed and index (DESIGN.md §5.5).
//
// Work is scheduled by a dispatcher that shares ingestion capacity fairly
// between teams: a team uploading a million files cannot starve the others.
// Documents move pending → queued → processing → ready | failed | skipped.
// Pending documents of paused sources wait until the source is resumed.
package ingest

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Queue is the River queue for document processing; its worker count bounds
// per-process ingestion concurrency.
const Queue = "ingest"

// DispatchArgs schedules pending documents. It runs periodically and is
// also enqueued ("kicked") after uploads and after each document finishes.
type DispatchArgs struct{}

func (DispatchArgs) Kind() string { return "ingest.dispatch" }

func (DispatchArgs) InsertOpts() river.InsertOpts {
	// At most one dispatch waiting or running at a time; bursts of kicks
	// collapse into it. Completed runs are deliberately not counted (River's
	// default would count them), so a kick after a run always schedules a
	// new one. A kick that lands while a dispatch is mid-run is covered by
	// the next document completion or the periodic dispatch.
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByState: []rivertype.JobState{
		rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRunning, rivertype.JobStateScheduled,
	}}}
}

// ProcessArgs processes one document.
type ProcessArgs struct {
	DocumentID uuid.UUID `json:"documentId"`
}

func (ProcessArgs) Kind() string { return "ingest.document" }

func (ProcessArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: 5}
}

// Kick enqueues a dispatch in tx (so it commits with the change that
// created work). client may be an insert-only River client.
func Kick(ctx context.Context, client *river.Client[pgx.Tx], tx pgx.Tx) error {
	_, err := client.InsertTx(ctx, tx, DispatchArgs{}, nil)
	return err
}

// Limits bound ingestion concurrency across the whole platform.
type Limits struct {
	MaxInflight int // documents queued or processing, platform-wide
	// MaxInflightTeam is the per-team cap when Team is nil.
	MaxInflightTeam int
}

type DispatchWorker struct {
	river.WorkerDefaults[DispatchArgs]
	Pool   *pgxpool.Pool
	Limits Limits
	// Team supplies the per-team cap: the concurrent_ingest_jobs team limit
	// (platform default and ceiling here, team overrides applied in SQL).
	Team *limits.Service
	// Maintenance holds pending documents while maintenance mode is on (nil:
	// never; docs/phase5-deploy.md §5 P5).
	Maintenance *platform.MaintenanceGate
	Log         *slog.Logger
}

// TeamCap is the per-team in-flight cap: concurrent_ingest_jobs' platform
// default (nil = unlimited) and ceiling (nil = none). Team overrides are
// applied in SQL. Documents of shared sources use the default.
type TeamCap struct {
	Default, Ceiling *int64
}

// unlimitedInflight stands in for "no limit" in SQL arithmetic.
const unlimitedInflight = int64(1) << 40

// pickSQL selects pending documents round-robin across teams: every team's
// oldest pending document before any team's second, bounded by each team's
// free in-flight slots: its concurrent_ingest_jobs override ($4 names the
// key in team_limits) or the default ($1), capped by the ceiling ($3; LEAST
// ignores NULL). Documents of platform-shared sources (team_id NULL) form
// one more bucket ("platform") with the default cap. Teams are enumerated
// with a loose index scan so millions of pending rows are never sorted; the
// platform bucket reads the same index at its NULL end.
const pickSQL = `
WITH RECURSIVE teams_pending AS (
    (SELECT team_id FROM documents WHERE status = 'pending' AND team_id IS NOT NULL ORDER BY team_id LIMIT 1)
    UNION ALL
    SELECT (SELECT d.team_id FROM documents d
            WHERE d.status = 'pending' AND d.team_id > tp.team_id ORDER BY d.team_id LIMIT 1)
    FROM teams_pending tp WHERE tp.team_id IS NOT NULL
),
budget AS (
    SELECT tp.team_id,
           greatest(least(coalesce((SELECT (tl.overrides ->> $4::text)::bigint FROM team_limits tl WHERE tl.team_id = tp.team_id),
                                   $1::bigint), $3::bigint)
                    - (SELECT count(*) FROM documents i
                       WHERE i.team_id = tp.team_id AND i.status IN ('queued', 'processing')), 0) AS free
    FROM teams_pending tp WHERE tp.team_id IS NOT NULL
),
platform_budget AS (
    SELECT greatest(least($1::bigint, $3::bigint) - (SELECT count(*) FROM documents i
                               WHERE i.team_id IS NULL AND i.status IN ('queued', 'processing')), 0) AS free
    WHERE EXISTS (SELECT 1 FROM documents WHERE team_id IS NULL AND status = 'pending')
),
picks AS (
    SELECT p.id, p.rn FROM budget b
    CROSS JOIN LATERAL (
        SELECT d.id, row_number() OVER (ORDER BY d.updated_at, d.id) AS rn
        FROM documents d
        WHERE d.team_id = b.team_id AND d.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM data_sources s WHERE s.id = d.source_id AND s.status = 'paused')
        ORDER BY d.updated_at, d.id
        LIMIT b.free
    ) p
    UNION ALL
    SELECT p.id, p.rn FROM platform_budget pb
    CROSS JOIN LATERAL (
        SELECT d.id, row_number() OVER (ORDER BY d.updated_at, d.id) AS rn
        FROM documents d
        WHERE d.team_id IS NULL AND d.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM data_sources s WHERE s.id = d.source_id AND s.status = 'paused')
        ORDER BY d.updated_at, d.id
        LIMIT pb.free
    ) p
)
SELECT id FROM picks
ORDER BY rn, id
LIMIT $2`

// PickFair returns up to limit pending documents, round-robin across teams
// (and the platform bucket), keeping each within its in-flight cap.
func PickFair(ctx context.Context, tx pgx.Tx, cap TeamCap, limit int) ([]uuid.UUID, error) {
	def := unlimitedInflight
	if cap.Default != nil {
		def = *cap.Default
	}
	rows, err := tx.Query(ctx, pickSQL, def, limit, cap.Ceiling, string(limits.ConcurrentIngestJobs))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

func (w *DispatchWorker) Work(ctx context.Context, job *river.Job[DispatchArgs]) error {
	// Maintenance mode: pending documents wait; the periodic dispatch
	// queues them once it ends.
	if paused, err := w.Maintenance.Paused(ctx); err != nil || paused {
		return err
	}
	client := river.ClientFromContext[pgx.Tx](ctx)
	var queued int
	err := pgx.BeginFunc(ctx, w.Pool, func(tx pgx.Tx) error {
		var err error
		queued, err = w.Dispatch(ctx, tx, client)
		return err
	})
	if queued > 0 {
		w.Log.Debug("dispatched documents", "count", queued)
	}
	return err
}

// Dispatch queues pending documents into the free in-flight slots, in tx,
// under the dispatcher lock (held until tx ends). It is the dispatch job's
// work, and a finishing document runs it in its own commit transaction to
// refill its slot at once (Processor.Dispatcher): kicks that land while a
// dispatch job runs are dropped by its uniqueness, so relying on them left
// slots idle until the periodic dispatch (docs/benchmarks/load.md).
func (w *DispatchWorker) Dispatch(ctx context.Context, tx pgx.Tx, client *river.Client[pgx.Tx]) (int, error) {
	q := dbgen.New(tx)
	if err := q.LockDispatcher(ctx); err != nil {
		return 0, err
	}
	inflight, err := q.CountInflight(ctx)
	if err != nil {
		return 0, err
	}
	free := w.Limits.MaxInflight - int(inflight)
	if free <= 0 {
		return 0, nil
	}
	cap := TeamCap{Default: ptr(int64(w.Limits.MaxInflightTeam))}
	if w.Team != nil {
		st, err := w.Team.IngestJobCap(ctx, q)
		if err != nil {
			return 0, err
		}
		cap = TeamCap{Default: st.Default, Ceiling: st.Ceiling}
	}
	ids, err := PickFair(ctx, tx, cap, free)
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	marked, err := q.MarkQueued(ctx, ids)
	if err != nil {
		return 0, err
	}
	params := make([]river.InsertManyParams, len(marked))
	for i, id := range marked {
		params[i] = river.InsertManyParams{Args: ProcessArgs{DocumentID: id}}
	}
	if _, err := client.InsertManyTx(ctx, tx, params); err != nil {
		return 0, err
	}
	return len(marked), nil
}

// RecoverArgs returns documents stuck in queued/processing (for example
// after their job was discarded) to pending.
type RecoverArgs struct{}

func (RecoverArgs) Kind() string { return "ingest.recover" }

func (RecoverArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: 10 * time.Minute}}
}

type RecoverWorker struct {
	river.WorkerDefaults[RecoverArgs]
	Queries *dbgen.Queries
	Log     *slog.Logger
}

func (w *RecoverWorker) Work(ctx context.Context, _ *river.Job[RecoverArgs]) error {
	n, err := w.Queries.RecoverStuckDocuments(ctx, 120)
	if n > 0 {
		w.Log.Warn("recovered stuck documents", "count", n)
	}
	return err
}

func ptr(n int64) *int64 { return &n }
