package agents

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/kbs"
)

// Parent/child retrieval in the answer pipeline (docs/parent-child-retrieval.md, ADR-0026). A search ranks passages; each surviving hit of a
// profile with parents is given to the model as its whole parent when the parent can be built and fits the answer's remaining context budget,
// and as the passage otherwise. Reranking and judging have already read the passages by then.

// CitationParent says, in a stored citation, that the model was given the section around the cited passage, and which one (the viewer shows
// that range, and only while its text still hashes to SHA256).
type CitationParent struct {
	First    int32  `json:"first"`
	Last     int32  `json:"last"`
	Passages int    `json:"passages"`
	Tokens   int    `json:"tokens"`
	Matched  int    `json:"matched"`
	SHA256   string `json:"sha256"`
}

// expandParents builds the parent text of the hits that have a parent, per knowledge base, in one query each. A failure leaves the hits
// as passages: expansion is never a reason for an answer to fail.
func (r *retriever) expandParents(ctx context.Context, span trace.Span, lists ...[]*fusedHit) {
	if r.noExpand || r.svc == nil {
		return
	}
	byKB := map[string][]*kbs.Hit{}
	for _, list := range lists {
		for _, f := range list {
			if f.hit.Parent != nil {
				byKB[f.hit.KBID.String()] = append(byKB[f.hit.KBID.String()], &f.hit)
			}
		}
	}
	if len(byKB) == 0 {
		return
	}
	used, skipped := 0, 0
	for _, kb := range r.kbs {
		hits := byKB[kb.ID.String()]
		if len(hits) == 0 {
			continue
		}
		if err := r.svc.ExpandParents(ctx, kb, r.filter, hits); err != nil {
			span.RecordError(err)
		}
		for _, h := range hits {
			if h.Parent.Text != "" {
				used++
			} else {
				skipped++
			}
		}
	}
	span.SetAttributes(attribute.Int("grounded.retrieval.parents", used), attribute.Int("grounded.retrieval.parents_skipped", skipped))
}

// withParent is the hit as the model is given it: with its parent's text, section pages and cost when the parent was built and fits the
// remaining budget, else the passage itself. r.mu must be held.
func (r *retriever) withParent(h kbs.Hit) kbs.Hit {
	p := h.Parent
	if p == nil || p.Text == "" || r.noExpand {
		return h
	}
	whole := h
	whole.Content = p.Text
	if p.PageStart > 0 {
		whole.PageStart, whole.PageEnd = p.PageStart, max(p.PageEnd, p.PageStart)
	}
	if hitCost(whole) > r.budget {
		p.Skipped = skipBudget
		return h
	}
	p.Expanded = true
	return whole
}

// skipBudget: the parent was built but would not fit the answer's context budget.
const skipBudget kbs.SkipReason = "budget"

// numberedParent is the source already numbered for the hit's parent, when the model has been given that parent in this answer.
func (r *retriever) numberedParent(h kbs.Hit) (*numberedHit, bool) {
	if h.Parent == nil {
		return nil, false
	}
	n, ok := r.byParent[h.Parent.Key(h.DocumentID)]
	return n, ok
}

// citationParent is the provenance of a source the model was given as a parent; nil when it was given the passage.
func citationParent(h numberedHit) *CitationParent {
	p := h.Parent
	if p == nil || !p.Expanded {
		return nil
	}
	return &CitationParent{First: p.First, Last: p.Last, Passages: p.Passages, Tokens: estimateTokens(h.Content), Matched: p.Matched, SHA256: p.SHA256}
}
