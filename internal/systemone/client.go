package systemone

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/tracing"
)

// DefaultMaxConcurrent is a connection's default max_concurrent_requests:
// a GPU serves judgments largely one after another, so more parallel
// requests only queue upstream (ADR-0020).
const DefaultMaxConcurrent = 8

// Client asks one SystemOne model questions. It is cheap to build; the
// concurrency cap is shared by every client of the same connection in this
// process.
type Client struct {
	GW      *gateway.Client
	Model   string    // upstream model, e.g. openjev-latest
	ModelID uuid.UUID // catalog model, for usage events
	slots   *slots
}

// NewClient returns a client for a model on a connection allowing
// maxConcurrent requests at once (0 = DefaultMaxConcurrent). The
// connection's gateway client carries its pacer, so 429, 529 and 503 with
// Retry-After pause every caller of the connection.
func NewClient(gw *gateway.Client, model string, modelID, connectionID uuid.UUID, maxConcurrent int) *Client {
	return &Client{GW: gw, Model: model, ModelID: modelID, slots: slotsFor(connectionID, maxConcurrent)}
}

// Call describes one request: the feature it serves (usage events and
// logs) and its timeout, which starts once a concurrency slot is free
// (0 = none beyond ctx and the connection timeout).
type Call struct {
	Feature string
	Timeout time.Duration
}

// UsageKind is the usage ledger kind of SystemOne input tokens.
const UsageKind = "systemone_tokens"

// RequestsKind is the usage ledger kind of answered SystemOne requests (for
// per-request prices, docs/costs.md §2).
const RequestsKind = "systemone_requests"

// UsageParams are a meter entry's usage events: its input tokens and its
// answered requests, each when non-zero. The caller adds the team, agent,
// user and key.
func (e MeterEntry) UsageParams(meta []byte) []dbgen.InsertUsageParams {
	var out []dbgen.InsertUsageParams
	model := uuid.NullUUID{UUID: e.ModelID, Valid: e.ModelID != uuid.Nil}
	if e.InputTokens > 0 {
		out = append(out, dbgen.InsertUsageParams{Kind: UsageKind, Quantity: e.InputTokens, ModelID: model, Metadata: meta})
	}
	if e.Requests > 0 {
		out = append(out, dbgen.InsertUsageParams{Kind: RequestsKind, Quantity: e.Requests, ModelID: model, Metadata: meta})
	}
	return out
}

// Features (usage event metadata).
const (
	FeatureModeration = "moderation"
	FeatureJudging    = "judging"
	FeatureCitations  = "citations"
	FeatureScope      = "scope"
	FeatureTest       = "test"
)

// Ask sends the state and questions and returns the validated answers.
// Waiting for a slot is bounded by ctx; the call itself by c.Timeout.
func (cl *Client) Ask(ctx context.Context, c Call, state any, qs map[string]Question) (res Response, err error) {
	ctx, span := tracing.StartKind(ctx, "systemone "+c.Feature, trace.SpanKindClient, attribute.String("grounded.systemone.feature", c.Feature),
		attribute.String("gen_ai.request.model", cl.Model), attribute.Int("grounded.systemone.questions", len(qs)))
	defer func() {
		span.SetAttributes(attribute.Int("gen_ai.usage.input_tokens", res.Usage.InputTokens))
		if err != nil {
			tracing.Fail(span, requestOutcome(err))
		}
		span.End()
	}()
	release, err := cl.slots.acquire(ctx)
	if err != nil {
		return Response{}, err
	}
	defer release()
	if c.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}
	start := time.Now()
	err = cl.GW.PostJSON(ctx, Path(cl.GW.BaseURL), Request{State: state, Model: cl.Model, Questions: qs}, &res)
	if err == nil {
		err = Validate(qs, &res)
	}
	observability.ObserveSystemOne(c.Feature, requestOutcome(err), time.Since(start))
	if m := meterFrom(ctx); m != nil {
		m.add(cl.ModelID, c.Feature, res.Usage.InputTokens, err == nil)
	}
	return res, err
}

// ---- per-connection concurrency ------------------------------------------------

// slots is a connection's concurrency cap within this process.
type slots struct {
	ch chan struct{}
}

var (
	slotsMu sync.Mutex
	slotMap = map[uuid.UUID]*slots{}
)

// slotsFor returns the connection's cap, replacing it when the configured
// size changed (requests holding an old slot release it to the old cap).
func slotsFor(conn uuid.UUID, n int) *slots {
	if n <= 0 {
		n = DefaultMaxConcurrent
	}
	slotsMu.Lock()
	defer slotsMu.Unlock()
	s, ok := slotMap[conn]
	if !ok || cap(s.ch) != n {
		s = &slots{ch: make(chan struct{}, n)}
		slotMap[conn] = s
	}
	return s
}

func (s *slots) acquire(ctx context.Context) (func(), error) {
	select {
	case s.ch <- struct{}{}:
		return func() { <-s.ch }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// ---- usage -------------------------------------------------------------------------

// Meter adds up the input tokens of SystemOne requests made with a context
// carrying it (WithMeter), by model and feature. The chat pipeline records
// its entries as systemone_tokens usage events with the answer.
type Meter struct {
	mu      sync.Mutex
	entries map[meterKey]*MeterEntry
}

type meterKey struct {
	model   uuid.UUID
	feature string
}

// MeterEntry is one model and feature's use.
type MeterEntry struct {
	ModelID     uuid.UUID
	Feature     string
	InputTokens int64
	Requests    int64 // answered requests
	Failed      int64 // failed requests
}

type meterCtxKey struct{}

// WithMeter returns ctx carrying m.
func WithMeter(ctx context.Context, m *Meter) context.Context {
	return context.WithValue(ctx, meterCtxKey{}, m)
}

func meterFrom(ctx context.Context) *Meter {
	m, _ := ctx.Value(meterCtxKey{}).(*Meter)
	return m
}

func (m *Meter) add(model uuid.UUID, feature string, tokens int, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entries == nil {
		m.entries = map[meterKey]*MeterEntry{}
	}
	k := meterKey{model, feature}
	e, found := m.entries[k]
	if !found {
		e = &MeterEntry{ModelID: model, Feature: feature}
		m.entries[k] = e
	}
	e.InputTokens += int64(tokens)
	if ok {
		e.Requests++
	} else {
		e.Failed++
	}
}

// Entries returns the use so far.
func (m *Meter) Entries() []MeterEntry {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]MeterEntry, 0, len(m.entries))
	for _, e := range m.entries {
		out = append(out, *e)
	}
	return out
}

// requestOutcome is a request's outcome for metrics: ok, timeout or error.
func requestOutcome(err error) string {
	switch {
	case err == nil:
		return "ok"
	case IsTimeout(err):
		return "timeout"
	default:
		return "error"
	}
}

// IsTimeout reports whether err is a timeout or cancellation rather than
// an answer from the service.
func IsTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	var ge *gateway.Error
	return errors.As(err, &ge) && ge.TimedOut()
}
