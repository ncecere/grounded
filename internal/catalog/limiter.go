package catalog

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/ratelimit"
)

// Waiting policy under a connection's requestsPerMinute.
const (
	// InteractiveMaxWait is the longest a query or chat request queues for a
	// slot; beyond it the request fails with 503 and Retry-After.
	InteractiveMaxWait = 10 * time.Second
	// BackgroundPatience is how long ingestion waits for free capacity in
	// process before giving up (the job is then snoozed, not failed).
	BackgroundPatience = time.Minute
)

// connLimiter paces one connection's requests across every Grounded process
// (ratelimit.Pacer). Interactive requests reserve the next slot, queueing up
// to InteractiveMaxWait. Background requests (gateway.Background) only take a
// slot that is free now and otherwise poll, so reserved interactive slots are
// never pushed back by ingestion. A 429 or Retry-After from the proxy blocks
// the connection for everyone. When Valkey is unavailable requests are not
// limited (fail open) and the proxy's own 429s still apply.
//
// rpm 0 does not space requests: the limiter then only honours the
// proxy's backoff (SystemOne connections, ADR-0020).
type connLimiter struct {
	pacer *ratelimit.Pacer
	key   string
	rpm   int
	log   *slog.Logger
}

func (l *connLimiter) interval() time.Duration {
	if l.rpm <= 0 {
		return time.Microsecond
	}
	return time.Minute / time.Duration(l.rpm)
}

func (l *connLimiter) limited(d time.Duration) error {
	msg := fmt.Sprintf("the connection's limit of %d requests per minute is reached", l.rpm)
	if l.rpm <= 0 {
		msg = "the service asked Grounded to wait (overloaded)"
	}
	return &gateway.Error{Kind: gateway.KindRateLimited, RetryAfter: d, Message: msg}
}

func (l *connLimiter) Wait(ctx context.Context) error {
	background := gateway.IsBackground(ctx)
	maxWait := InteractiveMaxWait
	if background {
		maxWait = 0
	}
	// Don't queue for a slot the caller's deadline won't see.
	if dl, ok := ctx.Deadline(); ok && !background {
		maxWait = min(maxWait, max(time.Until(dl), 0))
	}
	var waited time.Duration
	for {
		delay, ok, err := l.pacer.Reserve(ctx, l.key, l.interval(), maxWait)
		if err != nil {
			if l.log != nil {
				l.log.WarnContext(ctx, "connection rate limit unavailable; not limiting", "err", err)
			}
			return nil
		}
		if !ok && (!background || waited+delay > BackgroundPatience) {
			return l.limited(delay)
		}
		if !ok {
			// Come back just after the slot frees, spread out so several
			// waiting workers don't all poll at once.
			delay += time.Duration(rand.Int64N(int64(l.interval()/2) + 1))
			waited += delay
		}
		if delay > 0 {
			t := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				t.Stop()
				return ctx.Err()
			case <-t.C:
			}
		}
		if ok {
			return nil
		}
	}
}

func (l *connLimiter) Backoff(ctx context.Context, d time.Duration) {
	if err := l.pacer.Block(ctx, l.key, d); err != nil && l.log != nil {
		l.log.WarnContext(ctx, "could not record the proxy's Retry-After", "err", err)
	}
}
