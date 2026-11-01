package contextual

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/testutil"
)

type changingResolver struct {
	mu     sync.Mutex
	target catalog.ChatTarget
	err    error
	once   sync.Once
	first  chan struct{}
}

func (r *changingResolver) ChatTarget(context.Context, uuid.UUID) (catalog.ChatTarget, error) {
	r.mu.Lock()
	target, err := r.target, r.err
	r.mu.Unlock()
	r.once.Do(func() { close(r.first) })
	return target, err
}

func (r *changingResolver) replace(target catalog.ChatTarget, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.target, r.err = target, err
}

func TestQueuedContextRechecksModelConfiguration(t *testing.T) {
	testQueuedTarget(t, "model revision", func(target catalog.ChatTarget) (catalog.ChatTarget, error) {
		target.Model.Revision++
		return target, nil
	}, false)
}

func TestQueuedContextRechecksConnectionEligibility(t *testing.T) {
	testQueuedTarget(t, "disabled connection", func(target catalog.ChatTarget) (catalog.ChatTarget, error) {
		return target, catalog.ErrChatModelUnusable
	}, false)
}

func TestQueuedContextDoesNotSendToObsoleteEndpoint(t *testing.T) {
	other := testutil.NewFakeProxy(t)
	other.AddChatModel("ctx-writer")
	testQueuedTarget(t, "changed endpoint", func(target catalog.ChatTarget) (catalog.ChatTarget, error) {
		target.Client = gateway.New(other.BaseURL(), other.APIKey, 20*time.Second)
		return target, nil
	}, false)
	if len(other.ContextCalls()) != 0 {
		t.Error("changed endpoint received work before a new plan")
	}
}

func TestQueuedContextUsesFreshClient(t *testing.T) {
	testQueuedTarget(t, "refreshed client", func(target catalog.ChatTarget) (catalog.ChatTarget, error) {
		// Same generation destination, but a new client (for example, after
		// credential rotation). The provider must not receive the old pointer.
		target.Client = gateway.New(target.Client.BaseURL, target.Client.APIKey, 19*time.Second)
		return target, nil
	}, true)
}

func testQueuedTarget(t *testing.T, reason string, change func(catalog.ChatTarget) (catalog.ChatTarget, error), wantCall bool) {
	t.Helper()
	e := newGen(t)
	target := e.g.Catalog.(fixedResolver).target
	target.Model.Revision = 1
	r := &changingResolver{target: target, first: make(chan struct{})}
	e.g.Catalog, e.g.Concurrency = r, 1
	e.g.init()
	e.g.sem <- struct{}{}
	// Always release the slot, including an early assertion failure.
	var release sync.Once
	unlock := func() { release.Do(func() { <-e.g.sem }) }
	t.Cleanup(unlock)
	var providerClient *gateway.Client
	e.g.NewProvider = func(c *gateway.Client) llm.Provider {
		providerClient = c
		return llm.NewOpenAI(c)
	}
	type outcome struct {
		result Result
		err    error
	}
	done := make(chan outcome, 1)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	req := e.req(sections(1))
	go func() { res, err := e.g.Contextualize(ctx, req); done <- outcome{res, err} }()
	select {
	case <-r.first:
	case <-time.After(5 * time.Second):
		t.Fatal("initial target was not resolved")
	}
	fresh, err := change(target)
	r.replace(fresh, err)
	unlock()
	var got outcome
	select {
	case got = <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("queued generation did not finish")
	}
	if wantCall {
		if got.err != nil || got.result.Calls != 1 || providerClient != fresh.Client {
			t.Errorf("%s: queued generation used stale client: result=%+v err=%v freshClientUsed=%v", reason, got.result, got.err, providerClient == fresh.Client)
		}
	} else if got.err == nil || got.result.Calls != 0 || len(got.result.Contexts) != 0 || len(e.proxy.ContextCalls()) != 0 || len(e.store.usage) != 0 {
		t.Errorf("%s: obsolete queued target sent work: result=%+v err=%v actualCalls=%d usage=%d", reason, got.result, got.err, len(e.proxy.ContextCalls()), len(e.store.usage))
	}
}

type targetChangingAdmissionStore struct {
	Store
	after func()
}

func (s targetChangingAdmissionStore) Reserve(ctx context.Context, reservation Reservation) (int64, error) {
	id, err := s.Store.Reserve(ctx, reservation)
	if err == nil {
		s.after()
	}
	return id, err
}

func TestContextRechecksTargetAfterAdmissionWait(t *testing.T) {
	e := newGen(t)
	target := e.g.Catalog.(fixedResolver).target
	r := &changingResolver{target: target, first: make(chan struct{})}
	e.g.Catalog = r
	e.g.Store = targetChangingAdmissionStore{Store: e.store, after: func() { r.replace(target, catalog.ErrChatModelUnusable) }}
	res, err := e.g.Contextualize(t.Context(), e.req(sections(1)))
	if err == nil || res.Calls != 0 || len(e.proxy.ContextCalls()) != 0 || len(e.store.usage) != 0 || len(e.store.counted()) != 0 {
		t.Errorf("admission wait used revoked target or kept unsent admission: result=%+v err=%v actualCalls=%d usage=%d admissionOutcomes=%v", res, err, len(e.proxy.ContextCalls()), len(e.store.usage), e.store.counted())
	}
}

func TestInFlightModelChangeKeepsUsageWithoutPublishingContext(t *testing.T) {
	e := newGen(t)
	target := e.g.Catalog.(fixedResolver).target
	r := &changingResolver{target: target, first: make(chan struct{})}
	e.g.Catalog = r
	req := e.req(sections(1))
	var change sync.Once
	req.Checkpoint = func(context.Context) error {
		if len(e.proxy.ContextCalls()) > 0 {
			change.Do(func() { target.Model.Revision++; r.replace(target, nil) })
		}
		return nil
	}
	res, err := e.g.Contextualize(t.Context(), req)
	if err == nil || len(res.Contexts) != 0 || len(e.store.cache) != 0 || len(e.store.usage) != 1 || len(e.proxy.ContextCalls()) != 1 {
		t.Errorf("in-flight model change published context or lost paid usage: result=%+v err=%v cache=%d usage=%d calls=%d", res, err, len(e.store.cache), len(e.store.usage), len(e.proxy.ContextCalls()))
	}
}

func TestContextualCacheSeparatesModelConfigurationRevisions(t *testing.T) {
	e := newGen(t)
	req := e.req(sections(1))
	if _, err := e.g.Contextualize(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	target := e.g.Catalog.(fixedResolver).target
	target.Model.Revision++
	e.g.Catalog = fixedResolver{target}
	res, err := e.g.Contextualize(t.Context(), req)
	if err != nil || res.Calls != 1 || res.Cached != 0 || len(e.proxy.ContextCalls()) != 2 {
		t.Errorf("model revision reused obsolete generated context: result=%+v err=%v calls=%d", res, err, len(e.proxy.ContextCalls()))
	}
}

func TestContextualCacheSeparatesConnectionEndpoints(t *testing.T) {
	e := newGen(t)
	req := e.req(sections(1))
	if _, err := e.g.Contextualize(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	other := testutil.NewFakeProxy(t)
	other.AddChatModel("ctx-writer")
	target := e.g.Catalog.(fixedResolver).target
	target.Client = gateway.New(other.BaseURL(), other.APIKey, 20*time.Second)
	e.g.Catalog = fixedResolver{target}
	res, err := e.g.Contextualize(t.Context(), req)
	if err != nil || res.Calls != 1 || res.Cached != 0 || len(other.ContextCalls()) != 1 {
		t.Errorf("new endpoint reused obsolete generated context: result=%+v err=%v newEndpointCalls=%d", res, err, len(other.ContextCalls()))
	}
}
