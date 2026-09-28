package ingest_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

func newBatcher(t *testing.T, maxInputs int, linger time.Duration) (*ingest.Batcher, *testutil.FakeProxy, catalog.EmbedTarget) {
	t.Helper()
	counter, err := chunk.NewTokenCounter()
	if err != nil {
		t.Fatal(err)
	}
	p := testutil.NewFakeProxy(t)
	target := catalog.EmbedTarget{
		Profile: dbgen.EmbeddingProfile{ID: uuid.New(), Dimensions: 8},
		Model:   dbgen.Model{ID: uuid.New(), UpstreamModel: "test-embed", Revision: 1},
		Client:  gateway.New(p.BaseURL(), p.APIKey, 5*time.Second),
	}
	return &ingest.Batcher{MaxInputs: maxInputs, Linger: linger, Parallel: 1, Counter: counter}, p, target
}

func texts(doc, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("document %d chunk %d about registration deadlines", doc, i)
	}
	return out
}

// Concurrent documents share requests, and each gets its own vectors back
// in order, with the proxy's token count split between them.
func TestBatcherSharesRequestsAcrossDocuments(t *testing.T) {
	b, p, target := newBatcher(t, 64, 100*time.Millisecond)
	const docs = 20
	var wg sync.WaitGroup
	usage := make([]ingest.EmbedUsage, docs)
	for d := 0; d < docs; d++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			in := texts(d, 1+d%3)
			vecs, u, err := b.Embed(context.Background(), target, in, "grounded-ingest:team")
			if err != nil {
				t.Errorf("doc %d: %v", d, err)
				return
			}
			for i, v := range vecs {
				if !slices.Equal(v, testutil.FakeEmbedding(in[i], 8)) {
					t.Errorf("doc %d input %d: wrong vector", d, i)
				}
			}
			usage[d] = u
		}()
	}
	wg.Wait()
	batches := p.EmbedBatches()
	inputs := 0
	for _, n := range batches {
		inputs += n
	}
	if inputs != 39 { // 20 documents x 1-3 chunks (7x1 + 7x2 + 6x3)
		t.Fatalf("inputs sent = %d (%v)", inputs, batches)
	}
	if len(batches) > 2 {
		t.Errorf("20 concurrent documents took %d requests (%v); want them batched", len(batches), batches)
	}
	var reported, counted int
	for _, u := range usage {
		reported += u.Reported
		counted += u.Counted
		if u.Requests < 1 || u.Counted == 0 {
			t.Errorf("usage = %+v", u)
		}
	}
	// The fake reports words+1 per input: 8 per text here.
	if reported < 39*8-docs || reported > 39*8+docs { // rounding per document
		t.Errorf("reported tokens split = %d, want about %d", reported, 39*8)
	}
}

// One document larger than a request is split; request order is kept.
func TestBatcherSplitsLargeDocuments(t *testing.T) {
	b, p, target := newBatcher(t, 64, 0)
	in := texts(1, 150)
	vecs, u, err := b.Embed(context.Background(), target, in, "u")
	if err != nil {
		t.Fatal(err)
	}
	if got := p.EmbedBatches(); !slices.Equal(got, []int{64, 64, 22}) || u.Requests != 3 {
		t.Fatalf("batches = %v, usage %+v", got, u)
	}
	for i := range in {
		if !slices.Equal(vecs[i], testutil.FakeEmbedding(in[i], 8)) {
			t.Fatalf("input %d: wrong vector", i)
		}
	}
}

// A request the proxy rejects as invalid is retried per document, so only
// the offending document fails.
func TestBatcherIsolatesInvalidDocuments(t *testing.T) {
	b, p, target := newBatcher(t, 64, 200*time.Millisecond)
	p.RejectInputsContaining("POISON")
	errs := make([]error, 3)
	var wg sync.WaitGroup
	for d := 0; d < 3; d++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			in := texts(d, 2)
			if d == 1 {
				in[1] = "POISON"
			}
			_, _, errs[d] = b.Embed(context.Background(), target, in, "u")
		}()
	}
	wg.Wait()
	var ge *gateway.Error
	if errs[0] != nil || errs[2] != nil || !errors.As(errs[1], &ge) || ge.Kind != gateway.KindBadRequest {
		t.Fatalf("errors = %v", errs)
	}
}

// Backpressure reaches every document of the request, with Retry-After; a
// cancelled document stops waiting without affecting the others.
func TestBatcherBackpressureAndCancel(t *testing.T) {
	b, p, target := newBatcher(t, 64, 100*time.Millisecond)
	p.RejectEmbeddings(1, 429, "7")
	errs := make([]error, 3)
	var wg sync.WaitGroup
	for d := 0; d < 3; d++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, errs[d] = b.Embed(context.Background(), target, texts(d, 1), "u")
		}()
	}
	wg.Wait()
	for d, err := range errs {
		var ge *gateway.Error
		if !errors.As(err, &ge) || !ge.Backpressure() || ge.RetryAfter != 7*time.Second {
			t.Fatalf("doc %d: %v", d, err)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := b.Embed(ctx, target, texts(9, 1), "u"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled = %v", err)
	}
	if _, _, err := b.Embed(context.Background(), target, texts(10, 1), "u"); err != nil {
		t.Fatalf("after cancel: %v", err)
	}
}
