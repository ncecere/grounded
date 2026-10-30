package contextual

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

type revokeAfterCacheRead struct {
	Store
	revoked *bool
}

func (s revokeAfterCacheRead) CacheFor(ctx context.Context, doc uuid.UUID, keys [][32]byte) (map[[32]byte]string, error) {
	out, err := s.Store.CacheFor(ctx, doc, keys)
	*s.revoked = true
	return out, err
}

func TestCachedContextCannotBypassRevokedCheckpoint(t *testing.T) {
	e := newGen(t)
	req := e.req(sections(1))
	if _, err := e.g.Contextualize(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	req.Checkpoint = func(context.Context) error { return &StopError{Reason: "source opt-in revoked"} }
	res, err := e.g.Contextualize(t.Context(), req)
	var stop *StopError
	if !errors.As(err, &stop) || res.State == StateContext || len(res.Contexts) != 0 {
		t.Fatalf("cached return bypassed revoked checkpoint: result=%+v err=%v", res, err)
	}
	if len(e.proxy.ContextCalls()) != 1 {
		t.Fatal("revoked cache use sent another request")
	}
}

func TestCacheReadRevocationStopsBeforeReturningEmbeddingContext(t *testing.T) {
	e := newGen(t)
	req := e.req(sections(1))
	if _, err := e.g.Contextualize(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	revoked := false
	e.g.Store = revokeAfterCacheRead{Store: e.store, revoked: &revoked}
	req.Checkpoint = func(context.Context) error {
		if revoked {
			return &StopError{Reason: "scope changed during cache read"}
		}
		return nil
	}
	res, err := e.g.Contextualize(t.Context(), req)
	var stop *StopError
	if !errors.As(err, &stop) || len(res.Contexts) != 0 {
		t.Fatalf("cache-read race returned context after revocation: result=%+v err=%v", res, err)
	}
}

func TestCancelledCachedRequestDoesNotReturnContext(t *testing.T) {
	e := newGen(t)
	req := e.req(sections(1))
	if _, err := e.g.Contextualize(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	res, err := e.g.Contextualize(ctx, req)
	if !errors.Is(err, context.Canceled) || len(res.Contexts) != 0 {
		t.Fatalf("cancelled cache request returned context: result=%+v err=%v", res, err)
	}
}

func TestGeneratorHarnessCacheIsDocumentScoped(t *testing.T) {
	e := newGen(t)
	req := e.req(sections(1))
	if _, err := e.g.Contextualize(t.Context(), req); err != nil {
		t.Fatal(err)
	}
	other := req
	other.DocumentID = uuid.New()
	res, err := e.g.Contextualize(t.Context(), other)
	if err != nil || res.Calls != 1 || res.Cached != 0 || len(e.proxy.ContextCalls()) != 2 {
		t.Fatalf("different document reused another document's cache: result=%+v err=%v calls=%d", res, err, len(e.proxy.ContextCalls()))
	}
	res, err = e.g.Contextualize(t.Context(), req)
	if err != nil || res.Calls != 0 || res.Cached != 1 || len(e.store.cache) != 2 {
		t.Fatalf("second document pruned the first document's cache: result=%+v err=%v cache=%d", res, err, len(e.store.cache))
	}
}
