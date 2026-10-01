// Reranking in the chat pipeline (docs/v0.4.0.md §3): once the platform
// has a rerank model, each search fetches its candidate count (about 40),
// the rerank model scores them in one call, and the agent keeps the best
// rerankTopN (default 6) for SystemOne judging or the model. An agent can
// turn it off (Build → Advanced). A failed or slow call keeps the fusion
// order and the results per search (fail open), so an answer is never
// worse or much later than without it.

package agents

import (
	"context"
	"encoding/json"

	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/rerank"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// planRerank sets the platform's reranking unless the agent turned it off
// (nil: none, and retrieval is as before). It reranks only when the rerank
// model may read every knowledge base's classification (ADR-0006).
func (r *retriever) planRerank(ctx context.Context, c Config) {
	if !c.Rerank || r.svc == nil {
		return
	}
	p := r.svc.RerankPlan(ctx)
	if p == nil {
		return
	}
	r.rerank, r.topN, r.rerankOK = p, c.RerankTopN, true
	for _, kb := range r.kbs {
		r.rerankOK = r.rerankOK && p.Allows(kb.EffectiveClassification)
	}
}

// rerankCandidates reranks the platform's candidate count of fused hits
// and returns the best topN, best first (ok), or the fused hits unchanged
// when reranking failed, timed out or was skipped.
func (r *retriever) rerankCandidates(ctx context.Context, query string, merged []*fusedHit) ([]*fusedHit, bool) {
	if !r.rerankOK {
		rerank.Skip(rerank.CallerAgent)
		return merged, false
	}
	cands := merged[:min(len(merged), r.rerank.Candidates)]
	docs := make([]string, len(cands))
	for i, f := range cands {
		docs[i] = kbs.PassageText(f.hit)
	}
	out := r.rerank.Rerank(rerank.WithMeter(ctx, &r.rmeter), rerank.CallerAgent, query, docs, r.topN)
	if !out.OK() {
		return merged, false
	}
	kept := make([]*fusedHit, 0, min(len(out.Order), r.topN))
	for _, i := range out.Order[:min(len(out.Order), r.topN)] {
		f := cands[i]
		score := out.Scores[i]
		f.hit.RerankScore = &score
		kept = append(kept, f)
	}
	return kept, true
}

// rerankUsage are the usage events of the answer's rerank requests.
func (r *retriever) rerankUsage(meta json.RawMessage) []dbgen.InsertUsageParams {
	return r.rmeter.Usage(meta)
}
