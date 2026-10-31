package contextual

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
)

// Resolver finds the chat model of a call (catalog.Service).
type Resolver interface {
	ChatTarget(ctx context.Context, modelID uuid.UUID) (catalog.ChatTarget, error)
}

// Wait is a stop that is not a failure: the team's budget or daily quota, or the cap, says not now. The document waits (or the job is
// snoozed) until Until; nothing is lost and nothing falls back.
type Wait struct {
	Code    string
	Until   time.Time
	Message string
}

func (w *Wait) Error() string { return w.Message }

// CapError is a cap that is used up: Daily says which (the day's cap for documents after the build, or the build's).
type CapError struct {
	Daily bool
	Cap   int
	Until time.Time // the next UTC midnight for a daily cap; zero for a build's
}

func (e *CapError) Error() string {
	if e.Daily {
		return fmt.Sprintf("the daily limit of %d model calls for this source is used up", e.Cap)
	}
	return fmt.Sprintf("the limit of %d model calls for this build is used up", e.Cap)
}

// StopError means the work must stop at once and leave things as they were: the job is shutting down, the set was discarded, the source was
// switched off, or the platform switch is off. It is how a checkpoint answers.
type StopError struct {
	Reason string
	Err    error
}

func (e *StopError) Error() string { return "contextual chunks stopped: " + e.Reason }
func (e *StopError) Unwrap() error { return e.Err }

// Request is one document's passages to describe.
type Request struct {
	SourceID, ProfileID, DocumentID uuid.UUID
	Version                         int32 // document version whose passages are being described
	Team, User                      uuid.NullUUID
	// Phase is PhaseBuild while the set is being built, PhaseLive after; Cap is the most attempts the scope may hold and Since starts a live
	// scope's day.
	Phase string
	Cap   int
	Since time.Time
	Model uuid.UUID
	// Policy is PolicyFail or PolicyPlain.
	Policy string
	Title  string
	Chunks []chunk.Chunk
	// Checkpoint is asked before every model call: nil goes on, an error stops (a *StopError, or any other error to report).
	Checkpoint func(ctx context.Context) error
}

// Result is what a document's passages are embedded with.
type Result struct {
	// State is StateContext (Contexts is set), StateTooLarge, or StateFallback (the plain policy, Code says why).
	State string
	Code  Code
	// Contexts has one text per passage, in order.
	Contexts []string
	// Units is how many sections the document has; Calls how many model calls this made; Cached how many sections were already known.
	Units, Calls, Cached int
	TokensIn, TokensOut  int
}

// Generator writes contexts. It makes at most Concurrency model calls at once in a process, as background work under the model
// connection's own limits, and never more calls than the caps allow.
type Generator struct {
	Store       Store
	Catalog     Resolver
	NewProvider func(*gateway.Client) llm.Provider
	Counter     chunk.TokenCounter
	// Gate says whether the team may spend model tokens now (its budget, its daily quota); nil: always.
	Gate func(ctx context.Context, team uuid.UUID) *Wait
	// Concurrency is how many calls run at once in this process (default 2).
	Concurrency int
	// CallTimeout bounds one call (default 2 minutes); the connection's own timeout applies too.
	CallTimeout time.Duration
	// PersistenceTimeout bounds settlement and cache publication after a call, even after caller cancellation.
	// Defaults to 30 seconds; larger values are clamped to that maximum.
	PersistenceTimeout time.Duration
	Log                *slog.Logger

	once    sync.Once
	sem     chan struct{}
	flights sync.Map // flightKey -> *flight
}

type flightKey struct {
	doc uuid.UUID
	key [32]byte
}

type flight struct {
	done chan struct{}
	text string
	err  error
}

func (g *Generator) init() {
	g.once.Do(func() {
		n := g.Concurrency
		if n <= 0 {
			n = 2
		}
		g.sem = make(chan struct{}, n)
	})
}

func (g *Generator) timeout() time.Duration {
	if g.CallTimeout > 0 {
		return g.CallTimeout
	}
	return 2 * time.Minute
}

func (g *Generator) persistenceTimeout() time.Duration {
	if g.PersistenceTimeout > 0 {
		return min(g.PersistenceTimeout, 30*time.Second)
	}
	return 30 * time.Second
}

func (g *Generator) log() *slog.Logger {
	if g.Log != nil {
		return g.Log
	}
	return slog.Default()
}

// Contextualize describes a document's sections, one call each, reusing what is cached. It stops at the first failure (the calls after it
// would not change the outcome), so a failing model costs one attempt per run, not one per section.
func (g *Generator) Contextualize(ctx context.Context, req Request) (Result, error) {
	g.init()
	units := PlanUnits(ItemsOf(req.Chunks))
	res := Result{Units: len(units)}
	if err := requestCheckpoint(ctx, req); err != nil {
		return res, err
	}
	if len(units) > MaxUnitsPerDocument {
		if err := g.Store.RetainCachePlan(ctx, requestCachePlan(req, nil)); err != nil {
			return res, err
		}
		res.State = StateTooLarge
		return res, nil
	}
	target, err := g.Catalog.ChatTarget(ctx, req.Model)
	if err != nil {
		return res, &Failure{Code: CodeForbidden, Err: err, Permanent: true}
	}
	model := generationModel(target)
	opening := Opening(req.Chunks, g.Counter)
	inputs := make([]Input, len(units))
	keys := make([][32]byte, len(units))
	for i, u := range units {
		inputs[i] = BuildInput(req.Title, u.Path, opening, UnitText(req.Chunks, u, g.Counter), g.Counter)
		keys[i] = Key(model, inputs[i])
	}
	plan := requestCachePlan(req, keys)
	if err := g.Store.RetainCachePlan(ctx, plan); err != nil {
		return res, err
	}
	known, err := g.Store.CacheFor(ctx, req.DocumentID, keys)
	if err != nil {
		return res, err
	}
	texts := make([]string, len(units))
	for i := range units {
		if t, ok := known[keys[i]]; ok {
			texts[i], res.Cached = t, res.Cached+1
			continue
		}
		c, err := g.one(ctx, req, model, inputs[i], keys[i])
		if c.made {
			res.Calls++
		}
		res.TokensIn, res.TokensOut = res.TokensIn+c.in, res.TokensOut+c.out
		if err != nil {
			return g.apply(req, res, err)
		}
		texts[i] = c.text
	}
	if _, err := g.currentTarget(ctx, req, model); err != nil {
		return res, err
	}
	if err := g.Store.RetainCachePlan(ctx, plan); err != nil {
		return res, err
	}
	if _, err := g.currentTarget(ctx, req, model); err != nil {
		return res, err
	}
	res.State, res.Contexts = StateContext, make([]string, len(req.Chunks))
	for i, u := range units {
		for j := u.First; j <= u.Last; j++ {
			res.Contexts[j] = texts[i]
		}
	}
	return res, nil
}

// apply decides what a failed call means for the document: a wait, a stop and a model that is unreachable go up as they are; a reply that
// cannot be used (or a model that rejects the request) is the document's failure under the fail policy and a marked fallback under plain.
func (g *Generator) apply(req Request, res Result, err error) (Result, error) {
	var f *Failure
	if errors.As(err, &f) && f.Permanent && req.Policy == PolicyPlain {
		res.State, res.Code, res.Contexts = StateFallback, f.Code, nil
		return res, nil
	}
	return res, err
}

// one makes the call for one section, once at a time per key in this process: concurrent documents, retries and profiles wait for the call
// that is running instead of making their own.
func (g *Generator) one(ctx context.Context, req Request, m Model, in Input, key [32]byte) (flightResult, error) {
	fk := flightKey{req.DocumentID, key}
	for {
		f := &flight{done: make(chan struct{})}
		if prior, loaded := g.flights.LoadOrStore(fk, f); loaded {
			p := prior.(*flight)
			select {
			case <-p.done:
			case <-ctx.Done():
				return flightResult{}, &StopError{Reason: "cancelled", Err: ctx.Err()}
			}
			var stop *StopError
			if p.err != nil && errors.As(p.err, &stop) && ctx.Err() == nil {
				continue // the call we waited for was stopped for its own reasons: make it ourselves
			}
			return flightResult{text: p.text}, p.err // the leader's attempt is counted in the leader's result
		}
		c, err := g.call(ctx, req, m, in, key)
		f.text, f.err = c.text, err
		g.flights.Delete(fk)
		close(f.done)
		return c, err
	}
}

type flightResult struct {
	text    string
	in, out int
	// made: this call sent a request (an attempt that counts), as opposed to finding the text cached or waiting for another call.
	made bool
}

// call is one attempt: checkpoint, gate, cap, request, settle, cache.
func (g *Generator) call(ctx context.Context, req Request, m Model, in Input, key [32]byte) (flightResult, error) {
	var zero flightResult
	// Take a slot first: a long wait for one must not end in a call the checkpoint would no longer allow.
	select {
	case g.sem <- struct{}{}:
		defer func() { <-g.sem }()
	case <-ctx.Done():
		return zero, &StopError{Reason: "cancelled", Err: ctx.Err()}
	}
	target, err := g.currentTarget(ctx, req, m)
	if err != nil {
		return zero, err
	}
	// Another process, or an earlier run, may have made it meanwhile.
	if known, err := g.Store.CacheFor(ctx, req.DocumentID, [][32]byte{key}); err != nil {
		return zero, err
	} else if text, ok := known[key]; ok {
		return flightResult{text: text}, nil
	}
	if err := g.checkPromptCapacity(target, in); err != nil {
		return zero, err
	}
	if g.Gate != nil && req.Team.Valid {
		if w := g.Gate(ctx, req.Team.UUID); w != nil {
			return zero, w
		}
	}
	id, err := g.Store.Reserve(ctx, Reservation{SourceID: req.SourceID, ProfileID: req.ProfileID, DocumentID: req.DocumentID, ModelID: m.ID,
		Phase: req.Phase, Cap: req.Cap, Since: req.Since,
		InputTokens: g.promptInputTokens(in), OutputTokens: RequestMaxTokens})
	var admission *AdmissionLimit
	if errors.As(err, &admission) {
		return zero, &Wait{Code: "contextual_cap", Until: admission.Until, Message: admission.Error()}
	}
	if errors.Is(err, ErrCapReached) {
		return zero, &CapError{Daily: req.Phase == PhaseLive, Cap: req.Cap, Until: nextDay(req.Since)}
	} else if err != nil {
		return zero, err
	}
	return g.dispatch(ctx, req, m, in, key, id)
}

// nextDay is the UTC midnight after a live scope's day started (zero for a build's scope).
func nextDay(since time.Time) time.Time {
	if since.IsZero() {
		return time.Time{}
	}
	return since.UTC().Add(24 * time.Hour)
}

// send makes the request and settles the attempt, whatever happens: the settlement outlives a cancelled context.
func (g *Generator) send(ctx context.Context, req Request, t catalog.ChatTarget, m Model, in Input, key [32]byte, id int64) (flightResult, error) {
	zero := flightResult{made: true}
	callCtx, cancel := context.WithTimeout(gateway.Background(ctx), g.timeout())
	defer cancel()
	provider := g.provider(t.Client)
	user := userTag(req.Team)
	msg, err := llm.Complete(callCtx, provider, llm.ModelFromRow(t.Model),
		llm.Context{SystemPrompt: SystemPrompt, Messages: []llm.Message{llm.UserMessage{Content: UserMessage(in)}}},
		llm.Options{MaxTokens: RequestMaxTokens, ReasoningEffort: "off", User: user})
	settle := func(s Settlement) error {
		s.ID = id
		sctx, stop := context.WithTimeout(context.WithoutCancel(ctx), g.persistenceTimeout())
		defer stop()
		return g.Store.Settle(sctx, s)
	}
	if err != nil {
		zero.made = !provenUnsentBackpressure(err)
		return zero, g.failed(ctx, callCtx, id, err, settle)
	}
	tokensIn, tokensOut, reported := reportedUsage(msg.Usage)
	usage := &Usage{Team: req.Team, User: req.User, Source: req.SourceID, Document: req.DocumentID, Model: m.ID, Phase: req.Phase, Reported: reported,
		TokensIn: tokensIn, TokensOut: tokensOut}
	if !reported {
		// The gateway sent no usage: the ledger gets Grounded's own count, flagged, and the attempt stays "unknown" in its own row.
		usage.TokensIn = g.Counter.Count(SystemPrompt) + g.Counter.Count(UserMessage(in))
		usage.TokensOut = g.Counter.Count(msg.Text())
	}
	text, cerr := Clean(msg.Text(), g.Counter)
	switch {
	case errors.Is(cerr, ErrRefused):
		return zero, g.unusable(settle, OutcomeRefused, cerr, usage, reported)
	case cerr != nil:
		return zero, g.unusable(settle, OutcomeInvalid, cerr, usage, reported)
	}
	// The call was paid for (its usage is recorded), but if the source was switched off or the set discarded while it was in flight its text
	// is not kept: what a stopped run made is cleaned up, not left behind.
	if _, err := g.currentTarget(ctx, req, m); err != nil {
		_ = settle(Settlement{Outcome: OutcomeOK, TokensIn: reportedPtr(tokensIn, reported), TokensOut: reportedPtr(tokensOut, reported), Usage: usage})
		return zero, err
	}
	if err := ctx.Err(); err != nil {
		_ = settle(Settlement{Outcome: OutcomeOK, TokensIn: reportedPtr(tokensIn, reported), TokensOut: reportedPtr(tokensOut, reported), Usage: usage})
		return zero, &StopError{Reason: "cancelled", Err: err}
	}
	entry := &CacheEntry{DocumentID: req.DocumentID, SourceID: req.SourceID, ProfileID: req.ProfileID, Version: req.Version, Key: key, Text: text,
		TokensIn: reportedPtr(tokensIn, reported), TokensOut: reportedPtr(tokensOut, reported)}
	if err := settle(Settlement{Outcome: OutcomeOK, TokensIn: entry.TokensIn, TokensOut: entry.TokensOut, Usage: usage, Cache: entry}); err != nil {
		return zero, err
	}
	return flightResult{text: text, in: usage.TokensIn, out: usage.TokensOut, made: true}, nil
}

func (g *Generator) provider(c *gateway.Client) llm.Provider {
	if g.NewProvider != nil {
		return g.NewProvider(c)
	}
	return llm.NewOpenAI(c)
}

// userTag is the OpenAI "user" field of a call, so the gateway's own report can be matched to the ledger. It carries the team, never a
// document or a person.
func userTag(team uuid.NullUUID) string {
	if !team.Valid {
		return "grounded-contextual-platform"
	}
	return "grounded-contextual-" + team.UUID.String()
}

// reportedUsage accepts complete representable counts, not invented zeroes.
func reportedUsage(u llm.Usage) (in, out int, reported bool) {
	// The adapter's scalar counters cannot distinguish an omitted field from
	// zero. A real prompt and a usable prefix both cost tokens: partial, zero,
	// negative or unrepresentable counts must not release unknown headroom.
	known := u.Input > 0 && u.Output > 0 && u.Input <= math.MaxInt32 && u.Output <= math.MaxInt32
	return u.Input, u.Output, known
}

func reportedPtr(n int, reported bool) *int32 {
	if !reported {
		return nil
	}
	v := int32(n)
	return &v
}

// unusable settles an attempt whose reply could not be used: it was billed, so its usage is recorded, and it counts.
func (g *Generator) unusable(settle func(Settlement) error, outcome string, cause error, u *Usage, reported bool) error {
	if err := settle(Settlement{Outcome: outcome, TokensIn: reportedPtr(u.TokensIn, reported), TokensOut: reportedPtr(u.TokensOut, reported), Usage: u}); err != nil {
		return err
	}
	return &Failure{Code: CodeInvalid, Err: cause, Permanent: true}
}

// provenUnsentBackpressure is the gateway's local limiter refusal, before HTTP.
// A remote status cannot establish whether processing or billing happened.
func provenUnsentBackpressure(err error) bool {
	var ge *gateway.Error
	return errors.As(err, &ge) && ge.Kind == gateway.KindRateLimited && ge.Status == 0
}

// failed settles an attempt whose request failed, and says what that means.
func (g *Generator) failed(ctx, callCtx context.Context, id int64, err error, settle func(Settlement) error) error {
	var ge *gateway.Error
	switch {
	case ctx.Err() != nil:
		// We stopped it: whether the provider billed it is unknown.
		_ = settle(Settlement{Outcome: OutcomeCancelled})
		return &StopError{Reason: "cancelled", Err: ctx.Err()}
	case provenUnsentBackpressure(err):
		// Only the local limiter proves no request was sent: release its headroom.
		rctx, stop := context.WithTimeout(context.WithoutCancel(ctx), g.persistenceTimeout())
		defer stop()
		if rerr := g.Store.Release(rctx, id); rerr != nil {
			g.log().WarnContext(ctx, "could not release a refused contextual call", "call", id, "err", rerr)
		}
		return err
	case errors.As(err, &ge) && ge.Backpressure():
		// Preserve backpressure/snooze behavior, but retain unknown admission for
		// a remote 429/503: no response proves that it was unprocessed/unbilled.
		_ = settle(Settlement{Outcome: OutcomeError})
		return &gateway.Error{Kind: ge.Kind, Status: ge.Status, RetryAfter: ge.RetryAfter, Message: "The context model asked to retry later"}
	case callCtx.Err() != nil || (errors.As(err, &ge) && ge.TimedOut()):
		// No answer in time. The provider may still have processed and billed it; Grounded cannot know.
		_ = settle(Settlement{Outcome: OutcomeTimeout})
		return &Failure{Code: CodeUnavailable, Err: err}
	}
	_ = settle(Settlement{Outcome: OutcomeError})
	if errors.As(err, &ge) && (ge.Kind == gateway.KindAuth || ge.Kind == gateway.KindNotFound || ge.Kind == gateway.KindBadRequest) {
		return &Failure{Code: CodeModelError, Err: err, Permanent: true}
	}
	return &Failure{Code: CodeUnavailable, Err: err}
}
