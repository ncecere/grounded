package gateway_test

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/testutil"
)

type recordingLimiter struct {
	mu      sync.Mutex
	waits   int
	backoff []time.Duration
	refuse  error
}

func (l *recordingLimiter) Wait(context.Context) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.waits++
	return l.refuse
}

func (l *recordingLimiter) Backoff(_ context.Context, d time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.backoff = append(l.backoff, d)
}

func TestRetryAfterAndBackpressure(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	lim := &recordingLimiter{}
	c := gateway.New(p.BaseURL(), p.APIKey, 5*time.Second)
	c.Limiter = lim
	ctx := context.Background()
	embed := func(ctx context.Context) *gateway.Error {
		_, err := c.Embed(ctx, gateway.EmbedRequest{Model: "test-embed", Input: []string{"x"}})
		var ge *gateway.Error
		if err != nil && !errors.As(err, &ge) {
			t.Fatalf("not a gateway error: %v", err)
		}
		return ge
	}

	cases := []struct {
		status     int
		retryAfter string
		want       time.Duration
		pressure   bool
		backoff    time.Duration // told to the limiter; 0 = nothing
	}{
		{429, "3", 3 * time.Second, true, 3 * time.Second},
		{429, "", 0, true, gateway.DefaultBackoff},
		{429, time.Now().Add(90 * time.Second).UTC().Format(http.TimeFormat), 90 * time.Second, true, 90 * time.Second},
		{503, "2", 2 * time.Second, true, 2 * time.Second},
		{503, "", 0, false, 0}, // plain outage: a failure, not backpressure
		{500, "", 0, false, 0},
		{429, "999999", time.Hour, true, time.Hour}, // capped
	}
	for _, tc := range cases {
		lim.backoff = nil
		p.RejectEmbeddings(1, tc.status, tc.retryAfter)
		ge := embed(ctx)
		if ge == nil || ge.Status != tc.status || ge.Backpressure() != tc.pressure {
			t.Fatalf("%d %q: %+v", tc.status, tc.retryAfter, ge)
		}
		if d := ge.RetryAfter; d < tc.want-2*time.Second || d > tc.want {
			t.Errorf("%d %q: RetryAfter = %s, want %s", tc.status, tc.retryAfter, d, tc.want)
		}
		switch {
		case tc.backoff == 0 && len(lim.backoff) > 0:
			t.Errorf("%d %q: limiter told to back off %v", tc.status, tc.retryAfter, lim.backoff)
		case tc.backoff > 0 && (len(lim.backoff) != 1 || lim.backoff[0] < tc.backoff-2*time.Second || lim.backoff[0] > tc.backoff):
			t.Errorf("%d %q: backoff = %v, want %s", tc.status, tc.retryAfter, lim.backoff, tc.backoff)
		}
	}

	// Every request waits for the limiter, unless the caller already did.
	lim.waits = 0
	if embed(ctx) != nil || lim.waits != 1 {
		t.Fatalf("waits = %d", lim.waits)
	}
	if embed(gateway.WithSlot(ctx)) != nil || lim.waits != 1 {
		t.Fatalf("WithSlot waited again: %d", lim.waits)
	}
	// A refused wait is returned without calling the proxy.
	lim.refuse = &gateway.Error{Kind: gateway.KindRateLimited, RetryAfter: time.Minute}
	before := len(p.EmbedBatches())
	if ge := embed(ctx); ge == nil || !ge.Backpressure() || len(p.EmbedBatches()) != before {
		t.Fatalf("refused wait = %+v", ge)
	}
	if !gateway.IsBackground(gateway.Background(ctx)) || gateway.IsBackground(ctx) {
		t.Error("background flag")
	}
}
