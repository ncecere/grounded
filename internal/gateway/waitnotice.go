package gateway

import (
	"context"
	"sync"
	"time"
)

// A chat request can wait, silently, for capacity: the connection's requests-per-minute pacer reserves a later slot, and
// SystemOne's concurrency slots queue (docs/systemone.md). A wait notice lets the caller that cares, the agent run, tell
// the reader ("Working on it…", G22) while it lasts. The waiters call BeginWait; they know nothing about agents.

// waitNoticeAfter is how long a wait lasts before it is worth telling anyone: shorter waits would only flicker.
var waitNoticeAfter = time.Second

// WaitNotice is told a wait began (expected is its length, 0 when unknown) and returns what to call when it is over (nil
// is fine). It may be called from any goroutine.
type WaitNotice func(expected time.Duration) (done func())

type waitNoticeKey struct{}

// WithWaitNotice returns a context whose waits (BeginWait) are reported to n. An inner notice replaces an outer one; a
// nil notice changes nothing.
func WithWaitNotice(ctx context.Context, n WaitNotice) context.Context {
	if n == nil {
		return ctx
	}
	return context.WithValue(ctx, waitNoticeKey{}, n)
}

// BeginWait is called by something about to block on a busy resource. expected is how long the wait will last when that
// is known (a reserved pacer slot) and 0 when it is not (a queue). It returns the function to call when the wait is
// over, which is never nil and may be called more than once.
//
// A known wait shorter than waitNoticeAfter is not reported. A known longer one is reported at once. An unknown one is
// reported only if it is still going on after waitNoticeAfter; every wait reported is also ended, in that order.
func BeginWait(ctx context.Context, expected time.Duration) (end func()) {
	n, _ := ctx.Value(waitNoticeKey{}).(WaitNotice)
	if n == nil || (expected > 0 && expected < waitNoticeAfter) {
		return func() {}
	}
	w := &wait{notice: n}
	if expected > 0 {
		w.announce(expected)
	} else {
		w.timer = time.AfterFunc(waitNoticeAfter, func() { w.announce(0) })
	}
	return w.finish
}

// wait is one wait in progress. announce (from the timer) and finish (from the waiter) race: mu makes the outcome one of
// "never announced" or "announced, then done once".
type wait struct {
	notice WaitNotice
	timer  *time.Timer

	mu        sync.Mutex
	announced bool
	finished  bool
	done      func()
}

func (w *wait) announce(expected time.Duration) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.finished || w.announced {
		return
	}
	w.announced = true
	w.done = w.notice(expected)
}

func (w *wait) finish() {
	if w.timer != nil {
		w.timer.Stop()
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.finished {
		return
	}
	w.finished = true
	if w.announced && w.done != nil {
		w.done()
	}
}
