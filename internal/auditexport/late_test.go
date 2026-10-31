package auditexport

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/testutil"
)

// A transaction obtains a low sequence ID before the snapshot, then commits
// while page two is blocked. Neither a high watermark nor day adjacency covers it.
func TestPGLateCommitDuringPagesEventuallyExported(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	late, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer late.Rollback(ctx)
	var lateID int64
	err = late.QueryRow(ctx, "INSERT INTO audit_log (occurred_at,actor_kind,action,target_type) VALUES ($1,'system','late.commit','team') RETURNING id", day).Scan(&lateID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, "INSERT INTO audit_log (occurred_at,actor_kind,action,target_type) SELECT $1,'system','team.update','team' FROM generate_series(1,600)", day)
	if err != nil {
		t.Fatal(err)
	}
	gate, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Release()
	if _, err = gate.Exec(ctx, "SELECT pg_advisory_lock(390021)"); err != nil {
		t.Fatal(err)
	}
	defer gate.Exec(context.Background(), "SELECT pg_advisory_unlock(390021)")
	_, err = pool.Exec(ctx, `CREATE FUNCTION export_page_gate() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF (SELECT count(*) FROM audit_export_facts) = 256 THEN
 PERFORM pg_advisory_xact_lock(390021);
 END IF;
 RETURN NEW;
 END $$;
 CREATE TRIGGER export_page_gate BEFORE INSERT ON audit_export_facts FOR EACH ROW EXECUTE FUNCTION export_page_gate()`)
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		id  uuid.UUID
		err error
	}
	done := make(chan result, 1)
	go func() {
		id, err := Freeze(ctx, pool, day, audit.Entry{ActorKind: audit.ActorSystem})
		done <- result{id, err}
	}()
	for {
		var blocked bool
		err = pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=390021 AND NOT granted)").Scan(&blocked)
		if err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		select {
		case r := <-done:
			t.Fatalf("freeze ended before gate: %v", r.err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err = late.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = gate.Exec(ctx, "SELECT pg_advisory_unlock(390021)"); err != nil {
		t.Fatal(err)
	}
	r := <-done
	if r.err != nil {
		t.Fatal(r.err)
	}
	fs, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer fs.Close()
	first, err := Publish(ctx, pool, fs, r.id, fixtureKey(1))
	if err != nil {
		t.Fatal(err)
	}
	if first.Manifest.Count != 600 {
		t.Fatalf("first count: %d", first.Manifest.Count)
	}
	next, err := Freeze(ctx, pool, day.AddDate(0, 0, 1), audit.Entry{ActorKind: audit.ActorSystem})
	if err != nil {
		t.Fatal(err)
	}
	second, err := Publish(ctx, pool, fs, next, fixtureKey(2))
	if err != nil {
		t.Fatal(err)
	}
	var appearances int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM audit_export_facts WHERE source_id=$1", lateID).Scan(&appearances); err != nil {
		t.Fatal(err)
	}
	if appearances != 1 || second.Manifest.Count != 1 {
		t.Fatalf("late fact permanently omitted or duplicated: appearances=%d count=%d", appearances, second.Manifest.Count)
	}
	_, payload, err := Open(ctx, pool, fs, next)
	if err != nil {
		t.Fatal(err)
	}
	defer payload.Close()
	if err = Verify(second, payload, trust(fixtureKey(2))); err != nil {
		t.Fatal(err)
	}
	third, err := Freeze(ctx, pool, day.AddDate(0, 0, 2), audit.Entry{ActorKind: audit.ActorSystem})
	if err != nil {
		t.Fatal(err)
	}
	empty, err := Publish(ctx, pool, fs, third, fixtureKey(2))
	if err != nil {
		t.Fatal(err)
	}
	if empty.Manifest.Count != 0 || Verify(empty, strings.NewReader(""), trust(fixtureKey(2))) != nil || VerifyLink(second, empty) != nil {
		t.Fatal("empty carry-forward day")
	}
}
