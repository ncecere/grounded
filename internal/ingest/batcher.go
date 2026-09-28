package ingest

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/observability"
)

// Batcher coalesces the embedding inputs of the document jobs running in one
// process into shared requests, per embedding profile (DESIGN.md §5.5).
//
// Gateways limit requests, not inputs: a gateway may allow, say, 120
// requests per minute per key, and a request with 64 inputs takes about as
// long as one with a single input. Embedding each document with its own request capped
// ingestion at the request limit (about one short document per request).
// With the batcher, jobs hand their chunks over and wait; a sender per
// profile fills each request with up to MaxInputs inputs from any documents
// that are waiting, and hands each document its vectors back.
//
// Each document job keeps its own status, retries and failure handling: a
// failed request fails every document in it, and each job then decides
// (backpressure: snooze; transient: retry; permanent: fail). A request
// rejected as invalid (4xx) is retried per document, so one bad document
// cannot fail the others.
//
// Batching is bounded by the documents in flight in the process
// (INGEST_CONCURRENCY, and the dispatcher's per-team cap): a request can only
// hold chunks of documents that are processing at the same time.
type Batcher struct {
	MaxInputs int           // inputs per request; default 64 (EMBED_BATCH_SIZE)
	MaxTokens int           // counted tokens per request; 0 = no limit (EMBED_BATCH_TOKENS)
	Linger    time.Duration // how long a partial request waits for more inputs (EMBED_BATCH_WAIT)
	Parallel  int           // requests in flight per profile and process; default 4
	Counter   chunk.TokenCounter
	Log       *slog.Logger

	mu     sync.Mutex
	queues map[string]*embedQueue
}

// EmbedUsage is one document's share of the embedding requests.
type EmbedUsage struct {
	// Reported is the proxy's token count, split across the documents of
	// each request in proportion to Counted; 0 when the proxy reports none.
	Reported int
	// Counted is Grounded's own token count of the inputs.
	Counted int
	// Requests is how many requests carried this document's inputs.
	Requests int
}

type embedCall struct {
	ctx      context.Context
	target   catalog.EmbedTarget
	user     string
	vectors  [][]float32
	pending  int
	reported float64
	counted  int
	requests map[int]bool
	err      error
	closed   bool
	done     chan struct{}
}

type embedItem struct {
	call   *embedCall
	idx    int
	text   string
	tokens int
	at     time.Time
}

type embedQueue struct {
	items   []*embedItem
	running bool
	wake    chan struct{}
	sem     chan struct{}
	seq     int
}

func (b *Batcher) maxInputs() int { return cmp0(b.MaxInputs, 64) }
func (b *Batcher) parallel() int  { return cmp0(b.Parallel, 4) }

func cmp0(v, def int) int {
	if v <= 0 {
		return def
	}
	return v
}

// queueKey groups calls that can share a request: same profile, same model
// revision (the upstream model name and connection may change).
func queueKey(t catalog.EmbedTarget) string {
	return fmt.Sprintf("%s|%s|%d", t.Profile.ID, t.Model.ID, t.Model.Revision)
}

// Embed returns one vector per text, in order, embedding them in requests
// shared with other documents. user tags the request for the proxy's logs.
func (b *Batcher) Embed(ctx context.Context, t catalog.EmbedTarget, texts []string, user string) ([][]float32, EmbedUsage, error) {
	if len(texts) == 0 {
		return nil, EmbedUsage{}, nil
	}
	call := &embedCall{ctx: ctx, target: t, user: user, vectors: make([][]float32, len(texts)),
		pending: len(texts), requests: map[int]bool{}, done: make(chan struct{})}
	now := time.Now()
	items := make([]*embedItem, len(texts))
	for i, text := range texts {
		n := b.Counter.Count(text)
		items[i] = &embedItem{call: call, idx: i, text: text, tokens: n, at: now}
		call.counted += n
	}
	key := queueKey(t)
	b.mu.Lock()
	if b.queues == nil {
		b.queues = map[string]*embedQueue{}
	}
	q := b.queues[key]
	if q == nil {
		q = &embedQueue{wake: make(chan struct{}, 1), sem: make(chan struct{}, b.parallel())}
		b.queues[key] = q
	}
	q.items = append(q.items, items...)
	if !q.running {
		q.running = true
		go b.run(q)
	}
	b.mu.Unlock()
	select {
	case q.wake <- struct{}{}:
	default:
	}

	select {
	case <-ctx.Done():
		return nil, EmbedUsage{}, ctx.Err() // queued items are dropped when seen
	case <-call.done:
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if call.err != nil {
		return nil, EmbedUsage{}, call.err
	}
	return call.vectors, EmbedUsage{Reported: int(math.Round(call.reported)), Counted: call.counted, Requests: len(call.requests)}, nil
}

// finishLocked records err for a call (the first error wins) and wakes it.
func finishLocked(c *embedCall, err error) {
	if c.closed {
		return
	}
	if err != nil {
		c.err = err
	}
	if err != nil || c.pending == 0 {
		c.closed = true
		close(c.done)
	}
}

// live drops items whose document gave up (cancelled or already failed).
func (q *embedQueue) live() {
	kept := q.items[:0]
	for _, it := range q.items {
		if !it.call.closed && it.call.ctx.Err() == nil {
			kept = append(kept, it)
		}
	}
	clear(q.items[len(kept):])
	q.items = kept
}

// full reports whether the queue holds a whole request.
func (b *Batcher) full(q *embedQueue) bool {
	if len(q.items) >= b.maxInputs() {
		return true
	}
	if b.MaxTokens > 0 {
		n := 0
		for _, it := range q.items {
			n += it.tokens
		}
		return n >= b.MaxTokens
	}
	return false
}

// take removes the next request's items from the front of the queue.
func (b *Batcher) take(q *embedQueue) []*embedItem {
	q.live()
	n, tokens := 0, 0
	for n < len(q.items) && n < b.maxInputs() {
		t := q.items[n].tokens
		if b.MaxTokens > 0 && n > 0 && tokens+t > b.MaxTokens {
			break
		}
		tokens += t
		n++
	}
	batch := append([]*embedItem(nil), q.items[:n]...)
	q.items = append(q.items[:0], q.items[n:]...)
	return batch
}

// run is the sender of one queue; it exits when the queue is empty.
func (b *Batcher) run(q *embedQueue) {
	for {
		b.mu.Lock()
		q.live()
		if len(q.items) == 0 {
			q.running = false
			b.mu.Unlock()
			return
		}
		oldest, full, target := q.items[0].at, b.full(q), q.items[0].call.target
		b.mu.Unlock()

		// Wait a little for a fuller request.
		if wait := b.Linger - time.Since(oldest); !full && wait > 0 {
			t := time.NewTimer(wait)
			select {
			case <-q.wake:
			case <-t.C:
			}
			t.Stop()
			continue
		}

		// A request slot: first the process's concurrency, then the
		// connection's request limit. Inputs keep arriving meanwhile and
		// join this request.
		q.sem <- struct{}{}
		ctx := gateway.Background(context.Background())
		if lim := target.Client.Limiter; lim != nil {
			if err := lim.Wait(ctx); err != nil {
				// Rate limited for longer than ingestion waits in process:
				// every waiting document backs off (its job is snoozed).
				b.mu.Lock()
				for _, it := range q.items {
					finishLocked(it.call, err)
				}
				q.items = nil
				b.mu.Unlock()
				<-q.sem
				continue
			}
			ctx = gateway.WithSlot(ctx)
		}
		b.mu.Lock()
		batch := b.take(q)
		q.seq++
		seq := q.seq
		b.mu.Unlock()
		if len(batch) == 0 {
			<-q.sem
			continue
		}
		go func() {
			defer func() { <-q.sem }()
			b.send(ctx, seq, batch)
		}()
	}
}

// send embeds one request and distributes the results.
func (b *Batcher) send(ctx context.Context, seq int, batch []*embedItem) {
	res, err := b.request(ctx, batch)
	var ge *gateway.Error
	if err != nil && errors.As(err, &ge) && (ge.Kind == gateway.KindBadRequest || ge.Kind == gateway.KindBadResponse) {
		if calls := groupByCall(batch); len(calls) > 1 {
			// Find the document the proxy rejected: one request each.
			for _, items := range calls {
				b.send(gateway.Background(context.Background()), seq, items)
			}
			return
		}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if err != nil {
		for _, it := range batch {
			finishLocked(it.call, err)
		}
		return
	}
	counted := 0
	for _, it := range batch {
		counted += it.tokens
	}
	for i, it := range batch {
		c := it.call
		if c.closed {
			continue
		}
		c.vectors[it.idx] = res.Vectors[i]
		c.pending--
		c.requests[seq] = true
		if counted > 0 {
			c.reported += float64(res.Usage.TotalTokens) * float64(it.tokens) / float64(counted)
		}
		finishLocked(c, nil)
	}
}

func (b *Batcher) request(ctx context.Context, batch []*embedItem) (gateway.EmbedResult, error) {
	t := batch[0].call.target
	texts := make([]string, len(batch))
	users := map[string]bool{}
	for i, it := range batch {
		texts[i] = it.text
		users[it.call.user] = true
	}
	user := batch[0].call.user
	if len(users) > 1 {
		user, _, _ = strings.Cut(user, ":") // several teams: "grounded-ingest"
	}
	start := time.Now()
	observability.EmbeddingBatchInputs.Observe(float64(len(texts)))
	res, err := t.Embed(ctx, texts, user)
	if b.Log != nil {
		b.Log.Debug("embedding request", "profile", t.Profile.ID, "inputs", len(texts),
			"documents", len(groupByCall(batch)), "ms", time.Since(start).Milliseconds(), "err", err)
	}
	return res, err
}

func groupByCall(batch []*embedItem) [][]*embedItem {
	idx := map[*embedCall]int{}
	var out [][]*embedItem
	for _, it := range batch {
		i, ok := idx[it.call]
		if !ok {
			i = len(out)
			idx[it.call] = i
			out = append(out, nil)
		}
		out[i] = append(out[i], it)
	}
	return out
}

// teamUser is the proxy "user" tag of ingestion requests for a team.
func teamUser(team uuid.NullUUID) string {
	if team.Valid {
		return "grounded-ingest:" + team.UUID.String()
	}
	return "grounded-ingest"
}
