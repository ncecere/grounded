package systemone

import (
	"container/list"
	"context"
	"sync"

	"github.com/google/uuid"
)

// Priority is a SystemOne call's claim on its connection's slots
// (docs/v0.4.1.md §4). It matters only when every slot is busy: a freed slot
// goes to the oldest interactive waiter first, and background calls may hold
// at most half the slots (at least one), so an evaluation run or the gap
// topics job can't fill them.
type Priority int

const (
	// Interactive calls are part of an answer someone waits for: judging,
	// scope, claim checks, moderation, saved-answer confirmation, Try it.
	// It is the default.
	Interactive Priority = iota
	// Background calls are evaluation runs and the gap topics job.
	Background
)

// String is the priority's metric label.
func (p Priority) String() string {
	if p == Background {
		return "background"
	}
	return "interactive"
}

type priorityCtxKey struct{}

// WithPriority returns ctx carrying p for the SystemOne calls made with it,
// through the agent pipeline (evaluation runs) or directly (the gap job).
func WithPriority(ctx context.Context, p Priority) context.Context {
	return context.WithValue(ctx, priorityCtxKey{}, p)
}

// PriorityFrom returns ctx's priority: Interactive unless WithPriority set
// Background.
func PriorityFrom(ctx context.Context) Priority {
	if p, _ := ctx.Value(priorityCtxKey{}).(Priority); p == Background {
		return Background
	}
	return Interactive
}

// slots is a connection's concurrency cap within this process: a priority
// semaphore of size max_concurrent_requests. Below the limit, acquire takes
// one uncontended lock and returns (the fast path); waiters queue per
// priority, oldest first, and are handed a slot by the release that frees it.
//
// Invariants (under mu): held <= size, bgHeld <= bgMax, and a waiter exists
// only while its priority can't take a slot (release and acquire hand every
// takeable slot to a waiter before returning).
type slots struct {
	mu      sync.Mutex
	size    int // the connection's limit
	bgMax   int // max(1, size/2): the most slots background calls may hold
	held    int
	bgHeld  int
	waiting [2]list.List // of *waiter, by Priority
}

// waiter is a queued acquire; ready is closed once granted (under mu).
type waiter struct {
	ready   chan struct{}
	granted bool
}

func newSlots(n int) *slots { return &slots{size: n, bgMax: max(1, n/2)} }

var (
	slotsMu sync.Mutex
	slotMap = map[uuid.UUID]*slots{}
)

// slotsFor returns the connection's cap, replacing it when the configured
// size changed (requests holding or waiting for an old slot release it to,
// or get it from, the old cap).
func slotsFor(conn uuid.UUID, n int) *slots {
	if n <= 0 {
		n = DefaultMaxConcurrent
	}
	slotsMu.Lock()
	defer slotsMu.Unlock()
	s, ok := slotMap[conn]
	if !ok || s.size != n {
		s = newSlots(n)
		slotMap[conn] = s
	}
	return s
}

// takeable reports whether a call of priority p may take a slot now. A
// background call also lets queued calls go first; an interactive one only
// queued interactive calls (which exist only when every slot is busy).
func (s *slots) takeable(p Priority) bool {
	if s.held >= s.size || s.waiting[Interactive].Len() > 0 {
		return false
	}
	return p == Interactive || (s.bgHeld < s.bgMax && s.waiting[Background].Len() == 0)
}

func (s *slots) take(p Priority) {
	s.held++
	if p == Background {
		s.bgHeld++
	}
}

// acquire waits for a slot, bounded by ctx, and returns its release. A
// cancelled waiter leaves the queue; one granted a slot as it was cancelled
// passes the slot on.
func (s *slots) acquire(ctx context.Context, p Priority) (func(), error) {
	release := func() { s.release(p) }
	s.mu.Lock()
	if s.takeable(p) {
		s.take(p)
		s.mu.Unlock()
		return release, nil
	}
	if err := ctx.Err(); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	w := &waiter{ready: make(chan struct{})}
	el := s.waiting[p].PushBack(w)
	s.mu.Unlock()
	select {
	case <-w.ready:
		return release, nil
	case <-ctx.Done():
	}
	s.mu.Lock()
	granted := w.granted
	if !granted {
		s.waiting[p].Remove(el)
	}
	s.mu.Unlock()
	if granted {
		release()
	}
	return nil, ctx.Err()
}

// release frees a slot of priority p and hands free slots to waiters:
// interactive ones first, then background ones while under their cap.
func (s *slots) release(p Priority) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.held--
	if p == Background {
		s.bgHeld--
	}
	for s.held < s.size {
		q := Interactive
		if s.waiting[Interactive].Len() == 0 {
			if s.waiting[Background].Len() == 0 || s.bgHeld >= s.bgMax {
				return
			}
			q = Background
		}
		w := s.waiting[q].Remove(s.waiting[q].Front()).(*waiter)
		s.take(q)
		w.granted = true
		close(w.ready)
	}
}
