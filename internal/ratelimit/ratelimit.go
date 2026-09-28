// Package ratelimit implements fixed-window admission counters in Valkey.
//
// Counters are ephemeral (ADR-0015). Callers choose what happens when Valkey is
// unavailable: authenticated traffic fails open (availability matters more than
// a lost counter), while anonymous/public traffic should fail closed.
package ratelimit

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ncecere/grounded/internal/kv"
)

type Limiter struct {
	KV *kv.Store
}

var incrScript = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`)

// Result describes one admission decision.
type Result struct {
	Allowed    bool
	Remaining  int
	RetryAfter time.Duration
}

// Allow counts one event for key in the current window and reports whether
// the count is within limit.
func (l *Limiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	secs := int64(window / time.Second)
	if secs < 1 {
		secs = 1
	}
	bucket := time.Now().Unix() / secs
	k := l.KV.Key("rate", key, strconv.FormatInt(bucket, 10))
	n, err := incrScript.Run(ctx, l.KV.Client, []string{k}, secs).Int64()
	if err != nil {
		return Result{}, err
	}
	res := Result{Allowed: n <= int64(limit), Remaining: max(0, limit-int(n))}
	if !res.Allowed {
		res.RetryAfter = time.Duration((bucket+1)*secs-time.Now().Unix()) * time.Second
	}
	return res, nil
}

// Peek returns the count for key in the current window without adding to it.
func (l *Limiter) Peek(ctx context.Context, key string, window time.Duration) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	n, err := l.KV.Client.Get(ctx, l.bucketKey(key, window)).Int()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	return n, err
}

// PeekMax returns the highest count among keys in the current window (0
// for none), without adding to any: the busiest of a set of counters.
func (l *Limiter) PeekMax(ctx context.Context, keys []string, window time.Duration) (int, error) {
	if len(keys) == 0 {
		return 0, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	full := make([]string, len(keys))
	for i, k := range keys {
		full[i] = l.bucketKey(k, window)
	}
	vals, err := l.KV.Client.MGet(ctx, full...).Result()
	if err != nil {
		return 0, err
	}
	busiest := 0
	for _, v := range vals {
		if s, ok := v.(string); ok {
			if n, err := strconv.Atoi(s); err == nil && n > busiest {
				busiest = n
			}
		}
	}
	return busiest, nil
}

// bucketKey is the Valkey key of key's counter in the current window.
func (l *Limiter) bucketKey(key string, window time.Duration) string {
	secs := int64(window / time.Second)
	if secs < 1 {
		secs = 1
	}
	return l.KV.Key("rate", key, strconv.FormatInt(time.Now().Unix()/secs, 10))
}
