package parallel

import (
	"errors"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

// The error returned is the one a serial run would have met first, even when a later step fails sooner.
func TestInOrderReturnsTheFirstErrorInStepOrder(t *testing.T) {
	first, second := errors.New("first"), errors.New("second")
	for range 20 {
		err := InOrder(
			func() error { time.Sleep(5 * time.Millisecond); return first },
			func() error { return second },
		)
		if !errors.Is(err, first) {
			t.Fatalf("InOrder = %v, want the first step's error", err)
		}
	}
	if err := InOrder(func() error { return nil }, func() error { return second }); !errors.Is(err, second) {
		t.Fatalf("InOrder = %v, want the failing step's", err)
	}
	if err := InOrder(); err != nil {
		t.Fatal(err)
	}
}

// Every step runs to its end, failing siblings or not, and none is still running when InOrder returns.
func TestInOrderWaitsForEveryStep(t *testing.T) {
	before := runtime.NumGoroutine()
	var done atomic.Int32
	err := InOrder(
		func() error { return errors.New("fails at once") },
		func() error { time.Sleep(20 * time.Millisecond); done.Add(1); return nil },
		func() error { time.Sleep(10 * time.Millisecond); done.Add(1); return nil },
	)
	if err == nil || done.Load() != 2 {
		t.Fatalf("err %v, %d of 2 slow steps finished", err, done.Load())
	}
	if after := runtime.NumGoroutine(); after > before {
		t.Fatalf("%d goroutines before, %d after: a step is still running", before, after)
	}
}

func TestInOrderRunsConcurrently(t *testing.T) {
	start := time.Now()
	step := func() error { time.Sleep(30 * time.Millisecond); return nil }
	if err := InOrder(step, step, step, step); err != nil {
		t.Fatal(err)
	}
	if d := time.Since(start); d > 90*time.Millisecond {
		t.Fatalf("four 30 ms steps took %v: not concurrent", d)
	}
}
