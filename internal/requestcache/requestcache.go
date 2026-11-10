// Package requestcache remembers, for the life of one request, rows that
// several steps of the request read: a team's limits, its cost settings. One
// chat question passes through admission, the budget, retrieval and the tools,
// each in its own package and each needing the same few settings rows; without
// this every step asks the database again, one round trip after another before
// the first model call.
//
// The cache lives in the context and ends with the request, so nothing outlives
// a change: the next request reads the rows again. Only requests that read
// settings without changing them start one (a chat answer, a search). A
// context without a cache loads every time, which is what a handler that writes
// a setting and reads it back needs.
package requestcache

import (
	"context"
	"sync"
)

type ctxKey struct{}

type cache struct {
	mu     sync.Mutex
	values map[any]any
}

// With returns a context that remembers what Get loads. A context that already
// has a cache is returned as it is.
func With(ctx context.Context) context.Context {
	if _, ok := ctx.Value(ctxKey{}).(*cache); ok {
		return ctx
	}
	return context.WithValue(ctx, ctxKey{}, &cache{values: map[any]any{}})
}

// Get returns the value remembered under key, or loads and remembers it. key
// is a comparable value of a type private to the caller's package, so packages
// cannot collide. A failed load is not remembered. Two steps asking at the same
// moment may both load; the value must be safe to share and is not to be
// changed. Without a cache in ctx, Get is load.
func Get[V any](ctx context.Context, key any, load func() (V, error)) (V, error) {
	c, ok := ctx.Value(ctxKey{}).(*cache)
	if !ok {
		return load()
	}
	c.mu.Lock()
	v, found := c.values[key]
	c.mu.Unlock()
	if found {
		return v.(V), nil
	}
	loaded, err := load()
	if err != nil {
		return loaded, err
	}
	c.mu.Lock()
	c.values[key] = loaded
	c.mu.Unlock()
	return loaded, nil
}
