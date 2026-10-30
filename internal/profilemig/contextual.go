// Contextual chunks in a profile migration (docs/contextual-chunks.md section 4): a target profile that is contextual is built, for the
// sources that opted in, with a model-written context in front of each passage's embedding input. The preflight estimates it and blocks
// what would be unbounded or unsafe; the start snapshots the opted-in sources' settings for the new sets.

package profilemig

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/contextual"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ContextualEstimate is what the contextual part of a migration involves: calls are a ceiling (cached contexts are not subtracted), tokens
// are ceilings, and the cost is a ceiling only when the model has prices.
type ContextualEstimate struct {
	Sources              int    `json:"sources"`
	SourcesWithout       int    `json:"sourcesWithout"`
	Documents            int64  `json:"documents"`
	Passages             int64  `json:"passages"`
	Units                int64  `json:"units"`
	Calls                int64  `json:"calls"`
	DocumentsOver        int64  `json:"documentsOver"`
	InputTokensMax       int64  `json:"inputTokensMax"`
	OutputTokensMax      int64  `json:"outputTokensMax"`
	EmbeddingTokensAdded int64  `json:"embeddingTokensAdded"`
	PriceKnown           bool   `json:"priceKnown"`
	Currency             string `json:"currency,omitempty"`
	CostMax              string `json:"costMax,omitempty"`
}

// contextualPreflight estimates and checks the contextual part of a migration into pf.Target.
func (s *Service) contextualPreflight(ctx context.Context, a authz.Actor, pf *Preflight) error {
	add := func(code, msg string) { pf.Blockers = append(pf.Blockers, Issue{code, msg}) }
	if s.Contextual == nil {
		add("contextual_unavailable", "Contextual chunks are not available on this installation.")
		return nil
	}
	if chunkingOf(pf.Target) != chunkingOf(pf.From) {
		add("contextual_needs_same_passages", "Preview contextual chunks on their own: the passages must be cut as the live index cuts them, so that the calls can be counted before they are made. Change the passage settings in a separate preview.")
	}
	done := map[uuid.UUID]bool{}
	for _, src := range pf.Sources {
		done[src.ID] = src.AlreadyEmbedded
	}
	plan, err := s.Contextual.KBPlan(ctx, a, pf.KB.ID, func(id uuid.UUID) bool { return done[id] })
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, b := range plan.Blockers {
		if !seen[b.Code] { // one line per kind of problem; the source's own estimate names the source
			seen[b.Code] = true
			add(b.Code, b.Message)
		}
	}
	est := ContextualEstimate{Sources: len(plan.Sources), SourcesWithout: len(plan.Skipped), Documents: plan.Documents, Passages: plan.Passages,
		Units: plan.Units, Calls: plan.Calls, DocumentsOver: plan.DocumentsOver, InputTokensMax: plan.InputTokensMax,
		OutputTokensMax: plan.OutputTokensMax, EmbeddingTokensAdded: plan.EmbeddingTokensAdded, PriceKnown: plan.Cost.PriceKnown,
		Currency: plan.Cost.Currency, CostMax: plan.Cost.MaxAmount}
	pf.Estimate.Contextual = &est
	if !est.PriceKnown && est.Sources > 0 {
		pf.Warnings = append(pf.Warnings, Issue{"contextual_price_unknown", "The context model has no price set, so the cost of the calls is unknown. The calls and tokens above are limits, not amounts."})
	}
	if est.SourcesWithout > 0 {
		pf.Warnings = append(pf.Warnings, Issue{"contextual_sources_without", "Sources that have not opted in are embedded as they are; the index will mix both."})
	}
	return nil
}

// ContextualSource is how one source's set of a contextual migration is being built.
type ContextualSource struct {
	ID            uuid.UUID
	Name          string
	FailurePolicy string
	MaxCalls      int
	CapReached    bool
	contextual.SetState
}

// ContextualProgress is the contextual part of a migration's progress (nil: the target has none).
type ContextualProgress struct {
	Sources        []ContextualSource
	SourcesWithout int
}

// contextualProgress reads how the migration's contextual sets stand: attempts and how documents were embedded. Counts only.
func (s *Service) contextualProgress(ctx context.Context, pm dbgen.ProfileMigration) (*ContextualProgress, error) {
	if s.Contextual == nil {
		return nil, nil
	}
	rows, err := s.q.KBSetContextual(ctx, dbgen.KBSetContextualParams{KBID: pm.KBID, ProfileID: pm.ToProfileID})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	all, err := s.q.KBSources(ctx, pm.KBID)
	if err != nil {
		return nil, err
	}
	out := &ContextualProgress{SourcesWithout: len(all) - len(rows)}
	for _, r := range rows {
		st, err := s.Contextual.SetStateFor(ctx, r.SourceID, pm.ToProfileID, false)
		if err != nil {
			return nil, err
		}
		cs := ContextualSource{ID: r.SourceID, Name: r.Name, FailurePolicy: r.FailurePolicy, SetState: st}
		if cur, err := s.q.GetSourceContextual(ctx, r.SourceID); err == nil {
			cs.MaxCalls = int(cur.MaxCalls)
			cs.CapReached = st.Calls.Attempts >= int64(cur.MaxCalls)
		}
		out.Sources = append(out.Sources, cs)
	}
	return out, nil
}
