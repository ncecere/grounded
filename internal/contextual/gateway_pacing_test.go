package contextual

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
)

type reviewPacingLimiter struct{ entered, resume chan struct{} }

func (l *reviewPacingLimiter) Wait(ctx context.Context) error {
	close(l.entered)
	select {
	case <-l.resume:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (*reviewPacingLimiter) Backoff(context.Context, time.Duration) {}

func TestReviewRevocationDuringGatewayPacing(t *testing.T) {
	e := newGen(t)
	limiter := &reviewPacingLimiter{make(chan struct{}), make(chan struct{})}
	e.g.Catalog.(fixedResolver).target.Client.Limiter = limiter
	var revoked atomic.Bool
	req := e.req(sections(1))
	req.Checkpoint = func(context.Context) error {
		if revoked.Load() {
			return &StopError{Reason: "source disabled while queued in gateway"}
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := e.g.Contextualize(ctx, req); done <- err }()
	select {
	case <-limiter.entered:
	case <-ctx.Done():
		t.Fatal("did not reach pacing wait")
	}
	revoked.Store(true)
	close(limiter.resume)
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("revocation did not stop generation")
		}
	case <-ctx.Done():
		t.Fatal("generator did not finish")
	}
	assertPacingUnsent(t, e)
}

func assertPacingUnsent(t *testing.T, e *genEnv) {
	t.Helper()
	if len(e.proxy.ContextCalls()) != 0 || len(e.store.counted()) != 0 || len(e.store.usage) != 0 {
		t.Fatalf("unsent pacing work sent/charged: requests=%d attempts=%v usage=%d", len(e.proxy.ContextCalls()), e.store.counted(), len(e.store.usage))
	}
}

func TestPacingRechecksCatalogAndWindow(t *testing.T) {
	for _, change := range []string{"disabled", "model revision", "endpoint", "connection revision", "window"} {
		t.Run(change, func(t *testing.T) {
			e := newGen(t)
			target := e.g.Catalog.(fixedResolver).target
			limiter := &reviewPacingLimiter{make(chan struct{}), make(chan struct{})}
			target.Client.Limiter = limiter
			resolver := &changingResolver{target: target, first: make(chan struct{})}
			e.g.Catalog = resolver
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() { _, err := e.g.Contextualize(ctx, e.req(sections(1))); done <- err }()
			select {
			case <-limiter.entered:
			case <-ctx.Done():
				t.Fatal("pacing wait not entered")
			}
			fresh := target
			var problem error
			switch change {
			case "disabled":
				problem = catalog.ErrChatModelUnusable
			case "model revision":
				fresh.Model.Revision++
			case "endpoint":
				fresh.Client = gateway.New(target.Client.BaseURL+"/obsolete", "fake-only", time.Second)
			case "connection revision":
				fresh.ConnectionRevision++
			case "window":
				window := int32(1)
				fresh.Model.ContextWindow = &window
			}
			resolver.replace(fresh, problem)
			close(limiter.resume)
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("changed target was dispatched")
				}
			case <-ctx.Done():
				t.Fatal("generation did not finish")
			}
			assertPacingUnsent(t, e)
		})
	}
}

type countingPacingLimiter struct {
	calls      atomic.Int32
	background atomic.Bool
}

func (l *countingPacingLimiter) Wait(ctx context.Context) error {
	l.calls.Add(1)
	l.background.Store(gateway.IsBackground(ctx))
	return nil
}
func (*countingPacingLimiter) Backoff(context.Context, time.Duration) {}

func TestPacingPositiveControlWaitsExactlyOnce(t *testing.T) {
	e := newGen(t)
	limiter := &countingPacingLimiter{}
	e.g.Catalog.(fixedResolver).target.Client.Limiter = limiter
	result, err := e.g.Contextualize(t.Context(), e.req(sections(1)))
	if err != nil || result.Calls != 1 || len(e.proxy.ContextCalls()) != 1 || limiter.calls.Load() != 1 || !limiter.background.Load() {
		t.Fatalf("pacing double wait/priority/call: %+v err=%v waits=%d background=%v", result, err, limiter.calls.Load(), limiter.background.Load())
	}
}

// Catalog builds a new client on every resolution; unchanged pacing settings
// must not be mistaken for a different connection just because pointers differ.
type rebuildingPacingResolver struct {
	target  catalog.ChatTarget
	limiter *countingPacingLimiter
}

func (r rebuildingPacingResolver) ChatTarget(context.Context, uuid.UUID) (catalog.ChatTarget, error) {
	fresh := r.target
	fresh.Client = gateway.New(r.target.Client.BaseURL, r.target.Client.APIKey, 20*time.Second)
	fresh.Client.Limiter = r.limiter
	return fresh, nil
}

func TestPacingRebuiltClientSameRevisionUsesOneSlot(t *testing.T) {
	e := newGen(t)
	limiter := &countingPacingLimiter{}
	e.g.Catalog = rebuildingPacingResolver{target: e.g.Catalog.(fixedResolver).target, limiter: limiter}
	result, err := e.g.Contextualize(t.Context(), e.req(sections(1)))
	if err != nil || result.Calls != 1 || limiter.calls.Load() != 1 || len(e.proxy.ContextCalls()) != 1 {
		t.Fatalf("fresh client lost/acquired extra slot: %+v err=%v waits=%d", result, err, limiter.calls.Load())
	}
}

func TestPacingChangedConnectionReleasesAndRetryAcquiresNewSlot(t *testing.T) {
	e := newGen(t)
	target := e.g.Catalog.(fixedResolver).target
	oldLimiter := &reviewPacingLimiter{make(chan struct{}), make(chan struct{})}
	target.Client.Limiter = oldLimiter
	resolver := &changingResolver{target: target, first: make(chan struct{})}
	e.g.Catalog = resolver
	req := e.req(sections(1))
	req.Cap = 1
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := e.g.Contextualize(ctx, req); done <- err }()
	select {
	case <-oldLimiter.entered:
	case <-ctx.Done():
		t.Fatal("initial slot wait not reached")
	}
	fresh := target
	fresh.ConnectionRevision++
	fresh.Client = gateway.New(target.Client.BaseURL, target.Client.APIKey, 20*time.Second)
	newLimiter := &countingPacingLimiter{}
	fresh.Client.Limiter = newLimiter
	resolver.replace(fresh, nil)
	close(oldLimiter.resume)
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("old slot was transferred to changed connection")
		}
	case <-ctx.Done():
		t.Fatal("changed connection did not stop")
	}
	assertPacingUnsent(t, e)
	if newLimiter.calls.Load() != 0 {
		t.Fatal("changed connection was dispatched in old attempt")
	}
	result, err := e.g.Contextualize(t.Context(), req)
	if err != nil || result.Calls != 1 || newLimiter.calls.Load() != 1 || len(e.proxy.ContextCalls()) != 1 || e.store.counted()[OutcomeOK] != 1 {
		t.Fatalf("retry failed new pacing/headroom: %+v err=%v waits=%d attempts=%v", result, err, newLimiter.calls.Load(), e.store.counted())
	}
}

func TestPacingDeadlineReleasesUnsentAdmission(t *testing.T) {
	e := newGen(t)
	e.g.CallTimeout = 30 * time.Millisecond
	limiter := &reviewPacingLimiter{make(chan struct{}), make(chan struct{})}
	e.g.Catalog.(fixedResolver).target.Client.Limiter = limiter
	_, err := e.g.Contextualize(t.Context(), e.req(sections(1)))
	if err == nil {
		t.Fatal("pacing wait ignored call deadline")
	}
	assertPacingUnsent(t, e)
}

func TestReviewPlainTransientRemainsFailure(t *testing.T) {
	e := newGen(t)
	e.proxy.FailContextWith(500)
	req := e.req(sections(1))
	req.Policy = PolicyPlain
	for i := range 3 {
		res, err := e.g.Contextualize(t.Context(), req)
		if err == nil || res.State == StateFallback {
			t.Fatalf("attempt %d unexpectedly fell back: %+v %v", i+1, res, err)
		}
	}
	if len(e.proxy.ContextCalls()) != 3 || e.store.counted()[OutcomeError] != 3 || len(e.store.usage) != 0 {
		t.Fatal("transient exhaustion changed retries or unknown accounting")
	}
}
