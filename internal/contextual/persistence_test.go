package contextual

import (
	"context"
	"errors"
	"testing"
	"time"
)

type stalledPersistence struct{ Store }

func (p stalledPersistence) Settle(ctx context.Context, _ Settlement) error {
	if d, ok := ctx.Deadline(); !ok || d.After(time.Now().Add(time.Second)) {
		return errors.New("persistence deadline missing or ignored")
	}
	<-ctx.Done()
	return ctx.Err()
}

func TestPersistenceDeadlineStopsBlockedCacheAndUsage(t *testing.T) {
	e := newGen(t)
	e.g.Store = stalledPersistence{Store: e.store}
	// This is the timeout under test, not a fixture's wait deadline.
	e.g.PersistenceTimeout = 20 * time.Millisecond
	_, err := e.g.Contextualize(t.Context(), e.req(sections(1)))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v, want bounded persistence deadline", err)
	}
	if len(e.store.cache) != 0 || len(e.store.usage) != 0 || e.store.counted()[OutcomeStarted] != 1 {
		t.Fatal("timed-out persistence published cache/usage or lost its unknown attempt")
	}
}

func TestPersistenceGraceCannotExceedThirtySeconds(t *testing.T) {
	for _, configured := range []time.Duration{0, -time.Second, time.Hour} {
		g := Generator{PersistenceTimeout: configured}
		if g.persistenceTimeout() != 30*time.Second {
			t.Fatalf("configured %v: grace=%v, want 30s", configured, g.persistenceTimeout())
		}
	}
}

type persistenceProbe struct {
	Store
	fault                error
	puts, settlements    int
	bounded, uncancelled bool
}

func (p *persistenceProbe) PutCache(ctx context.Context, e CacheEntry) error {
	p.puts++
	return p.Store.PutCache(ctx, e)
}

func (p *persistenceProbe) Settle(ctx context.Context, st Settlement) error {
	p.settlements++
	_, p.bounded = ctx.Deadline()
	p.uncancelled = ctx.Err() == nil
	if p.fault != nil {
		return p.fault
	}
	return p.Store.Settle(ctx, st)
}

func TestFailedSettlementNeverPublishesGeneratedContext(t *testing.T) {
	e := newGen(t)
	fault := errors.New("settlement storage unavailable")
	probe := &persistenceProbe{Store: e.store, fault: fault}
	e.g.Store = probe
	_, err := e.g.Contextualize(t.Context(), e.req(sections(1)))
	if !errors.Is(err, fault) {
		t.Fatalf("got %v, want persistence failure", err)
	}
	if len(e.store.cache) != 0 {
		t.Error("generated context was cached although its settlement failed")
	}
	if len(e.store.usage) != 0 || e.store.counted()[OutcomeStarted] != 1 {
		t.Error("failed persistence must leave an unsettled attempt, not fictional usage")
	}
	if !probe.bounded || !probe.uncancelled {
		t.Error("settlement context must have a deadline and survive caller cancellation")
	}
}

func TestSuccessfulCachePublicationUsesOnlyBoundedSettlement(t *testing.T) {
	e := newGen(t)
	probe := &persistenceProbe{Store: e.store}
	e.g.Store = probe
	res, err := e.g.Contextualize(t.Context(), e.req(sections(1)))
	if err != nil || res.State != StateContext || len(e.store.cache) != 1 {
		t.Fatalf("successful generation: result=%+v err=%v cache=%d", res, err, len(e.store.cache))
	}
	if probe.puts != 0 {
		t.Errorf("cache publication made %d standalone writes before settlement", probe.puts)
	}
	if probe.settlements != 1 || !probe.bounded || !probe.uncancelled {
		t.Errorf("settlements=%d bounded=%v uncancelled=%v", probe.settlements, probe.bounded, probe.uncancelled)
	}
}

func TestStoppedReplyPersistsUsageWithBoundedGraceButNoCache(t *testing.T) {
	e := newGen(t)
	probe := &persistenceProbe{Store: e.store}
	e.g.Store = probe
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	req := e.req(sections(1))
	req.Checkpoint = func(context.Context) error {
		if len(e.proxy.ContextCalls()) > 0 {
			cancel()
			return &StopError{Reason: "test cancelled after reply", Err: context.Canceled}
		}
		return nil
	}
	_, err := e.g.Contextualize(ctx, req)
	var stopped *StopError
	if !errors.As(err, &stopped) {
		t.Fatalf("got %v, want stopped reply", err)
	}
	if probe.settlements != 1 || !probe.bounded || !probe.uncancelled || len(e.store.usage) != 1 || len(e.store.cache) != 0 {
		t.Fatalf("stopped persistence: settlements=%d bounded=%v uncancelled=%v usage=%d cache=%d", probe.settlements, probe.bounded, probe.uncancelled, len(e.store.usage), len(e.store.cache))
	}
}
