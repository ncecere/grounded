package rerank

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/tracing"
)

// Plan is the platform's reranking for one search or chat.
type Plan struct {
	Client     *gateway.Client
	Model      dbgen.Model
	Candidates int
	TimeLimit  time.Duration
	ranks      map[string]int32 // classification key → rank
}

// Allows reports whether the rerank model may read passages of a
// classification (ADR-0006 rule 4: its maximum classification ranks at
// least as high). "" (a knowledge base without sources) is allowed.
func (p *Plan) Allows(classification string) bool {
	if classification == "" {
		return true
	}
	level, ok := p.ranks[classification]
	ceiling, ok2 := p.ranks[p.Model.MaxClassification]
	return ok && ok2 && ceiling >= level
}

// Fetch is how many candidates a search asks for to keep k after
// reranking: the platform's candidate count, or k when that is more.
func (p *Plan) Fetch(k int) int { return min(max(k, p.Candidates), MaxDocuments) }

// Outcome statuses.
const (
	StatusOK      = "ok"
	StatusTimeout = "timeout" // the time limit passed: the fusion order is kept
	StatusError   = "error"   // the call failed: the fusion order is kept
	// StatusSkipped: the rerank model may not read this classification.
	StatusSkipped = "skipped"
)

// Callers (metrics and spans).
const (
	CallerAgent      = "agent"
	CallerRetrieve   = "retrieve"
	CallerEvaluation = "evaluation"
)

// Outcome is one search's reranking. When Status is ok, Order lists the
// scored documents by index, best first, and Scores holds their scores;
// otherwise the caller keeps the fusion order (fail open).
type Outcome struct {
	Status  string
	Order   []int
	Scores  map[int]float64
	Latency time.Duration
}

// OK reports whether the documents were reranked.
func (o Outcome) OK() bool { return o.Status == StatusOK }

// Rerank scores docs against query in one call bounded by the time limit,
// asking for the best topN (0 = all). It never fails: an error or timeout
// is reported in the outcome, logged by the caller's span and metrics, and
// the caller keeps its order.
func (p *Plan) Rerank(ctx context.Context, caller, query string, docs []string, topN int) (out Outcome) {
	ctx, span := tracing.Start(ctx, "rerank", attribute.String("grounded.rerank.caller", caller),
		attribute.Int("grounded.rerank.candidates", len(docs)), attribute.Int64("grounded.rerank.time_limit_ms", p.TimeLimit.Milliseconds()))
	start := time.Now()
	defer func() {
		out.Latency = time.Since(start)
		span.SetAttributes(attribute.String("grounded.rerank.status", out.Status), attribute.Int("grounded.rerank.kept", len(out.Order)))
		if out.Status == StatusError || out.Status == StatusTimeout {
			tracing.Fail(span, out.Status)
		}
		span.End()
		observability.ObserveRerank(caller, out.Status, out.Latency)
	}()
	if len(docs) == 0 {
		return Outcome{Status: StatusOK, Scores: map[int]float64{}}
	}
	docs = p.fit(query, docs)
	rctx, cancel := context.WithTimeout(ctx, p.TimeLimit)
	defer cancel()
	res, err := p.Client.Rerank(rctx, catalog.RerankRequest(p.Model, query, docs, topN, ""))
	tokens := res.Tokens
	if err == nil && tokens == 0 {
		tokens = estimate(query, docs)
	}
	if m := meterFrom(ctx); m != nil {
		m.add(p.Model.ID, tokens, err == nil)
	}
	switch {
	case err != nil && isTimeout(rctx, err):
		return Outcome{Status: StatusTimeout}
	case err != nil:
		return Outcome{Status: StatusError}
	}
	return ranked(res.Scores)
}

// Skip records a search that wasn't reranked because the rerank model may
// not read its passages (Allows).
func Skip(caller string) Outcome {
	observability.ObserveRerank(caller, StatusSkipped, 0)
	return Outcome{Status: StatusSkipped}
}

// ranked orders the scores best first (ties by the fusion order).
func ranked(scores []gateway.RerankScore) Outcome {
	sort.SliceStable(scores, func(i, j int) bool {
		if scores[i].Score != scores[j].Score {
			return scores[i].Score > scores[j].Score
		}
		return scores[i].Index < scores[j].Index
	})
	out := Outcome{Status: StatusOK, Order: make([]int, len(scores)), Scores: make(map[int]float64, len(scores))}
	for i, s := range scores {
		out.Order[i], out.Scores[s.Index] = s.Index, s.Score
	}
	return out
}

func isTimeout(ctx context.Context, err error) bool {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ge *gateway.Error
	return errors.As(err, &ge) && ge.TimedOut()
}

// fit trims documents to the model's maximum input tokens (query and
// passage together; an estimate of 4 characters per token), so a long
// passage isn't refused.
func (p *Plan) fit(query string, docs []string) []string {
	if p.Model.MaxInputTokens == nil {
		return docs
	}
	limit := max(int(*p.Model.MaxInputTokens)-tokensOf(query)-16, 32) * 4
	out, copied := docs, false
	for i, d := range docs {
		if utf8.RuneCountInString(d) <= limit {
			continue
		}
		if !copied {
			out, copied = append([]string(nil), docs...), true
		}
		out[i] = string([]rune(d)[:limit])
	}
	return out
}

func tokensOf(s string) int { return (utf8.RuneCountInString(s) + 3) / 4 }

// estimate is the tokens a cross-encoder reads when the server reports
// none: the query with each passage.
func estimate(query string, docs []string) int {
	n := 0
	for _, d := range docs {
		n += tokensOf(query) + tokensOf(d)
	}
	return n
}

// ---- usage -------------------------------------------------------------------------

// Ledger kinds of rerank use (priced per million tokens and per request,
// internal/costs).
const (
	UsageTokens   = "rerank_tokens"
	UsageRequests = "rerank_requests"
)

// Meter adds up the rerank requests made with a context carrying it
// (WithMeter), by model, for the usage events recorded with the query or
// answer.
type Meter struct {
	mu      sync.Mutex
	entries map[uuid.UUID]*MeterEntry
}

// MeterEntry is one model's use.
type MeterEntry struct {
	ModelID  uuid.UUID
	Tokens   int64
	Requests int64 // answered requests
	Failed   int64
}

type meterKey struct{}

// WithMeter returns ctx carrying m.
func WithMeter(ctx context.Context, m *Meter) context.Context { return context.WithValue(ctx, meterKey{}, m) }

func meterFrom(ctx context.Context) *Meter {
	m, _ := ctx.Value(meterKey{}).(*Meter)
	return m
}

func (m *Meter) add(model uuid.UUID, tokens int, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entries == nil {
		m.entries = map[uuid.UUID]*MeterEntry{}
	}
	e, found := m.entries[model]
	if !found {
		e = &MeterEntry{ModelID: model}
		m.entries[model] = e
	}
	if ok {
		e.Tokens += int64(tokens)
		e.Requests++
	} else {
		e.Failed++
	}
}

// Usage returns the usage events of the use so far (tokens and answered
// requests, each when non-zero), with meta as their metadata. The caller
// adds the team, agent, user and key.
func (m *Meter) Usage(meta []byte) []dbgen.InsertUsageParams {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []dbgen.InsertUsageParams
	for _, e := range m.entries {
		model := uuid.NullUUID{UUID: e.ModelID, Valid: e.ModelID != uuid.Nil}
		if e.Tokens > 0 {
			out = append(out, dbgen.InsertUsageParams{Kind: UsageTokens, Quantity: e.Tokens, ModelID: model, Metadata: meta})
		}
		if e.Requests > 0 {
			out = append(out, dbgen.InsertUsageParams{Kind: UsageRequests, Quantity: e.Requests, ModelID: model, Metadata: meta})
		}
	}
	return out
}
