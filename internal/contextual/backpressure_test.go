package contextual

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
)

type unsentLimiter struct{}

func (unsentLimiter) Wait(context.Context) error {
	return &gateway.Error{Kind: gateway.KindRateLimited, RetryAfter: time.Second}
}
func (unsentLimiter) Backoff(context.Context, time.Duration) {}

func TestRemoteBackpressureRetainsUnknownAttemptAndCannotBypassCap(t *testing.T) {
	for _, status := range []int{429, 503} {
		t.Run(gatewayStatusName(status), func(t *testing.T) {
			e := newGen(t)
			e.proxy.FailContextWith(status)
			req := e.req(sections(1))
			req.Cap = 1
			_, err := e.g.Contextualize(t.Context(), req)
			var ge *gateway.Error
			if !errors.As(err, &ge) || ge.Status != status || !ge.Backpressure() || len(e.proxy.ContextCalls()) != 1 {
				t.Fatalf("remote refusal: err=%v actual requests=%d", err, len(e.proxy.ContextCalls()))
			}
			if c := e.store.counted(); c[OutcomeError] != 1 || len(e.store.usage) != 0 {
				t.Errorf("remote response released unknown admission or invented usage: attempts=%v usage=%d", c, len(e.store.usage))
			}
			if _, err := e.g.Contextualize(t.Context(), req); err == nil {
				t.Fatal("remote backpressure restored cap headroom")
			}
			if n := len(e.proxy.ContextCalls()); n != 1 {
				t.Errorf("remote backpressure bypassed cap: %d requests with cap1", n)
			}
		})
	}
}

func gatewayStatusName(status int) string {
	if status == 429 {
		return "429"
	}
	return "503 Retry-After"
}

func TestProvenUnsentLimiterRefusalDoesNotCountASentCall(t *testing.T) {
	e := newGen(t)
	e.g.Catalog.(fixedResolver).target.Client.Limiter = unsentLimiter{}
	res, err := e.g.Contextualize(t.Context(), e.req(sections(1)))
	var ge *gateway.Error
	if !errors.As(err, &ge) || ge.Status != 0 || !ge.Backpressure() {
		t.Fatalf("local refusal: %v", err)
	}
	if n := len(e.proxy.ContextCalls()); n != 0 || res.Calls != 0 || len(e.store.counted()) != 0 || len(e.store.usage) != 0 {
		t.Fatalf("unsent request counted: actual=%d reported=%d attempts=%v usage=%d", n, res.Calls, e.store.counted(), len(e.store.usage))
	}
}
