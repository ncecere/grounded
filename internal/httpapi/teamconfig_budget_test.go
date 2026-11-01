package httpapi_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type exportQueryTrace struct {
	mu                sync.Mutex
	budgets, payloads int
}

func (tr *exportQueryTrace) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	if strings.Contains(data.SQL, "-- name: ExportConfigurationBudget ") {
		tr.budgets++
	}
	for _, name := range []string{"Sources", "KBs", "Agents", "Versions", "Cases", "EvalSets", "Links", "Model"} {
		if strings.Contains(data.SQL, "-- name: ExportConfiguration"+name+" ") {
			tr.payloads++
		}
	}
	return ctx
}
func (*exportQueryTrace) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestConfigurationExportPreflightsBytesAndCounts(t *testing.T) {
	app := newTestApp(t, nil)
	owner := app.signIn("user")
	createTeam(t, app.signIn("admin"), "budget-export", "user@localhost")
	ctx := context.Background()
	trace := &exportQueryTrace{}
	cfg := app.Pool.Config()
	cfg.ConnConfig.Tracer = trace
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	tracedApp := newTestAppOn(t, pool, nil, false)
	tracedOwner := tracedApp.signIn("user")
	_ = owner
	for i, fixture := range []struct{ count, size int }{{60, 20000}, {501, 0}} {
		if _, err = pool.Exec(ctx, `INSERT INTO agents(team_id,name,slug,draft)
   SELECT t.id,'Budget '||g,'budget-'||g,jsonb_build_object('instructions',repeat('x',$1::int))
   FROM teams t CROSS JOIN generate_series(1,$2::int) g WHERE t.slug='budget-export'`, fixture.size, fixture.count); err != nil {
			t.Fatal(err)
		}
		code, raw := tracedOwner.raw("GET", "/v1/teams/budget-export/configuration", nil, nil)
		if code != 409 || errorCode(raw) != "configuration_unsupported" {
			t.Fatalf("budget refusal: %d", code)
		}
		trace.mu.Lock()
		budgets, payloads := trace.budgets, trace.payloads
		trace.mu.Unlock()
		if budgets != i+1 || payloads != 0 {
			t.Fatalf("budget gate read payloads: budgets=%d payloads=%d", budgets, payloads)
		}
		if _, err = pool.Exec(ctx, "DELETE FROM agents"); err != nil {
			t.Fatal(err)
		}
	}
}
