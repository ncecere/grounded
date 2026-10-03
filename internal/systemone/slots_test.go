package systemone

import (
	"context"
	"errors"
	"math/rand/v2"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/observability"
)

// state returns the semaphore's counts (under its lock).
func (s *slots) state() (held, bgHeld, interactive, background int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.held, s.bgHeld, s.waiting[Interactive].Len(), s.waiting[Background].Len()
}

// waitQueued waits until the semaphore has the given waiters.
func waitQueued(t *testing.T, s *slots, interactive, background int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		_, _, i, b := s.state()
		if i == interactive && b == background {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("waiters = %d interactive, %d background; want %d, %d", i, b, interactive, background)
		}
		time.Sleep(time.Millisecond)
	}
}

func mustAcquire(t *testing.T, s *slots, p Priority) func() {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	release, err := s.acquire(ctx, p)
	if err != nil {
		t.Fatalf("acquire %v: %v", p, err)
	}
	return release
}

// blocked reports whether an acquire of p would wait (it gives up at once).
func blocked(s *slots, p Priority) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	release, err := s.acquire(ctx, p)
	if err == nil {
		release()
		return false
	}
	return errors.Is(err, context.DeadlineExceeded)
}

func TestPriorityFromContext(t *testing.T) {
	ctx := context.Background()
	if PriorityFrom(ctx) != Interactive || PriorityFrom(WithPriority(ctx, Background)) != Background {
		t.Error("priority not carried")
	}
	if PriorityFrom(WithPriority(WithPriority(ctx, Background), Interactive)) != Interactive {
		t.Error("inner priority should win")
	}
	if Interactive.String() != "interactive" || Background.String() != "background" {
		t.Error("labels")
	}
}

func TestBackgroundShareIsHalfTheLimit(t *testing.T) {
	for _, c := range []struct{ size, bg int }{{1, 1}, {2, 1}, {3, 1}, {8, 4}, {64, 32}, {256, 128}} {
		s := newSlots(c.size)
		var held []func()
		for range c.bg {
			held = append(held, mustAcquire(t, s, Background))
		}
		if !blocked(s, Background) {
			t.Errorf("limit %d: background got more than %d slots", c.size, c.bg)
		}
		// Interactive calls still get every other slot without waiting.
		for range c.size - c.bg {
			held = append(held, mustAcquire(t, s, Interactive))
		}
		if !blocked(s, Interactive) {
			t.Errorf("limit %d: more than %d slots", c.size, c.size)
		}
		for _, r := range held {
			r()
		}
		if h, b, i, w := s.state(); h != 0 || b != 0 || i != 0 || w != 0 {
			t.Errorf("limit %d: leaked state %d %d %d %d", c.size, h, b, i, w)
		}
	}
}

func TestFreedSlotGoesToInteractiveFirst(t *testing.T) {
	s := newSlots(2)
	a, b := mustAcquire(t, s, Interactive), mustAcquire(t, s, Interactive)
	order := make(chan Priority, 3)
	var wg sync.WaitGroup
	enqueue := func(p Priority) {
		wg.Go(func() {
			r := mustAcquire(t, s, p)
			order <- p
			time.Sleep(5 * time.Millisecond)
			r()
		})
	}
	enqueue(Background) // first in line, but background
	waitQueued(t, s, 0, 1)
	enqueue(Interactive)
	waitQueued(t, s, 1, 1)
	enqueue(Interactive)
	waitQueued(t, s, 2, 1)
	a()
	if p := <-order; p != Interactive {
		t.Fatalf("first freed slot went to %v", p)
	}
	b()
	if p := <-order; p != Interactive {
		t.Fatalf("second freed slot went to %v", p)
	}
	if p := <-order; p != Background {
		t.Fatalf("third = %v", p)
	}
	wg.Wait()
}

func TestLimitOfOneServesBackgroundWhenNothingInteractiveWaits(t *testing.T) {
	s := newSlots(1)
	r := mustAcquire(t, s, Background)
	if !blocked(s, Background) || !blocked(s, Interactive) {
		t.Fatal("the only slot is held")
	}
	r()
	mustAcquire(t, s, Background)()
	mustAcquire(t, s, Interactive)()
}

func TestBackgroundWaitsBehindItsCapNotBehindInteractive(t *testing.T) {
	s := newSlots(4)
	bg1, bg2 := mustAcquire(t, s, Background), mustAcquire(t, s, Background)
	got, released := make(chan struct{}), make(chan struct{})
	go func() { r := mustAcquire(t, s, Background); close(got); r(); close(released) }()
	waitQueued(t, s, 0, 1)
	// Two slots are free: interactive calls take them past the queued background call.
	i1, i2 := mustAcquire(t, s, Interactive), mustAcquire(t, s, Interactive)
	i1() // frees a slot, but background is at its cap of 2
	select {
	case <-got:
		t.Fatal("background went over its cap")
	case <-time.After(20 * time.Millisecond):
	}
	bg1()
	<-got
	i2()
	bg2()
	<-released // the queued call's own release, after it signalled
	if h, b, i, w := s.state(); h != 0 || b != 0 || i != 0 || w != 0 {
		t.Errorf("leaked state %d %d %d %d", h, b, i, w)
	}
}

func TestCancelledWaitersLeaveNoTrace(t *testing.T) {
	s := newSlots(1)
	r := mustAcquire(t, s, Interactive)
	ctx, cancel := context.WithCancel(context.Background())
	errs := make(chan error, 4)
	for _, p := range []Priority{Interactive, Background, Interactive, Background} {
		go func() { _, err := s.acquire(ctx, p); errs <- err }()
	}
	waitQueued(t, s, 2, 2)
	cancel()
	for range 4 {
		if err := <-errs; !errors.Is(err, context.Canceled) {
			t.Errorf("cancelled waiter = %v", err)
		}
	}
	if h, _, i, b := s.state(); h != 1 || i != 0 || b != 0 {
		t.Errorf("after cancel: held %d, waiters %d %d", h, i, b)
	}
	r()
	mustAcquire(t, s, Background)()
	// An already cancelled context doesn't queue.
	r = mustAcquire(t, s, Interactive)
	if _, err := s.acquire(ctx, Interactive); !errors.Is(err, context.Canceled) {
		t.Errorf("done context = %v", err)
	}
	r()
}

// TestSlotsUnderContention hammers a semaphore with both priorities and
// random cancellations (run with -race): the limit and the background cap
// always hold, and every slot comes back.
func TestSlotsUnderContention(t *testing.T) {
	for _, size := range []int{1, 3, 16} {
		s := newSlots(size)
		var cur, curBg, peak, peakBg, served atomic.Int32
		record := func(v, p *atomic.Int32) {
			n := v.Add(1)
			for m := p.Load(); n > m && !p.CompareAndSwap(m, n); m = p.Load() {
			}
		}
		var wg sync.WaitGroup
		for i := range 400 {
			wg.Go(func() {
				p := Priority(i % 2)
				ctx, cancel := context.WithTimeout(context.Background(), time.Duration(rand.IntN(3000))*time.Microsecond)
				defer cancel()
				r, err := s.acquire(ctx, p)
				if err != nil {
					return
				}
				served.Add(1)
				record(&cur, &peak)
				if p == Background {
					record(&curBg, &peakBg)
				}
				time.Sleep(time.Duration(rand.IntN(200)) * time.Microsecond)
				if p == Background {
					curBg.Add(-1)
				}
				cur.Add(-1)
				r()
			})
		}
		wg.Wait()
		if peak.Load() > int32(size) || peakBg.Load() > int32(max(1, size/2)) {
			t.Errorf("limit %d: peak %d, background peak %d", size, peak.Load(), peakBg.Load())
		}
		if served.Load() == 0 {
			t.Errorf("limit %d: nothing served", size)
		}
		if h, b, i, w := s.state(); h != 0 || b != 0 || i != 0 || w != 0 {
			t.Errorf("limit %d: leaked state %d %d %d %d", size, h, b, i, w)
		}
		for range size {
			mustAcquire(t, s, Interactive) // every slot is free again
		}
	}
}

func TestResizedLimitReplacesTheSlots(t *testing.T) {
	conn := uuid.New()
	old := slotsFor(conn, 2)
	r := mustAcquire(t, old, Background)
	if slotsFor(conn, 2) != old {
		t.Error("same size should keep the slots")
	}
	if slotsFor(conn, 0) == old || slotsFor(conn, 0).size != DefaultMaxConcurrent {
		t.Error("default size")
	}
	bigger := slotsFor(conn, 64)
	if bigger == old || bigger.bgMax != 32 {
		t.Errorf("resized = %+v", bigger)
	}
	r() // released to the old cap
	if h, _, _, _ := old.state(); h != 0 {
		t.Errorf("old held = %d", h)
	}
}

func TestAskMeasuresTheWaitByPriority(t *testing.T) {
	srv := server(t, func(w http.ResponseWriter, body map[string]any) { answerAll(w, body) })
	cl := NewClient(gateway.New(srv.URL, "k", time.Second), "m", uuid.New(), uuid.New(), 1)
	q := map[string]Question{"a": Noul("?", "", "")}
	if _, err := cl.Ask(WithPriority(context.Background(), Background), Call{Feature: "gaps"}, "x", q); err != nil {
		t.Fatal(err)
	}
	hold := mustAcquire(t, cl.slots, Interactive)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, err := cl.Ask(ctx, Call{Feature: "scope"}, "x", q); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("full = %v", err)
	}
	hold()
	if c := waitCount(t, "gaps", "background"); c < 1 {
		t.Errorf("background waits = %d", c)
	}
	if c := waitCount(t, "scope", "interactive"); c < 1 {
		t.Errorf("interactive waits = %d", c)
	}
}

// waitCount is how many waits the wait histogram recorded for feature and
// priority.
func waitCount(t *testing.T, feature, priority string) uint64 {
	t.Helper()
	reg := prometheus.NewRegistry()
	reg.MustRegister(observability.SystemOneWait)
	mfs, err := reg.Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, mf := range mfs {
		for _, m := range mf.GetMetric() {
			labels := map[string]string{}
			for _, l := range m.GetLabel() {
				labels[l.GetName()] = l.GetValue()
			}
			if labels["feature"] == feature && labels["priority"] == priority {
				return m.GetHistogram().GetSampleCount()
			}
		}
	}
	return 0
}

// BenchmarkSlotsFastPath is the cost of a slot below the limit: one
// uncontended lock to take it and one to give it back.
func BenchmarkSlotsFastPath(b *testing.B) {
	s := newSlots(256)
	ctx := context.Background()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			r, _ := s.acquire(ctx, Interactive)
			r()
		}
	})
}
