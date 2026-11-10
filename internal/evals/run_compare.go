package evals

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
)

// Comparison is one question in two runs.
type Comparison struct {
	CaseID   uuid.NullUUID
	Question string
	A, B     *Result
	Change   string
}

// Compare lists how each question changed from run a to run b.
func (s *Service) Compare(ctx context.Context, a authz.Actor, teamRef string, setID, runA, runB uuid.UUID) (Run, Run, []Comparison, error) {
	ra, resA, err := s.Run(ctx, a, teamRef, setID, runA)
	if err != nil {
		return Run{}, Run{}, nil, err
	}
	rb, resB, err := s.Run(ctx, a, teamRef, setID, runB)
	if err != nil {
		return Run{}, Run{}, nil, err
	}
	return ra, rb, compareResults(resA, resB), nil
}

// compareResults pairs the results of two runs by question.
func compareResults(resA, resB []Result) []Comparison {
	var out []Comparison
	byCase := map[uuid.UUID]int{}
	add := func(r Result, first bool) {
		if r.CaseID.Valid {
			if i, ok := byCase[r.CaseID.UUID]; ok {
				out[i].B = &r
				return
			}
			byCase[r.CaseID.UUID] = len(out)
		}
		c := Comparison{CaseID: r.CaseID, Question: r.Question}
		if first {
			c.A = &r
		} else {
			c.B = &r
		}
		out = append(out, c)
	}
	for _, r := range resA {
		add(r, true)
	}
	for _, r := range resB {
		add(r, false)
	}
	for i := range out {
		out[i].Change = Compare(outcome(out[i].A), outcome(out[i].B))
	}
	return out
}

func outcome(r *Result) *Outcome {
	if r == nil {
		return nil
	}
	o := &Outcome{Status: r.Status}
	if r.Rank != nil {
		o.Rank = int(*r.Rank)
	}
	return o
}
