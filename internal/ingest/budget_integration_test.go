package ingest_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/testutil"
)

type blockedBudget struct {
	blocked bool
	resets  time.Time
}

func (b *blockedBudget) Blocked(context.Context, uuid.UUID) (bool, time.Time, error) {
	return b.blocked, b.resets, nil
}

// A document dispatched before its team's budget ran out waits before any paid work (docs/specs/agent-budgets/DESIGN.md
// §3), at most 10 minutes or until the month resets, and a budget change wakes it.
func TestQueuedDocumentWaitsForTheBudget(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	conn, model, prof, team, src, doc := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, conn)
	exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions) VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, model, conn)
	exec(`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap) VALUES ($1, 'p', 'P', $2, 4, 'halfvec', 512, 0)`, prof, model)
	exec(`INSERT INTO teams (id, slug, name, max_classification) VALUES ($1, 't', 't', 'open')`, team)
	exec(`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, 's', 'upload', 'open', $3)`, src, team, prof)
	exec(`INSERT INTO documents (id, source_id, team_id, external_id, status) VALUES ($1, $2, $3, 'd', 'queued')`, doc, src, team)

	budget := &blockedBudget{blocked: true, resets: time.Now().Add(time.Hour)}
	w := &ingest.ProcessWorker{P: &ingest.Processor{Pool: pool, Log: testutil.Logger(), Budget: budget}}
	job := &river.Job[ingest.ProcessArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 3}, Args: ingest.ProcessArgs{DocumentID: doc}}
	if err := w.Work(ctx, job); err != nil {
		t.Fatal(err)
	}
	var status, code string
	var until *time.Time
	if err := pool.QueryRow(ctx, `SELECT status, error_code, waiting_until FROM documents WHERE id = $1`, doc).Scan(&status, &code, &until); err != nil {
		t.Fatal(err)
	}
	if status != "pending" || code != ingest.WaitMonthlyBudget || until == nil || time.Until(*until) > 11*time.Minute || time.Until(*until) < 9*time.Minute {
		t.Fatalf("document = %s %s %v", status, code, until)
	}

	// The month ends sooner than the recheck: it waits until then.
	exec(`UPDATE documents SET status = 'queued', error_code = '', waiting_until = NULL WHERE id = $1`, doc)
	budget.resets = time.Now().Add(2 * time.Minute)
	if err := w.Work(ctx, job); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT waiting_until FROM documents WHERE id = $1`, doc).Scan(&until); err != nil || until == nil || time.Until(*until) > 3*time.Minute {
		t.Fatalf("waiting until %v %v", until, err)
	}

	// A budget change wakes it.
	n, err := ingest.WakeBudgetWaiting(ctx, pool, nil, uuid.NullUUID{UUID: team, Valid: true})
	if err != nil || n != 1 {
		t.Fatalf("woke %d %v", n, err)
	}
	if err := pool.QueryRow(ctx, `SELECT status, error_code FROM documents WHERE id = $1`, doc).Scan(&status, &code); err != nil || status != "pending" || code != "" {
		t.Fatalf("after waking: %s %q %v", status, code, err)
	}
}
