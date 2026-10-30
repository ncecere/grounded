package contenthealth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestNeverCitedScanCapIncludesIneligibleEvents(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	a := f.served(f.teamA, src)
	f.addDoc(f.teamA, src, doc{})
	f.svc.AnswerScanLimit = MinAnswers
	when := asOf.AddDate(0, 0, -10)
	f.answers(f.teamA, a, MinAnswers, when, "ui")
	f.event(f.teamA, a, 1, when, event{refused: true})
	s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited)
	if s.State != StateUnavailable || s.Reason != ReasonTooManyAnswers || s.Found != 0 {
		t.Fatalf("event cap ignored refusal traffic: %+v; want unavailable too_many_answers", s)
	}
}

func TestNeverCitedWindowIncludesEarlierIneligibleCitations(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	a := f.served(f.teamA, src)
	d := f.addDoc(f.teamA, src, doc{})
	earlier := asOf.AddDate(0, 0, -30)
	f.event(f.teamA, a, 1, earlier, event{errCode: "stream_error", cited: []uuid.UUID{d}})
	f.answers(f.teamA, a, MinAnswers, asOf.AddDate(0, 0, -10), "ui")
	s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited)
	if s.State != StateMeasured || s.Found != 0 || s.ObservedSince == nil || !s.ObservedSince.Equal(earlier) {
		t.Fatalf("retained citation before the first eligible answer was lost: %+v; want measured zero since %v", s, earlier)
	}
}

type reviewProbe struct {
	fn func(context.Context, *Env) (Result, error)
}

func (reviewProbe) Name() string { return "review_probe" }
func (s reviewProbe) Collect(ctx context.Context, env *Env) (Result, error) {
	return s.fn(ctx, env)
}

func TestSignalReadsOneDatabaseSnapshot(t *testing.T) {
	f := newFixture(t)
	probe := reviewProbe{fn: func(ctx context.Context, env *Env) (Result, error) {
		before, err := env.Q.GetContentHealthSettings(ctx)
		if err != nil {
			return Result{}, err
		}
		f.exec(`UPDATE content_health_settings SET enabled = NOT enabled`)
		after, err := env.Q.GetContentHealthSettings(ctx)
		if err != nil {
			return Result{}, err
		}
		var same int64
		if before.Enabled == after.Enabled {
			same = 1
		}
		return Result{State: StateMeasured, Counts: map[string]int64{"sameSnapshot": same}}, nil
	}}
	res, err := f.svc.collectOne(f.ctx, probe, &Env{Q: f.svc.q})
	if err != nil || res.Counts["sameSnapshot"] != 1 {
		t.Fatalf("one signal used changing database snapshots: %+v, %v", res, err)
	}
}

func TestSignalCannotWriteThroughItsEnvironment(t *testing.T) {
	f := newFixture(t)
	rep := f.report(f.teamA, 365, 90, nil, nil)
	probe := reviewProbe{fn: func(ctx context.Context, env *Env) (Result, error) {
		_, err := env.Q.DeleteContentHealthReport(ctx, dbgen.DeleteContentHealthReportParams{ID: rep.ID, TeamID: f.teamA})
		return Result{}, err
	}}
	_, err := f.svc.collectOne(f.ctx, probe, &Env{Q: f.svc.q})
	var pe *pgconn.PgError
	if !errors.As(err, &pe) || pe.Code != "25006" {
		t.Fatalf("signal environment allowed a database write: %v; want read_only_sql_transaction", err)
	}
	if f.count(`SELECT count(*) FROM content_health_reports WHERE id = $1`, rep.ID) != 1 {
		t.Error("a signal deleted the report it was supposed to measure")
	}
}

func TestStoreHonorsExpiredReportDeadline(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	f.addDoc(f.teamA, src, doc{})
	rep := f.report(f.teamA, 365, 90, nil, nil)
	out, err := f.svc.collect(f.ctx, rep, *rep.AsOf)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithDeadline(f.ctx, time.Now().Add(-time.Second))
	defer cancel()
	if err := f.svc.store(ctx, rep, out); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("store ignored the expired report deadline: %v", err)
	}
	if status, code := f.status(rep.ID); status != StatusFailed || code != ErrTimedOut {
		t.Errorf("deadline-expired report is %s %q; want failed timed_out", status, code)
	}
	if f.count(`SELECT count(*) FROM content_health_findings WHERE report_id = $1`, rep.ID) != 0 {
		t.Error("findings were stored after the report deadline expired")
	}
}

func TestFailureFinalizationHasABoundedCleanupBudget(t *testing.T) {
	f := newFixture(t)
	f.svc.finalizeLimit = 100 * time.Millisecond
	rep := f.report(f.teamA, 365, 90, nil, nil)
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	if _, err := tx.Exec(f.ctx, `SELECT id FROM content_health_reports WHERE id = $1 FOR UPDATE`, rep.ID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- f.svc.fail(f.ctx, rep.ID, ErrTimedOut) }()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("failure finalization: %v; want its cleanup deadline", err)
		}
	case <-time.After(testutil.Scale(2 * time.Second)):
		_ = tx.Rollback(f.ctx)
		select {
		case <-done:
		case <-time.After(testutil.Scale(2 * time.Second)):
			t.Fatal("failure finalization did not stop even after its blocker was released")
		}
		t.Fatal("failure finalization ignored its cleanup budget")
	}
	_ = tx.Rollback(f.ctx)
	// A database lock can prevent terminal-state persistence; recovery remains
	// possible after the lock ends, rather than keeping a worker stuck forever.
	if err := f.svc.fail(f.ctx, rep.ID, ErrTimedOut); err != nil {
		t.Fatal(err)
	}
	if status, code := f.status(rep.ID); status != StatusFailed || code != ErrTimedOut {
		t.Fatalf("recovered finalization: %s %q", status, code)
	}
}
