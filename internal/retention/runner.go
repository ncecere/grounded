package retention

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Result is one kind's outcome of a run: counts only, never content.
type Result struct {
	Deleted int64 `json:"deleted"`
	// Held counts the rows past their period that legal holds kept.
	Held int64 `json:"held"`
	// Kept: the kind has no period, so nothing is due.
	Kept  bool   `json:"kept,omitempty"`
	Error string `json:"error,omitempty"`
}

// Results are a run's outcome per kind.
type Results map[Kind]Result

// Deleted is the total deleted.
func (rs Results) Deleted() int64 {
	var n int64
	for _, r := range rs {
		n += r.Deleted
	}
	return n
}

// Runner applies the rules in bounded batches.
type Runner struct {
	Pool *pgxpool.Pool
	// Blob removes the stored files of deleted content.
	Blob blob.Store
	// Env are the environment defaults of the periods and batch bounds.
	Env config.Retention
	// Rules default to Rules().
	Rules []Rule
	// Batch is the rows per transaction; MaxBatches bounds one run per kind
	// (0: Env's, else 500 and 100), so a backlog is worked off over runs.
	Batch, MaxBatches int
	Now               func() time.Time
	Log               *slog.Logger
	Metrics           *Metrics
}

func (r *Runner) bounds() (batch, rounds int) {
	batch, rounds = r.Batch, r.MaxBatches
	if batch <= 0 {
		batch = r.Env.BatchSize
	}
	if batch <= 0 {
		batch = 500
	}
	if rounds <= 0 {
		rounds = r.Env.MaxBatches
	}
	if rounds <= 0 {
		rounds = 100
	}
	return batch, rounds
}

func (r *Runner) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *Runner) rules() []Rule {
	if r.Rules != nil {
		return r.Rules
	}
	return Rules()
}

// LoadPeriods reads the platform setting and resolves the effective periods.
func LoadPeriods(ctx context.Context, db dbgen.DBTX, env config.Retention) (Periods, error) {
	row, err := dbgen.New(db).GetRetentionSettings(ctx)
	if err != nil {
		return nil, fmt.Errorf("read retention settings: %w", err)
	}
	stored, err := ParseStored(row.Periods)
	if err != nil {
		return nil, err
	}
	return Resolve(stored, env), nil
}

// Apply runs the rules once (only the given kinds when any), without the
// run lock, a run record or an audit entry (Run adds those). A failing kind
// doesn't stop the others; the error joins every failure.
func (r *Runner) Apply(ctx context.Context, kinds []Kind) (Results, error) {
	periods, err := LoadPeriods(ctx, r.Pool, r.Env)
	if err != nil {
		return nil, err
	}
	now := r.now()
	out := Results{}
	var errs []error
	for _, rule := range r.rules() {
		if len(kinds) > 0 && !slices.Contains(kinds, rule.Kind) {
			continue
		}
		res := r.apply(ctx, rule, periods, now)
		out[rule.Kind] = res
		r.Metrics.observe(rule.Kind, res, r.now())
		if res.Error != "" {
			errs = append(errs, fmt.Errorf("retention %s: %s", rule.Kind, res.Error))
		}
	}
	return out, errors.Join(errs...)
}

func (r *Runner) apply(ctx context.Context, rule Rule, periods Periods, now time.Time) Result {
	candidates, ok := rule.candidates(periods)
	if !ok {
		return Result{Kept: true}
	}
	batch, rounds := r.bounds()
	var res Result
	for range rounds {
		var n int64
		err := pgx.BeginFunc(ctx, r.Pool, func(tx pgx.Tx) error {
			var err error
			n, err = rule.purge(ctx, r, tx, candidates, now, batch)
			return err
		})
		if err != nil {
			res.Error = err.Error()
			return res
		}
		res.Deleted += n
		if n < int64(batch) {
			break
		}
	}
	if err := r.Pool.QueryRow(ctx, `SELECT count(*) FROM (`+candidates+`) c WHERE c.held`, now).Scan(&res.Held); err != nil {
		res.Error = err.Error()
	}
	return res
}

// lockKey serialises retention runs across processes.
const lockKey = 7378431028

// withLock runs fn while holding the retention lock; ran is false when
// another run holds it.
func (r *Runner) withLock(ctx context.Context, fn func() error) (ran bool, err error) {
	conn, err := r.Pool.Acquire(ctx)
	if err != nil {
		return false, err
	}
	defer conn.Release()
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, lockKey).Scan(&ran); err != nil || !ran {
		return false, err
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, lockKey) }()
	return true, fn()
}

// RunScheduled is the periodic run: every kind, recorded and audited. It
// does nothing while another run is in progress.
func (r *Runner) RunScheduled(ctx context.Context) (ran bool, err error) {
	return r.withLock(ctx, func() error {
		run, err := dbgen.New(r.Pool).InsertRetentionRun(ctx, dbgen.InsertRetentionRunParams{Trigger: "schedule", Kinds: []string{}, Status: "running"})
		if err != nil {
			return err
		}
		return r.execute(ctx, run)
	})
}

// RunRequested runs a run an admin asked for (queued by Service.RequestRun).
// ran is false while another run is in progress; a run that already started
// is not run again.
func (r *Runner) RunRequested(ctx context.Context, id int64) (ran bool, err error) {
	return r.withLock(ctx, func() error {
		run, err := dbgen.New(r.Pool).StartRetentionRun(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		return r.execute(ctx, run)
	})
}

// execute applies the run's kinds and records the outcome: the run's
// results and, when anything was deleted or an admin asked for the run, a
// system audit entry with the counts.
func (r *Runner) execute(ctx context.Context, run dbgen.RetentionRun) error {
	start := time.Now()
	kinds := make([]Kind, 0, len(run.Kinds))
	for _, k := range run.Kinds {
		kinds = append(kinds, Kind(k))
	}
	results, applyErr := r.Apply(ctx, kinds)
	r.Metrics.observeRun(time.Since(start))
	status, msg := "ok", ""
	if applyErr != nil {
		status, msg = "error", applyErr.Error()
		if r.Log != nil {
			r.Log.WarnContext(ctx, "retention run failed", "run", run.ID, "err", applyErr)
		}
	}
	raw, err := json.Marshal(results)
	if err != nil {
		return err
	}
	ctx = context.WithoutCancel(ctx) // record the outcome even when the job is cancelled
	err = store.InTx(ctx, r.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.FinishRetentionRun(ctx, dbgen.FinishRetentionRunParams{ID: run.ID, Status: status, Results: raw, Error: msg}); err != nil {
			return err
		}
		if results.Deleted() == 0 && run.Trigger == "schedule" {
			return nil
		}
		return audit.Record(ctx, q, audit.Entry{
			ActorKind: audit.ActorSystem, Action: "retention.purge", TargetType: "retention", TargetID: strconv.FormatInt(run.ID, 10),
			Metadata: map[string]any{"name": "Retention run", "runId": run.ID, "trigger": run.Trigger, "status": status, "results": results},
		})
	})
	if err != nil {
		return err
	}
	if r.Log != nil && results.Deleted() > 0 {
		r.Log.InfoContext(ctx, "retention deleted expired data", "run", run.ID, "deleted", results.Deleted())
	}
	q := dbgen.New(r.Pool)
	_, _ = q.FailStaleRetentionRuns(ctx)
	_, _ = q.PruneRetentionRuns(ctx)
	return nil
}

// actorID is a nullable user id for records.
func actorID(id uuid.UUID) uuid.NullUUID { return uuid.NullUUID{UUID: id, Valid: id != uuid.Nil} }
