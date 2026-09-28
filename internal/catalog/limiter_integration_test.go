package catalog

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestConnLimiterPriorities(t *testing.T) {
	pacer := &ratelimit.Pacer{KV: testutil.NewKV(t)}
	l := &connLimiter{pacer: pacer, key: "conn:test", rpm: 600} // one request per 100 ms
	ctx := context.Background()
	bg := gateway.Background(ctx)

	start := time.Now()
	if err := l.Wait(bg); err != nil || time.Since(start) > 50*time.Millisecond {
		t.Fatalf("first background request waited %s: %v", time.Since(start), err)
	}
	// Interactive requests reserve the next slots ahead...
	for i := 0; i < 3; i++ {
		if err := l.Wait(ctx); err != nil {
			t.Fatal(err)
		}
	}
	// ...so background work waits until they are past (it never reserves
	// ahead of them).
	start = time.Now()
	if err := l.Wait(bg); err != nil {
		t.Fatal(err)
	}
	if el := time.Since(start); el < 80*time.Millisecond {
		t.Errorf("background request did not yield: %s", el)
	}

	// The proxy's Retry-After blocks the connection for everyone: longer
	// than InteractiveMaxWait refuses queries at once; longer than
	// BackgroundPatience refuses ingestion (whose job is then snoozed).
	l.Backoff(ctx, 2*time.Minute)
	for _, c := range []context.Context{ctx, bg} {
		start = time.Now()
		err := l.Wait(c)
		var ge *gateway.Error
		if !errors.As(err, &ge) || !ge.Backpressure() || ge.RetryAfter < time.Minute || time.Since(start) > time.Second {
			t.Fatalf("blocked connection: %v after %s", err, time.Since(start))
		}
	}
}
