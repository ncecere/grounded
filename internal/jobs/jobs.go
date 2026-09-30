// Package jobs configures the River job queue (ADR-0003). Jobs live in the
// same PostgreSQL database as application data, so work can be enqueued in
// the same transaction as the change that requires it.
package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Client is the River client type used throughout the application.
type Client = river.Client[pgx.Tx]

// NewInsertOnly returns a client that can enqueue jobs but never works them.
// API processes use this.
func NewInsertOnly(pool *pgxpool.Pool, log *slog.Logger) (*Client, error) {
	return river.NewClient(riverpgxv5.New(pool), &river.Config{Logger: log, Middleware: []rivertype.Middleware{&traceMiddleware{}}})
}

// Registration adds application workers, queues and periodic jobs.
type Registration struct {
	Register func(*river.Workers)
	Queues   map[string]river.QueueConfig
	Periodic []*river.PeriodicJob
}

// NewWorker returns a client that works the default queue (plus any
// registered queues) and schedules periodic jobs. Call Start to begin.
func NewWorker(pool *pgxpool.Pool, log *slog.Logger, concurrency int, reg Registration) (*Client, error) {
	workers := river.NewWorkers()
	river.AddWorker(workers, &SessionCleanupWorker{Queries: dbgen.New(pool), Log: log})
	if reg.Register != nil {
		reg.Register(workers)
	}
	queues := map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: concurrency}}
	for name, q := range reg.Queues {
		queues[name] = q
	}
	periodic := append([]*river.PeriodicJob{
		river.NewPeriodicJob(river.PeriodicInterval(time.Hour),
			func() (river.JobArgs, *river.InsertOpts) { return SessionCleanupArgs{}, nil },
			&river.PeriodicJobOpts{RunOnStart: true}),
	}, reg.Periodic...)
	return river.NewClient(riverpgxv5.New(pool), &river.Config{
		Logger:       log,
		Queues:       queues,
		Workers:      workers,
		PeriodicJobs: periodic,
		Middleware:   []rivertype.Middleware{&traceMiddleware{}, metricsMiddleware()},
	})
}

// SessionCleanupArgs deletes expired browser sessions.
type SessionCleanupArgs struct{}

func (SessionCleanupArgs) Kind() string { return "sessions.cleanup" }

func (SessionCleanupArgs) InsertOpts() river.InsertOpts {
	// Several workers schedule the same periodic job; only one needs to run.
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: time.Hour}}
}

type SessionCleanupWorker struct {
	river.WorkerDefaults[SessionCleanupArgs]
	Queries *dbgen.Queries
	Log     *slog.Logger
}

func (w *SessionCleanupWorker) Work(ctx context.Context, _ *river.Job[SessionCleanupArgs]) error {
	n, err := w.Queries.DeleteExpiredSessions(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		w.Log.Info("deleted expired sessions", "count", n)
	}
	return nil
}
