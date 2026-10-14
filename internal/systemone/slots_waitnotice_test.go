package systemone

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
)

// counting is a wait notice that counts what it is told.
func counting() (gateway.WaitNotice, *atomic.Int32, *atomic.Int32) {
	var started, ended atomic.Int32
	return func(time.Duration) func() {
		started.Add(1)
		return func() { ended.Add(1) }
	}, &started, &ended
}

// An interactive request queued for a busy connection's slot tells the wait notice (G22: "Working on it…") once the
// wait has lasted a while, and ends it when the slot arrives. A short queue says nothing.
func TestQueuedForASlotTellsTheWaitNotice(t *testing.T) {
	s := newSlots(1)
	hold := mustAcquire(t, s, Interactive)
	notice, started, ended := counting()
	ctx := gateway.WithWaitNotice(context.Background(), notice)

	got := make(chan error, 1)
	go func() {
		release, err := s.acquire(ctx, Interactive)
		if err == nil {
			release()
		}
		got <- err
	}()
	waitQueued(t, s, 1, 0)
	time.Sleep(1300 * time.Millisecond) // past the point a wait is worth telling
	if started.Load() != 1 || ended.Load() != 0 {
		t.Fatalf("while queued: announced %d, ended %d, want 1 and 0", started.Load(), ended.Load())
	}
	hold()
	if err := <-got; err != nil {
		t.Fatal(err)
	}
	if started.Load() != 1 || ended.Load() != 1 {
		t.Errorf("after the slot arrived: announced %d, ended %d, want 1 and 1", started.Load(), ended.Load())
	}
}

func TestAShortQueueForASlotSaysNothing(t *testing.T) {
	s := newSlots(1)
	hold := mustAcquire(t, s, Interactive)
	notice, started, ended := counting()
	ctx := gateway.WithWaitNotice(context.Background(), notice)

	got := make(chan error, 1)
	go func() {
		release, err := s.acquire(ctx, Interactive)
		if err == nil {
			release()
		}
		got <- err
	}()
	waitQueued(t, s, 1, 0)
	time.Sleep(50 * time.Millisecond)
	hold()
	if err := <-got; err != nil {
		t.Fatal(err)
	}
	time.Sleep(1200 * time.Millisecond) // a timer that was not stopped would fire now
	if started.Load() != 0 || ended.Load() != 0 {
		t.Errorf("a short queue announced %d, ended %d", started.Load(), ended.Load())
	}
}

func TestACancelledWaiterEndsItsNotice(t *testing.T) {
	s := newSlots(1)
	hold := mustAcquire(t, s, Interactive)
	defer hold()
	notice, started, ended := counting()
	ctx, cancel := context.WithCancel(gateway.WithWaitNotice(context.Background(), notice))

	got := make(chan error, 1)
	go func() { _, err := s.acquire(ctx, Interactive); got <- err }()
	waitQueued(t, s, 1, 0)
	time.Sleep(1300 * time.Millisecond)
	cancel()
	if err := <-got; err == nil {
		t.Fatal("a cancelled waiter got a slot")
	}
	if started.Load() != 1 || ended.Load() != 1 {
		t.Errorf("announced %d, ended %d, want 1 and 1", started.Load(), ended.Load())
	}
}

func TestAFreeSlotNeverTouchesTheNotice(t *testing.T) {
	s := newSlots(2)
	notice, started, _ := counting()
	release, err := s.acquire(gateway.WithWaitNotice(context.Background(), notice), Interactive)
	if err != nil {
		t.Fatal(err)
	}
	release()
	time.Sleep(1200 * time.Millisecond)
	if started.Load() != 0 {
		t.Errorf("announced %d waits for a free slot", started.Load())
	}
}
