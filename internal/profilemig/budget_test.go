package profilemig

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

type gate struct {
	blocked bool
	resets  time.Time
}

func (g gate) Blocked(context.Context, uuid.UUID) (bool, time.Time, error) {
	return g.blocked, g.resets, nil
}

// A migration's re-embedding waits while its team's enforced budget is used up (docs/specs/agent-budgets/DESIGN.md §2);
// shared sources have no team budget.
func TestSetWaitsForTheBudget(t *testing.T) {
	team := dbgen.DataSource{TeamID: uuid.NullUUID{UUID: uuid.New(), Valid: true}}
	shared := dbgen.DataSource{}
	for _, c := range []struct {
		g    gate
		src  dbgen.DataSource
		want func(time.Duration) bool
	}{
		{gate{blocked: false}, team, func(d time.Duration) bool { return d == 0 }},
		{gate{blocked: true, resets: time.Now().Add(time.Hour)}, team, func(d time.Duration) bool { return d == budgetMaxWait }},
		{gate{blocked: true, resets: time.Now().Add(time.Minute)}, team, func(d time.Duration) bool { return d > 50*time.Second && d <= time.Minute }},
		{gate{blocked: true, resets: time.Now().Add(time.Hour)}, shared, func(d time.Duration) bool { return d == 0 }},
	} {
		w := &SetWorker{P: &ingest.Processor{Budget: c.g}}
		d, err := w.budgetWait(context.Background(), c.src)
		if err != nil || !c.want(d) {
			t.Errorf("%+v: wait %v %v", c.g, d, err)
		}
	}
	if d, err := (&SetWorker{}).budgetWait(context.Background(), team); d != 0 || err != nil {
		t.Errorf("no processor: %v %v", d, err)
	}
}
