package limits_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/testutil"
)

// Per-minute query limits fail open when Valkey is unavailable
// (authenticated traffic, ADR-0015); daily limits still apply because they
// come from Postgres.
func TestQueryLimitsFailOpenWithoutValkey(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	team := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO teams (id, slug, name, max_classification) VALUES ($1, 't', 'T', 'open')`, team); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO team_limits (team_id, overrides) VALUES ($1, '{"queries_per_minute": 1, "queries_per_day": 3}')`, team); err != nil {
		t.Fatal(err)
	}
	down := &kv.Store{Client: redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1}), Prefix: "x:"}
	t.Cleanup(func() { _ = down.Close() })
	svc := limits.New(pool, teams.NewService(pool), down, limits.Options{})
	failures := 0
	svc.OnBackendError = func() { failures++ }
	actor := authz.Actor{UserID: uuid.New()}

	for i := 0; i < 3; i++ {
		if err := svc.CheckQuery(ctx, team, actor); err != nil {
			t.Fatalf("query %d with Valkey down: %v", i, err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO usage_events (kind, quantity, team_id) VALUES ('query', 1, $1)`, team); err != nil {
			t.Fatal(err)
		}
	}
	if failures < 3 {
		t.Errorf("backend errors reported = %d", failures)
	}
	err := svc.CheckQuery(ctx, team, actor)
	var le *limits.Error
	if !errors.As(err, &le) || le.Def.Key != limits.QueriesPerDay {
		t.Fatalf("daily limit with Valkey down = %v", err)
	}
	if e, _ := apperr.As(err); e.Status != 429 || e.RetryAfter <= 0 {
		t.Errorf("daily error = %+v", e)
	}
}
