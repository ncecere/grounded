package contextual

import (
	"context"
	"errors"
	"sync"

	"github.com/google/uuid"
)

// memStore is a Store in memory, for tests that need no database (and the real-model harness).
type memStore struct {
	mu       sync.Mutex
	cache    map[[32]byte]string
	attempts []*memAttempt
	usage    []Usage
	next     int64
}

type memAttempt struct {
	id       int64
	res      Reservation
	outcome  string
	in, out  *int32
	released bool
}

func newMemStore() *memStore { return &memStore{cache: map[[32]byte]string{}} }

func (m *memStore) CacheFor(_ context.Context, _ uuid.UUID, keys [][32]byte) (map[[32]byte]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[[32]byte]string{}
	for _, k := range keys {
		if v, ok := m.cache[k]; ok {
			out[k] = v
		}
	}
	return out, nil
}

func (m *memStore) PutCache(_ context.Context, e CacheEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.cache[e.Key]; !ok {
		m.cache[e.Key] = e.Text
	}
	return nil
}

func (m *memStore) PruneCache(_ context.Context, _ uuid.UUID, keep [][32]byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := map[[32]byte]bool{}
	for _, x := range keep {
		k[x] = true
	}
	for key := range m.cache {
		if !k[key] {
			delete(m.cache, key)
		}
	}
	return nil
}

func (m *memStore) Reserve(_ context.Context, r Reservation) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, a := range m.attempts {
		if !a.released && a.res.SourceID == r.SourceID && a.res.Phase == r.Phase && (r.Phase == PhaseLive || a.res.ProfileID == r.ProfileID) {
			n++
		}
	}
	if n >= r.Cap {
		return 0, ErrCapReached
	}
	m.next++
	m.attempts = append(m.attempts, &memAttempt{id: m.next, res: r, outcome: OutcomeStarted})
	return m.next, nil
}

func (m *memStore) Settle(_ context.Context, s Settlement) error {
	if !terminalOutcome(s.Outcome) {
		return errors.New("contextual settlement requires a terminal outcome")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, a := range m.attempts {
		if a.id == s.ID && !a.released && a.outcome == OutcomeStarted {
			a.outcome, a.in, a.out = s.Outcome, s.TokensIn, s.TokensOut
			if s.Usage != nil {
				m.usage = append(m.usage, *s.Usage)
			}
			return nil
		}
	}
	return nil
}

func (m *memStore) Release(_ context.Context, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, a := range m.attempts {
		if a.id == id && a.outcome == OutcomeStarted {
			a.released = true
		}
	}
	return nil
}

// counted returns the attempts that count, by outcome.
func (m *memStore) counted() map[string]int {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]int{}
	for _, a := range m.attempts {
		if !a.released {
			out[a.outcome]++
		}
	}
	return out
}
