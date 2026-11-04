package auditexport

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/riverqueue/river"
)

const Queue = "audit_exports"

type RunArgs struct {
	ID uuid.UUID `json:"id"`
}

func (RunArgs) Kind() string { return "audit_exports.run" }
func (RunArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: 3, UniqueOpts: river.UniqueOpts{ByArgs: true}}
}

type Worker struct {
	river.WorkerDefaults[RunArgs]
	S *Service
}

func (*Worker) Timeout(*river.Job[RunArgs]) time.Duration { return 2 * time.Minute }
func (w *Worker) Work(ctx context.Context, j *river.Job[RunArgs]) error {
	q := dbgen.New(w.S.Pool)
	lease := uuid.NullUUID{UUID: uuid.New(), Valid: true}
	row, err := q.ClaimAuditExportRequest(ctx, dbgen.ClaimAuditExportRequestParams{ID: j.Args.ID, Lease: lease})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var export uuid.UUID
	cfg, err := q.GetAuditExportSettings(ctx)
	if err == nil && (!cfg.Enabled || w.S.KeyID() == "") {
		err = unavailable()
	}
	if err == nil {
		export, err = Freeze(ctx, w.S.Pool, row.Day.Time.UTC(), audit.Entry{ActorKind: audit.ActorSystem})
	}
	if err == nil {
		_, err = Publish(ctx, w.S.Pool, w.S.Store, export, w.S.key)
	}
	state, code := "completed", ""
	if err != nil {
		state, code = "failed", "export_failed"
	}
	// Persist even when River cancels the job; a process crash is reconciled by
	// the scheduler after the bounded lease. Never store underlying error text.
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_, saveErr := q.FinishAuditExportRequest(finish, dbgen.FinishAuditExportRequestParams{ID: row.ID, Lease: lease, State: state, FailureCode: code, ExportID: uuid.NullUUID{UUID: export, Valid: export != uuid.Nil}})
	return saveErr
}

type TickArgs struct{}

func (TickArgs) Kind() string { return "audit_exports.tick" }
func (TickArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: 2, UniqueOpts: river.UniqueOpts{ByPeriod: time.Minute}}
}

type TickWorker struct {
	river.WorkerDefaults[TickArgs]
	S *Service
}

func (w *TickWorker) Work(ctx context.Context, _ *river.Job[TickArgs]) error {
	q := dbgen.New(w.S.Pool)
	if err := q.ExpireAuditExportRequests(ctx); err != nil {
		return err
	}
	keys, err := q.ExpiredAuditExportUploads(ctx)
	if err != nil {
		return err
	}
	for _, key := range keys {
		if w.S.Store == nil || w.S.Store.Delete(ctx, key) != nil {
			return ErrStorage
		}
		if err = q.ForgetAuditExportUpload(ctx, key); err != nil {
			return err
		}
	}
	cfg, err := q.GetAuditExportSettings(ctx)
	if err != nil || !cfg.Enabled || w.S.KeyID() == "" {
		return err
	}
	// One deterministic missed day per minute: bounded queue and no catch-up
	// loop that could starve explicit requests or ingestion.
	day := cfg.CoverageStart.Time
	latest, err := q.LatestAuditExportRequest(ctx)
	if err == nil {
		if latest.State != "completed" {
			return nil
		}
		day = latest.Day.Time.AddDate(0, 0, 1)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if !day.Before(time.Now().UTC().Truncate(24 * time.Hour)) {
		return nil
	}
	_, err = w.S.Request(ctx, cfg.Revision, day.UTC(), uuid.Nil, audit.Entry{ActorKind: audit.ActorSystem})
	return err
}
func Register(w *river.Workers, s *Service) {
	river.AddWorker(w, &Worker{S: s})
	river.AddWorker(w, &TickWorker{S: s})
}
func Periodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Minute), func() (river.JobArgs, *river.InsertOpts) { return TickArgs{}, nil }, nil)
}
