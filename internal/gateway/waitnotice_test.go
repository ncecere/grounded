package gateway

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// notice records what a request's wait notice was told.
type notice struct {
	mu     sync.Mutex
	starts []time.Duration
	dones  int
}

func (n *notice) fn(d time.Duration) func() {
	n.mu.Lock()
	n.starts = append(n.starts, d)
	n.mu.Unlock()
	return func() {
		n.mu.Lock()
		n.dones++
		n.mu.Unlock()
	}
}

func (n *notice) counts() (int, int) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return len(n.starts), n.dones
}

func fastThreshold(t *testing.T) {
	t.Helper()
	old := waitNoticeAfter
	waitNoticeAfter = 30 * time.Millisecond
	t.Cleanup(func() { waitNoticeAfter = old })
}

func TestBeginWaitWithoutANoticeIsHarmless(t *testing.T) {
	end := BeginWait(context.Background(), 5*time.Second)
	if end == nil {
		t.Fatal("end must never be nil")
	}
	end()
	end()
}

func TestBeginWaitSaysNothingForAShortKnownWait(t *testing.T) {
	var n notice
	ctx := WithWaitNotice(context.Background(), n.fn)
	BeginWait(ctx, waitNoticeAfter-time.Millisecond)()
	if starts, dones := n.counts(); starts != 0 || dones != 0 {
		t.Errorf("a wait shorter than the threshold announced %d, ended %d", starts, dones)
	}
}

func TestBeginWaitAnnouncesALongKnownWaitAtOnceAndEndsItOnce(t *testing.T) {
	var n notice
	ctx := WithWaitNotice(context.Background(), n.fn)
	end := BeginWait(ctx, 4*time.Second)
	if starts, dones := n.counts(); starts != 1 || dones != 0 {
		t.Fatalf("after Begin: announced %d, ended %d, want 1 and 0", starts, dones)
	}
	if n.starts[0] != 4*time.Second {
		t.Errorf("announced %v, want the expected wait", n.starts[0])
	}
	end()
	end() // calling it twice must not end the wait twice
	if starts, dones := n.counts(); starts != 1 || dones != 1 {
		t.Errorf("after End: announced %d, ended %d, want 1 and 1", starts, dones)
	}
}

func TestBeginWaitOfUnknownLengthStaysQuietWhenItEndsSoon(t *testing.T) {
	fastThreshold(t)
	var n notice
	ctx := WithWaitNotice(context.Background(), n.fn)
	end := BeginWait(ctx, 0)
	end()
	time.Sleep(3 * waitNoticeAfter) // the timer must be gone: nothing is announced late
	if starts, dones := n.counts(); starts != 0 || dones != 0 {
		t.Errorf("announced %d, ended %d, want none", starts, dones)
	}
}

func TestBeginWaitOfUnknownLengthAnnouncesOnceItLastsAndEndsAfterIt(t *testing.T) {
	fastThreshold(t)
	var n notice
	ctx := WithWaitNotice(context.Background(), n.fn)
	end := BeginWait(ctx, 0)
	deadline := time.Now().Add(2 * time.Second)
	for {
		if starts, _ := n.counts(); starts == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("a wait past the threshold was never announced")
		}
		time.Sleep(time.Millisecond)
	}
	end()
	if starts, dones := n.counts(); starts != 1 || dones != 1 {
		t.Errorf("announced %d, ended %d, want 1 and 1", starts, dones)
	}
}

func TestBeginWaitAnnouncementsAndEndsAlwaysBalance(t *testing.T) {
	// the end races the timer: whichever wins, every announced wait is ended and none is ended without being announced
	fastThreshold(t)
	var n notice
	ctx := WithWaitNotice(context.Background(), n.fn)
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			end := BeginWait(ctx, 0)
			time.Sleep(waitNoticeAfter - 2*time.Millisecond + time.Duration(i%5)*time.Millisecond) // straddle the threshold
			end()
		}(i)
	}
	wg.Wait()
	time.Sleep(3 * waitNoticeAfter)
	if starts, dones := n.counts(); starts != dones {
		t.Errorf("announced %d waits but ended %d", starts, dones)
	}
}

func TestANoticeThatReturnsNoDoneIsFine(t *testing.T) {
	var called atomic.Int32
	ctx := WithWaitNotice(context.Background(), func(time.Duration) func() { called.Add(1); return nil })
	BeginWait(ctx, 3*time.Second)()
	if called.Load() != 1 {
		t.Errorf("called = %d", called.Load())
	}
}

func TestAnInnerNoticeReplacesTheOuterOne(t *testing.T) {
	var outer, inner notice
	ctx := WithWaitNotice(WithWaitNotice(context.Background(), outer.fn), inner.fn)
	BeginWait(ctx, 3*time.Second)()
	if s, _ := inner.counts(); s != 1 {
		t.Errorf("inner announced %d", s)
	}
	if s, _ := outer.counts(); s != 0 {
		t.Errorf("outer announced %d, want 0", s)
	}
}

func TestANilNoticeLeavesTheContextAlone(t *testing.T) {
	var n notice
	ctx := WithWaitNotice(context.Background(), n.fn)
	if got := WithWaitNotice(ctx, nil); got != ctx {
		t.Error("a nil notice must not replace the existing one")
	}
}
