// Package doccounts checks the document counters that the documents triggers keep (migration 00072, ADR-0036): per team
// (documents, bytes), per source and status, and per source and tag. The triggers count every write, so the counters
// should never be off; a daily job compares them with the documents and corrects any difference, and logs it, so a
// mistake (a trigger disabled by hand, a bug) is found and cannot last.
package doccounts

import (
	"context"
	"log/slog"
	"time"

	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Kinds are the counters reconcile_document_counts takes, in the order a pass reconciles them.
var Kinds = []string{"teams", "sources", "tags"}

// Queue is the reconcile job's own queue, so a release that does not know the job (a rolling update, a rollback) never
// takes it.
const Queue = "document_counts"

// Reconcile makes every counter equal to the documents and returns, per kind, how many keys were off (zero when the
// counters were right). Each kind is one statement in its own transaction; writes go on meanwhile.
func Reconcile(ctx context.Context, q *dbgen.Queries) (map[string]int64, error) {
	off := make(map[string]int64, len(Kinds))
	for _, k := range Kinds {
		n, err := q.ReconcileDocumentCounts(ctx, k)
		if err != nil {
			return off, err
		}
		off[k] = n
	}
	return off, nil
}

// ReconcileArgs is the daily reconcile.
type ReconcileArgs struct{}

func (ReconcileArgs) Kind() string { return "document_counts.reconcile" }

// InsertOpts: one run a day however many workers schedule it, one attempt (the next day's run is the retry).
func (ReconcileArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: 1, UniqueOpts: river.UniqueOpts{ByPeriod: 24 * time.Hour}}
}

// Worker runs Reconcile. It reads every document once per kind, so it runs daily, not often.
type Worker struct {
	river.WorkerDefaults[ReconcileArgs]
	Q   *dbgen.Queries
	Log *slog.Logger
}

// Timeout: three scans of the documents table of a large install.
func (w *Worker) Timeout(*river.Job[ReconcileArgs]) time.Duration { return 30 * time.Minute }

func (w *Worker) Work(ctx context.Context, _ *river.Job[ReconcileArgs]) error {
	off, err := Reconcile(ctx, w.Q)
	if err != nil {
		return err
	}
	if off["teams"]+off["sources"]+off["tags"] > 0 {
		w.Log.WarnContext(ctx, "document counters were off and have been corrected",
			"teams", off["teams"], "sources", off["sources"], "tags", off["tags"])
	}
	return nil
}

// Periodic schedules the reconcile daily, and when a worker starts (an install that deploys more often than daily would
// otherwise never run it); the unique period keeps it to one run per UTC day.
func Periodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(24*time.Hour),
		func() (river.JobArgs, *river.InsertOpts) { return ReconcileArgs{}, nil }, &river.PeriodicJobOpts{RunOnStart: true})
}
