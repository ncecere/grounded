package contextual

import (
	"context"
	"errors"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Price is a chat model's price in effect: per million input and output tokens. Known is false when either is missing, and then no
// amount is ever computed from it.
type Price struct {
	Known                             bool
	Currency                          string
	InputPerMillion, OutputPerMillion *big.Rat
}

// Pricer finds a model's price (the costs service, adapted by the app).
type Pricer func(ctx context.Context, a authz.Actor, modelID uuid.UUID) (Price, error)

// Issue is a blocker or a warning.
type Issue struct{ Code, Message string }

// Cost is a ceiling in money, or why there is none.
type Cost struct {
	PriceKnown bool
	Currency   string
	// Input and output price per million tokens, as decimal strings (empty when unknown), and the ceiling of this estimate.
	InputPerMillion, OutputPerMillion string
	MaxAmount                         string
}

// SourceEstimate is what contextual chunks would involve for one source.
type SourceEstimate struct {
	SourceID       uuid.UUID
	Name           string
	Classification string
	Enabled        bool
	Model          uuid.NullUUID
	ModelName      string
	Totals
	// CachedContexts are contexts already generated for the source (informational: calls is a ceiling that does not subtract them).
	CachedContexts int64
	MaxCalls       int
	MaxCallsPerDay int
	Admission      *Admission
	// UnknownCallTokensIn and Out bound what one attempt of unknown usage (a timeout) may have cost.
	UnknownCallTokensIn, UnknownCallTokensOut int
	Cost                                      Cost
	Blockers                                  []Issue
}

// EstimateInput is what an estimate may be asked for besides the source: a model to price instead of the source's.
type EstimateInput struct{ ModelID *uuid.UUID }

// EstimateSource estimates one source (platform admins and auditors, in a session). It reads the source's stored passages' sizes and
// heading paths (no text), makes no model call and writes nothing.
func (s *Service) EstimateSource(ctx context.Context, a authz.Actor, sourceID uuid.UUID, in EstimateInput) (SourceEstimate, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return SourceEstimate{}, errReadOnly
	}
	return s.estimate(ctx, a, sourceID, in.ModelID)
}

// estimate plans a source from its own profile's passages.
func (s *Service) estimate(ctx context.Context, a authz.Actor, sourceID uuid.UUID, override *uuid.UUID) (SourceEstimate, error) {
	src, err := s.q.GetSource(ctx, sourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return SourceEstimate{}, errNoSource
	} else if err != nil {
		return SourceEstimate{}, err
	}
	var row *dbgen.SourceContextual
	if r, err := s.q.GetSourceContextual(ctx, sourceID); err == nil {
		row = &r
	} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return SourceEstimate{}, err
	}
	set := settingsOf(sourceID, row)
	est := SourceEstimate{SourceID: sourceID, Name: src.Name, Classification: src.Classification, Enabled: set.Enabled, Model: set.ModelID,
		MaxCalls: set.MaxCalls, MaxCallsPerDay: set.MaxCallsPerDay, Admission: set.Admission}
	if override != nil {
		est.Model = uuid.NullUUID{UUID: *override, Valid: true}
	}
	totals, err := planSource(ctx, s.Pool, sourceID, src.EmbeddingProfileID, s.Counter)
	if err != nil {
		return est, err
	}
	est.Totals = totals
	est.UnknownCallTokensIn, est.UnknownCallTokensOut = unknownCallTokensMax(s.Counter)
	if est.CachedContexts, err = s.q.CountSourceContextualCache(ctx, sourceID); err != nil {
		return est, err
	}
	s.blockers(ctx, &est)
	if err := s.price(ctx, a, &est); err != nil {
		return est, err
	}
	admissionEstimateBlockers(&est)
	return est, nil
}

func (s *Service) blockers(ctx context.Context, est *SourceEstimate) {
	add := func(code, msg string) { est.Blockers = append(est.Blockers, Issue{code, msg}) }
	if !s.platformOn() {
		add("platform_off", errSwitchedOff.Message)
	}
	var id *uuid.UUID
	if est.Model.Valid {
		id = &est.Model.UUID
		if m, err := s.q.GetModel(ctx, est.Model.UUID); err == nil {
			est.ModelName = m.DisplayName
		}
	}
	if p := modelProblem(ctx, s.q, id, est.Classification); p != nil {
		add(p.Code, p.Message)
	}
	if est.Calls > int64(est.MaxCalls) {
		add("calls_over_cap", "This source needs up to "+itoa64(est.Calls)+" model calls to build, more than its limit of "+itoa64(int64(est.MaxCalls))+". Raise the limit to build it.")
	}
}

func itoa64(n int64) string { return big.NewInt(n).String() }

// price fills in the cost ceiling when the model's prices are known, and says so when they are not: an amount is never invented.
func (s *Service) price(ctx context.Context, a authz.Actor, est *SourceEstimate) error {
	if !est.Model.Valid || s.Price == nil {
		return nil
	}
	p, err := s.Price(ctx, a, est.Model.UUID)
	if err != nil {
		var ae *apperr.Error
		if errors.As(err, &ae) {
			return nil // costs are not readable here: unknown
		}
		return err
	}
	est.Cost.Currency = p.Currency
	if !p.Known || p.InputPerMillion == nil || p.OutputPerMillion == nil {
		return nil
	}
	est.Cost.PriceKnown = true
	est.Cost.InputPerMillion, est.Cost.OutputPerMillion = p.InputPerMillion.FloatString(6), p.OutputPerMillion.FloatString(6)
	million := big.NewRat(1_000_000, 1)
	in := new(big.Rat).Mul(new(big.Rat).SetInt64(est.InputTokensMax), p.InputPerMillion)
	out := new(big.Rat).Mul(new(big.Rat).SetInt64(est.OutputTokensMax), p.OutputPerMillion)
	amount := new(big.Rat).Quo(in.Add(in, out), million)
	// Each attempt rounds admission up separately. Account for that rounding
	// across the call ceiling rather than presenting a smaller aggregate price.
	if amount.Sign() > 0 && est.Calls > 1 {
		amount.Add(amount, big.NewRat(est.Calls-1, 1_000_000))
	}
	est.Cost.MaxAmount = ceilAmount(amount)
	return nil
}

// KBEstimate is the estimate of a knowledge base's opted-in sources.
type KBEstimate struct {
	KBID    uuid.UUID
	Sources []SourceEstimate
	// Skipped are the sources that did not opt in (they are embedded as they are).
	Skipped []uuid.UUID
	Totals
	Cost     Cost
	Blockers []Issue
}

// EstimateKB estimates a knowledge base's contextual preview: the sources that opted in (platform admins and auditors, in a session).
func (s *Service) EstimateKB(ctx context.Context, a authz.Actor, kbID uuid.UUID) (KBEstimate, error) {
	if a.Key != nil || !a.CanReadPlatform() {
		return KBEstimate{}, errReadOnly
	}
	return s.KBPlan(ctx, a, kbID, nil)
}

// KBPlan estimates the opted-in sources of a knowledge base that the profile migration's preflight is about to build (skip, when set,
// names the ones already embedded for the target: nothing is made for them).
func (s *Service) KBPlan(ctx context.Context, a authz.Actor, kbID uuid.UUID, skip func(uuid.UUID) bool) (KBEstimate, error) {
	out := KBEstimate{KBID: kbID}
	rows, err := s.q.KBContextualSources(ctx, kbID)
	if err != nil {
		return out, err
	}
	optedIn := map[uuid.UUID]bool{}
	for _, r := range rows {
		optedIn[r.SourceID] = true
	}
	all, err := s.q.KBSources(ctx, kbID)
	if err != nil {
		return out, err
	}
	for _, src := range all {
		if !optedIn[src.ID] {
			out.Skipped = append(out.Skipped, src.ID)
		}
	}
	var priced []SourceEstimate
	for _, r := range rows {
		if skip != nil && skip(r.SourceID) {
			continue // already embedded for the profile
		}
		e, err := s.estimate(ctx, a, r.SourceID, nil)
		if err != nil {
			return out, err
		}
		out.Sources = append(out.Sources, e)
		out.Totals.Merge(e.Totals)
		out.Blockers = append(out.Blockers, e.Blockers...)
		priced = append(priced, e)
	}
	out.Cost = sumCost(priced)
	if len(rows) == 0 {
		out.Blockers = append(out.Blockers, Issue{"no_opted_in_sources", "None of the knowledge base's sources has opted in to contextual chunks. Turn it on for a source first."})
	}
	return out, nil
}

// sumCost adds the sources' ceilings; the total is unknown as soon as one source's is.
func sumCost(list []SourceEstimate) Cost {
	c := Cost{PriceKnown: len(list) > 0}
	total := new(big.Rat)
	for _, e := range list {
		if !e.Cost.PriceKnown {
			return Cost{Currency: e.Cost.Currency}
		}
		if c.Currency != "" && c.Currency != e.Cost.Currency {
			return Cost{} // concurrent currency changes cannot silently relabel a sum
		}
		c.Currency = e.Cost.Currency
		r, ok := new(big.Rat).SetString(e.Cost.MaxAmount)
		if !ok {
			return Cost{Currency: e.Cost.Currency}
		}
		total.Add(total, r)
	}
	if c.PriceKnown {
		c.MaxAmount = total.FloatString(6)
	}
	return c
}

// planSource plans a source's calls from the stored passages of one profile: sizes and heading paths only, in document order, one document
// in memory at a time. Bounded by the number of passages, with a time limit.
func planSource(ctx context.Context, pool queryer, sourceID, profileID uuid.UUID, c chunk.TokenCounter) (Totals, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	rows, err := pool.Query(ctx, `SELECT c.document_id, c.heading_path, c.token_count
FROM chunks c JOIN documents d ON d.id = c.document_id AND d.status = 'ready'
WHERE c.source_id = $1 AND c.profile_id = $2
ORDER BY c.document_id, c.ordinal`, sourceID, profileID)
	if err != nil {
		return Totals{}, err
	}
	defer rows.Close()
	var (
		t     Totals
		cur   uuid.UUID
		items []Item
	)
	flush := func() {
		if len(items) > 0 {
			t.Add(planDocument(items, c))
			items = items[:0]
		}
	}
	for rows.Next() {
		var doc uuid.UUID
		var path []string
		var tokens int32
		if err := rows.Scan(&doc, &path, &tokens); err != nil {
			return t, err
		}
		if doc != cur {
			flush()
			cur = doc
		}
		items = append(items, Item{Path: path, Tokens: int(tokens)})
	}
	flush()
	return t, rows.Err()
}

// queryer is the part of a pool planSource needs.
type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}
