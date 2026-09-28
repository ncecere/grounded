package notify_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/testutil"
)

// deliveryEnv is a database with one team, a notify service and a River
// worker that sends email to an SMTP sink with a short retry backoff.
type deliveryEnv struct {
	pool *pgxpool.Pool
	svc  *notify.Service
	sink *testutil.SMTPSink
	team notify.TeamRef
}

func newDeliveryEnv(t *testing.T) *deliveryEnv {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	log := testutil.Logger()
	sink := testutil.NewSMTPSink(t)
	inserter, err := jobs.NewInsertOnly(pool, log)
	if err != nil {
		t.Fatal(err)
	}
	env := &deliveryEnv{pool: pool, sink: sink, svc: notify.New(pool, inserter, true, log)}
	env.team = notify.TeamRef{Slug: "registrar", Name: "Registrar"}
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO teams (slug, name, max_classification) VALUES ('registrar', 'Registrar', 'open') RETURNING id`).Scan(&env.team.ID); err != nil {
		t.Fatal(err)
	}
	sender := &notify.SMTPSender{Config: notify.SMTPConfig{Host: sink.Host(), Port: sink.Port(), TLS: "none", Timeout: 5 * time.Second}}
	w, err := jobs.NewWorker(pool, log, 2, jobs.Registration{Register: func(ws *river.Workers) {
		river.AddWorker(ws, &notify.EmailWorker{
			Pool: pool, Sender: sender, From: "Campus RAG <rag@example.edu>", Log: log,
			Site:    notify.Site{Instance: "Campus RAG", AppURL: "https://rag.example.edu"},
			Backoff: func(int) time.Duration { return 20 * time.Millisecond },
		})
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := w.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = w.StopAndCancel(ctx)
	})
	return env
}

func (env *deliveryEnv) emit(t *testing.T, ev notify.Event) {
	t.Helper()
	if err := pgx.BeginFunc(context.Background(), env.pool, func(tx pgx.Tx) error {
		return env.svc.Emit(context.Background(), tx, ev)
	}); err != nil {
		t.Fatal(err)
	}
}

func (env *deliveryEnv) delivery(t *testing.T, to string) (status string, attempts int, lastError string) {
	t.Helper()
	err := env.pool.QueryRow(context.Background(),
		`SELECT status, attempts, last_error FROM notification_emails WHERE to_address = $1`, to).Scan(&status, &attempts, &lastError)
	if err != nil {
		t.Fatalf("delivery to %s: %v", to, err)
	}
	return status, attempts, lastError
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestEmailDeliveryRetriesAndGivesUp(t *testing.T) {
	env := newDeliveryEnv(t)
	expires := time.Now().Add(30 * 24 * time.Hour)

	// Two temporary failures, then delivered on the third attempt.
	env.sink.FailNext(2)
	env.emit(t, notify.InvitedEvent(env.team, "new@example.edu", "editor", expires))
	msgs := env.sink.Wait(t, 1, 30*time.Second)
	if p := msgs[0].Parse(t); p.Header.Get("Subject") != "[Campus RAG] You're invited to join Registrar" || !strings.Contains(p.Text, "https://rag.example.edu/settings/notifications") {
		t.Fatalf("email = %+v", p)
	}
	waitFor(t, "sent", func() bool { s, _, _ := env.delivery(t, "new@example.edu"); return s == "sent" })
	if _, n, _ := env.delivery(t, "new@example.edu"); n != 3 {
		t.Errorf("attempts = %d, want 3", n)
	}

	// A relay that keeps refusing: given up after EmailMaxAttempts.
	env.sink.FailNext(1000)
	env.emit(t, notify.InvitedEvent(env.team, "never@example.edu", "member", expires))
	waitFor(t, "failed", func() bool { s, _, _ := env.delivery(t, "never@example.edu"); return s == "failed" })
	if _, n, last := env.delivery(t, "never@example.edu"); n != notify.EmailMaxAttempts || !strings.Contains(last, "451") {
		t.Errorf("gave up after %d attempts: %q", n, last)
	}
}

func TestEmitIsTransactionalAndDeduped(t *testing.T) {
	env := newDeliveryEnv(t)
	ctx := context.Background()
	count := func(sql string) int {
		var n int
		if err := env.pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	// Rolled back with the change: nothing recorded, nothing sent.
	errRollback := errors.New("rollback")
	err := pgx.BeginFunc(ctx, env.pool, func(tx pgx.Tx) error {
		if err := env.svc.Emit(ctx, tx, notify.InvitedEvent(env.team, "gone@example.edu", "member", time.Now())); err != nil {
			return err
		}
		return errRollback
	})
	if !errors.Is(err, errRollback) || count(`SELECT count(*) FROM notification_events`) != 0 || count(`SELECT count(*) FROM river_job WHERE kind = 'notify.email'`) != 0 {
		t.Fatalf("rolled-back event left rows (err %v)", err)
	}
	// The same dedupe key twice: one event.
	inv := uuid.New()
	for range 2 {
		env.emit(t, notify.InviteExpiringEvent(env.team, inv, "soon@example.edu", "member", time.Now().Add(48*time.Hour)))
	}
	if n := count(`SELECT count(*) FROM notifications WHERE type = 'team.invite_expiring'`); n != 1 {
		t.Errorf("deduped items = %d", n)
	}
	// Unknown types are a programming error.
	if err := pgx.BeginFunc(ctx, env.pool, func(tx pgx.Tx) error {
		return env.svc.Emit(ctx, tx, notify.Event{Type: "nope", Title: "x"})
	}); err == nil {
		t.Error("unknown type accepted")
	}
	// A nil service records nothing.
	var none *notify.Service
	if err := none.Emit(ctx, nil, notify.Event{Type: notify.SyncFailed}); err != nil {
		t.Error(err)
	}
}
