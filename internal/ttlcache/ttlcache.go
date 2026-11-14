// Package ttlcache keeps, for a few seconds, rows that every chat question or search reads and that change rarely: the
// platform's rerank, SystemOne and cost settings, the public switch, and the model and connection rows of the chat,
// rerank, SystemOne and query-embedding targets (#251). Without it each question asks the database for each of them
// again, one round trip after another before the first model call.
//
// The rules, so that a cached row is never more wrong than "a few seconds old":
//
//   - A value is never served past its TTL, and a failed load is never remembered: an unreadable row is an error for
//     this caller, exactly as without the cache (nothing turns a failure into a stale success).
//   - A change made through this process invalidates at once (Invalidate); other processes see it within the TTL.
//   - A load that started before an Invalidate doesn't store its result, so a change is never overwritten by the row
//     read just before it.
//
// What must never be cached is decided where each row is read, not here: the moderation policy is read on every
// question (internal/moderation; DESIGN.md §7.5), so a tightened policy applies to the very next one everywhere.
package ttlcache

import (
	"context"
	"sync"
	"time"
	"weak"
)

// TTL is how long a process trusts a cached settings row: a change made through another process applies within this
// time (through this one at once), as for the answer cache's platform switch and the MCP server's switch.
const TTL = 5 * time.Second

// Value is one cached value. The zero Value is ready to use, with TTL.
type Value[T any] struct {
	// TTL overrides the package TTL (0: TTL; negative: never cache).
	TTL time.Duration

	mu  sync.Mutex
	v   T
	at  time.Time
	gen uint64
	reg sync.Once
}

func ttlOf(d time.Duration) time.Duration {
	if d == 0 {
		return TTL
	}
	return d
}

// Get returns the cached value, or loads it. Two callers missing at the same moment may both load (the reads are
// cheap and idempotent); the value must be safe to share and is not to be changed.
func (c *Value[T]) Get(ctx context.Context, load func(context.Context) (T, error)) (T, error) {
	c.reg.Do(func() { register(weak.Make(c)) })
	c.mu.Lock()
	if !c.at.IsZero() && time.Since(c.at) < ttlOf(c.TTL) {
		v := c.v
		c.mu.Unlock()
		return v, nil
	}
	gen := c.gen
	c.mu.Unlock()
	v, err := load(ctx)
	if err != nil {
		return v, err
	}
	c.mu.Lock()
	if c.gen == gen && ttlOf(c.TTL) > 0 {
		c.v, c.at = v, time.Now()
	}
	c.mu.Unlock()
	return v, nil
}

// Invalidate drops the value: the next Get loads it.
func (c *Value[T]) Invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	var zero T
	c.v, c.at = zero, time.Time{}
	c.gen++
}

// Map caches values by key, with the same rules as Value. It holds at most Max entries (0: 256); when full, entries
// past their TTL are dropped first, then everything (the keys are a platform's models and connections: few).
type Map[K comparable, T any] struct {
	TTL time.Duration
	Max int

	mu  sync.Mutex
	m   map[K]entry[T]
	gen uint64
	reg sync.Once
}

type entry[T any] struct {
	v  T
	at time.Time
}

// Get returns the value cached under key, or loads it.
func (c *Map[K, T]) Get(ctx context.Context, key K, load func(context.Context) (T, error)) (T, error) {
	c.reg.Do(func() { register(weak.Make(c)) })
	ttl := ttlOf(c.TTL)
	c.mu.Lock()
	if e, ok := c.m[key]; ok && time.Since(e.at) < ttl {
		c.mu.Unlock()
		return e.v, nil
	}
	gen := c.gen
	c.mu.Unlock()
	v, err := load(ctx)
	if err != nil {
		return v, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.gen != gen || ttl <= 0 {
		return v, nil
	}
	if c.m == nil {
		c.m = map[K]entry[T]{}
	}
	if max := c.max(); len(c.m) >= max {
		for k, e := range c.m {
			if time.Since(e.at) >= ttl {
				delete(c.m, k)
			}
		}
		if len(c.m) >= max {
			clear(c.m)
		}
	}
	c.m[key] = entry[T]{v: v, at: time.Now()}
	return v, nil
}

func (c *Map[K, T]) max() int {
	if c.Max > 0 {
		return c.Max
	}
	return 256
}

// Invalidate drops every value.
func (c *Map[K, T]) Invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	clear(c.m)
	c.gen++
}

// invalidator is a cache that can be dropped.
type invalidator interface{ Invalidate() }

// caches are every cache used so far, held weakly (a cache goes with the service that owns it).
var caches struct {
	mu   sync.Mutex
	list []func() bool // drops the cache; false once it is gone
}

func register[C any, P interface {
	*C
	invalidator
}](w weak.Pointer[C]) {
	caches.mu.Lock()
	defer caches.mu.Unlock()
	caches.list = append(caches.list, func() bool {
		c := P(w.Value())
		if c == nil {
			return false
		}
		c.Invalidate()
		return true
	})
}

// InvalidateAll drops every cache of the process: for tests that change the rows with SQL of their own, as another
// process would, and want the next request to read them.
func InvalidateAll() {
	caches.mu.Lock()
	defer caches.mu.Unlock()
	kept := caches.list[:0]
	for _, drop := range caches.list {
		if drop() {
			kept = append(kept, drop)
		}
	}
	caches.list = kept
}
