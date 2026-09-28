// Passage judging in the KB playground (docs/systemone.md §2): /retrieve
// with judge: true judges the fused candidates with the platform's
// SystemOne model and returns every candidate with its scores and route.

package kbs

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
)

// PassageOf is a hit as a SystemOne model sees it.
func PassageOf(h Hit) systemone.Passage {
	st := "document"
	if h.URL != "" {
		st = "web_page"
	}
	title := h.Title
	if title == "" {
		title = h.Filename
	}
	return systemone.Passage{Title: title, Section: strings.Join(h.HeadingPath, " › "), SourceType: st, Text: h.Content}
}

// Judging is the playground's judging outcome: Judgments align with
// Result.Hits.
type Judging struct {
	Mode      string
	Judgments []systemone.Judgment
	Stats     systemone.JudgeStats
}

// judgePlan checks that the caller may judge (team editors and above,
// signed in) and returns the plan with the platform's settings, even when
// judging is off for agents.
func (s *Service) judgePlan(ctx context.Context, a authz.Actor, teamRef string) (*systemone.JudgePlan, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	if a.Key != nil || !authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
		return nil, apperr.Forbidden("Only team editors, admins and owners can judge passages")
	}
	var plan *systemone.JudgePlan
	if s.SystemOne != nil {
		if plan, err = s.SystemOne.JudgePlan(ctx, systemone.Override{}, true); err != nil {
			return nil, err
		}
	}
	if plan == nil {
		return nil, apperr.Conflict("systemone_unavailable", "No SystemOne model is configured. Ask a platform admin.")
	}
	return plan, nil
}

// judgeHits judges the hits and orders them: evidence and then conflicting
// evidence, each by relevance, then the dropped ones in retrieval order.
func judgeHits(ctx context.Context, plan *systemone.JudgePlan, query string, hits []Hit) ([]Hit, *Judging) {
	ps := make([]systemone.Passage, len(hits))
	for i, h := range hits {
		ps[i] = PassageOf(h)
	}
	js, st := plan.Client.Judge(ctx, query, ps, plan.Options)
	order := systemone.Rank(js, func(j systemone.Judgment) bool { return j.Route == systemone.RouteEvidence })
	order = append(order, systemone.Rank(js, func(j systemone.Judgment) bool { return j.Route == systemone.RouteConflicting })...)
	for i, j := range js {
		if j.Route == systemone.RouteDropped {
			order = append(order, i)
		}
	}
	out := &Judging{Mode: plan.Options.Mode, Stats: st, Judgments: make([]systemone.Judgment, len(order))}
	sorted := make([]Hit, len(order))
	for i, idx := range order {
		sorted[i], out.Judgments[i] = hits[idx], js[idx]
	}
	return sorted, out
}

// meterUsage turns SystemOne use into usage events.
func meterUsage(m *systemone.Meter) []dbgen.InsertUsageParams {
	var out []dbgen.InsertUsageParams
	for _, e := range m.Entries() {
		if e.InputTokens > 0 {
			out = append(out, dbgen.InsertUsageParams{Kind: systemone.UsageKind, Quantity: e.InputTokens,
				ModelID: uuid.NullUUID{UUID: e.ModelID, Valid: e.ModelID != uuid.Nil}, Metadata: []byte(`{"feature":"` + e.Feature + `"}`)})
		}
	}
	return out
}
