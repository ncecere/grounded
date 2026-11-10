package ingest

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// SweepArgs enqueues refreshes that are due but have no job: requested
// while a refresh was finishing, by code without a River client, or seeded
// by the migration.
type SweepArgs struct{}

func (SweepArgs) Kind() string { return "boilerplate.sweep" }

func (SweepArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: time.Minute}}
}

// SweepWorker runs boilerplate.sweep.
type SweepWorker struct {
	river.WorkerDefaults[SweepArgs]
	Queries *dbgen.Queries
}

func (w *SweepWorker) Work(ctx context.Context, _ *river.Job[SweepArgs]) error {
	ids, err := w.Queries.SourcesDueForBoilerplate(ctx)
	if err != nil || len(ids) == 0 {
		return err
	}
	client, err := river.ClientFromContextSafely[pgx.Tx](ctx)
	if err != nil {
		return err
	}
	params := make([]river.InsertManyParams, len(ids))
	for i, id := range ids {
		params[i] = river.InsertManyParams{Args: RefreshArgs{SourceID: id}}
	}
	_, err = client.InsertMany(ctx, params)
	return err
}
