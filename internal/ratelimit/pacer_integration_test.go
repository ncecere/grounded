package ratelimit_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestPacerSpacesReservations(t *testing.T) {
	p := &ratelimit.Pacer{KV: testutil.NewKV(t)}
	ctx := context.Background()
	const interval = 100 * time.Millisecond

	// Concurrent callers (standing in for several workers) each get a
	// distinct slot, one interval apart.
	var mu sync.Mutex
	var delays []time.Duration
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d, ok, err := p.Reserve(ctx, "conn", interval, time.Second)
			if err != nil || !ok {
				t.Errorf("reserve: %v %v", ok, err)
			}
			mu.Lock()
			delays = append(delays, d)
			mu.Unlock()
		}()
	}
	wg.Wait()
	var maxDelay time.Duration
	for _, d := range delays {
		maxDelay = max(maxDelay, d)
	}
	if maxDelay < 3*interval || maxDelay > 5*interval {
		t.Fatalf("5 reservations should span ~4 intervals, got delays %v", delays)
	}

	// maxWait 0 claims nothing while slots are taken, and reports the wait.
	d, ok, err := p.Reserve(ctx, "conn", interval, 0)
	if err != nil || ok || d < 3*interval {
		t.Fatalf("non-waiting reserve = %v %v %v", d, ok, err)
	}
	// Other keys are independent.
	if d, ok, _ := p.Reserve(ctx, "other", interval, 0); !ok || d != 0 {
		t.Fatalf("other key = %v %v", d, ok)
	}

	// Block pushes the next slot out (a 429 with Retry-After).
	if err := p.Block(ctx, "other", 2*time.Second); err != nil {
		t.Fatal(err)
	}
	if d, ok, _ := p.Reserve(ctx, "other", interval, time.Second); ok || d < 1500*time.Millisecond {
		t.Fatalf("after block = %v %v", d, ok)
	}
	// A shorter block never pulls the slot earlier.
	_ = p.Block(ctx, "other", time.Millisecond)
	if d, _, _ := p.Reserve(ctx, "other", interval, 0); d < 1500*time.Millisecond {
		t.Fatalf("short block shortened the pause: %v", d)
	}
}
