package crawl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Pacer spaces requests to one origin (scheme://host:port) across all workers.
// The Fetcher always passes the origin with an explicit port, e.g.
// "https://www.example.edu:443", and calls Wait before every request it sends
// (robots.txt, sitemaps, pages and each redirect hop).
type Pacer interface {
	Wait(ctx context.Context, origin string) error
}

type valkeyPacer struct {
	client   *redis.Client
	prefix   string
	interval time.Duration
}

// NewValkeyPacer uses SET NX PX on key prefix+sha256(origin) with the given
// interval, polling with backoff; returns ctx errors. Winning the SET grants
// the caller the next slot; the key's expiry opens the following one, so at
// most one request per interval reaches an origin across all processes that
// share the prefix. Valkey errors are returned (fail closed). An interval <= 0
// disables pacing.
func NewValkeyPacer(client *redis.Client, prefix string, interval time.Duration) Pacer {
	if interval > 0 && interval < time.Millisecond {
		interval = time.Millisecond
	}
	return &valkeyPacer{client: client, prefix: prefix, interval: interval}
}

const (
	pacerMinPoll = 10 * time.Millisecond
	pacerMaxPoll = time.Second
)

func (p *valkeyPacer) Wait(ctx context.Context, origin string) error {
	if p.interval <= 0 {
		return ctx.Err()
	}
	sum := sha256.Sum256([]byte(origin))
	key := p.prefix + hex.EncodeToString(sum[:])
	backoff := pacerMinPoll
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		op, cancel := context.WithTimeout(ctx, 2*time.Second)
		ok, err := p.client.SetNX(op, key, "1", p.interval).Result()
		var ttl time.Duration
		if err == nil && !ok {
			ttl, err = p.client.PTTL(op, key).Result()
		}
		cancel()
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			return fmt.Errorf("crawl: origin pacing unavailable: %w", err)
		}
		if ok {
			return nil
		}
		// Sleep until the slot should open (PTTL), but never less than the
		// current backoff step, plus jitter so waiters don't stampede.
		wait := max(ttl, backoff)
		wait = min(wait, pacerMaxPoll)
		wait += time.Duration(rand.Int64N(int64(backoff/2) + 1))
		backoff = min(backoff*2, pacerMaxPoll)
		if err := sleepCtx(ctx, wait); err != nil {
			return err
		}
	}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

type localPacer struct {
	interval time.Duration
	mu       sync.Mutex
	next     map[string]time.Time
}

// NewLocalPacer is an in-process pacer for tests/single node. Callers reserve
// slots in arrival order; a caller whose context ends while waiting forfeits
// its slot (the origin simply stays quiet for that interval). An interval <= 0
// disables pacing.
func NewLocalPacer(interval time.Duration) Pacer {
	return &localPacer{interval: interval, next: map[string]time.Time{}}
}

const localPacerMaxOrigins = 10000

func (p *localPacer) Wait(ctx context.Context, origin string) error {
	if err := ctx.Err(); err != nil || p.interval <= 0 {
		return err
	}
	p.mu.Lock()
	now := time.Now()
	if len(p.next) >= localPacerMaxOrigins {
		for o, t := range p.next {
			if t.Before(now) {
				delete(p.next, o)
			}
		}
	}
	slot := now
	if t, ok := p.next[origin]; ok && t.After(now) {
		slot = t
	}
	p.next[origin] = slot.Add(p.interval)
	p.mu.Unlock()
	return sleepCtx(ctx, time.Until(slot))
}
