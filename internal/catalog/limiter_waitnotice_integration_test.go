package catalog

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/testutil"
)

// A request that queues for a connection's next requests-per-minute slot tells its wait notice (the chat's "Working on
// it…" status, G22) for as long as it sleeps, and says nothing when it does not wait or when it is background work.
func TestConnLimiterTellsTheWaitNotice(t *testing.T) {
	pacer := &ratelimit.Pacer{KV: testutil.NewKV(t)}
	l := &connLimiter{pacer: pacer, key: "conn:notice", rpm: 30} // one request per 2 s

	var started, ended atomic.Int32
	var expected atomic.Int64
	ctx := gateway.WithWaitNotice(context.Background(), func(d time.Duration) func() {
		started.Add(1)
		expected.Store(int64(d))
		return func() { ended.Add(1) }
	})

	// the first request takes the free slot at once: nothing to say
	if err := l.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if started.Load() != 0 {
		t.Fatalf("a request that did not wait announced a wait (%d)", started.Load())
	}

	// the second queues for the next slot, about 2 s away
	begin := time.Now()
	if err := l.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if started.Load() != 1 || ended.Load() != 1 {
		t.Fatalf("a queued request announced %d and ended %d waits, want 1 and 1", started.Load(), ended.Load())
	}
	if d := time.Duration(expected.Load()); d < time.Second || d > 3*time.Second {
		t.Errorf("expected wait = %v, want about 2s", d)
	}
	if el := time.Since(begin); el < time.Second {
		t.Errorf("the request did not wait: %v", el)
	}

	// background work does not reserve ahead and has no reader to tell
	started.Store(0)
	if err := l.Wait(gateway.Background(ctx)); err != nil {
		t.Fatal(err)
	}
	if started.Load() != 0 {
		t.Errorf("background work announced %d waits", started.Load())
	}
}

// A request that leaves while queued (the reader stopped, or the deadline came) ends the wait it announced.
func TestConnLimiterEndsTheWaitWhenTheRequestLeaves(t *testing.T) {
	pacer := &ratelimit.Pacer{KV: testutil.NewKV(t)}
	l := &connLimiter{pacer: pacer, key: "conn:notice-cancel", rpm: 6} // one request per 10 s

	var started, ended atomic.Int32
	base := gateway.WithWaitNotice(context.Background(), func(time.Duration) func() {
		started.Add(1)
		return func() { ended.Add(1) }
	})
	if err := l.Wait(base); err != nil { // takes the free slot
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(base)
	time.AfterFunc(300*time.Millisecond, cancel)
	if err := l.Wait(ctx); err == nil {
		t.Fatal("a request cancelled while queued got through")
	}
	if started.Load() != 1 || ended.Load() != 1 {
		t.Errorf("announced %d and ended %d waits, want 1 and 1", started.Load(), ended.Load())
	}
}
