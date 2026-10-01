// Reranking in the knowledge base's own retrieval (docs/v0.4.0.md §3): the
// Try it playground, POST …/retrieve, MCP search and evaluation runs fetch
// the platform's candidate count, rerank them with the platform's rerank
// model in one call and keep the best k. A failed or slow call keeps the
// fusion order (fail open).

package kbs

import (
	"context"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/rerank"
)

// RerankInfo is how a search was reranked (Result.Rerank; nil when the
// platform has no rerank model or the query turned reranking off).
type RerankInfo struct {
	// Status is ok, timeout or error (the fusion order was kept), or
	// skipped (the rerank model may not read this knowledge base's
	// classification).
	Status     string
	Candidates int
	Latency    time.Duration
}

// RerankPlan returns the platform's reranking (nil: none). A settings failure is logged and the search isn't reranked:
// reranking is quality, not safety.
func (s *Service) RerankPlan(ctx context.Context) *rerank.Plan {
	if s.Rerank == nil {
		return nil
	}
	p, err := s.Rerank.Plan(ctx)
	if err != nil {
		s.Rerank.Log.Warn("rerank settings unavailable; searching without reranking", "err", err)
		return nil
	}
	return p
}

// PassageText is a hit as the reranker reads it: its title, heading path
// and text.
func PassageText(h Hit) string {
	var b strings.Builder
	title := h.Title
	if title == "" {
		title = h.Filename
	}
	if title != "" {
		b.WriteString(title)
		b.WriteString("\n")
	}
	if len(h.HeadingPath) > 0 {
		b.WriteString(strings.Join(h.HeadingPath, " › "))
		b.WriteString("\n")
	}
	b.WriteString(h.Content)
	return b.String()
}

// rerankHits reranks a knowledge base's hits and keeps the best k, with
// their scores. Unless reranking succeeded, the first k hits are kept in
// the fusion order.
func rerankHits(ctx context.Context, p *rerank.Plan, caller, classification, query string, hits []Hit, k int) ([]Hit, *RerankInfo) {
	var out rerank.Outcome
	if !p.Allows(classification) {
		out = rerank.Skip(caller)
	} else {
		docs := make([]string, len(hits))
		for i, h := range hits {
			docs[i] = PassageText(h)
		}
		out = p.Rerank(ctx, caller, query, docs, k)
	}
	info := &RerankInfo{Status: out.Status, Candidates: len(hits), Latency: out.Latency}
	if !out.OK() {
		return hits[:min(len(hits), k)], info
	}
	kept := make([]Hit, 0, min(len(out.Order), k))
	for _, i := range out.Order[:min(len(out.Order), k)] {
		h := hits[i]
		score := out.Scores[i]
		h.RerankScore = &score
		kept = append(kept, h)
	}
	return kept, info
}
