package evals

import (
	"context"
	"encoding/json"
	"errors"
	"sort"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Result is a question's result in a run, decoded.
type Result struct {
	dbgen.EvalResult
	Hits   []HitView
	Scores *AnswerScores
	// Diagnosis is what the run found about the expected documents (empty
	// for results recorded before it was kept).
	Diagnosis Diagnosis
}

// HitView is a document that came back, or a citation of an answer, for
// the editor.
type HitView struct {
	// Rank is the passage rank (retrieval) or the citation's position.
	Rank       int       `json:"rank"`
	DocumentID uuid.UUID `json:"documentId"`
	Title      string    `json:"title"`
	URL        string    `json:"url,omitempty"`
	Filename   string    `json:"filename,omitempty"`
	// Expected: the document is one of the question's expected documents.
	Expected bool `json:"expected"`
	// N is the answer's marker number ([n]) and the rest the cited passage
	// (full answers only; a retrieval keeps the start of its best passage
	// in Snippet).
	N           int      `json:"n,omitempty"`
	Snippet     string   `json:"snippet,omitempty"`
	HeadingPath []string `json:"headingPath,omitempty"`
	PageStart   *int32   `json:"pageStart,omitempty"`
	PageEnd     *int32   `json:"pageEnd,omitempty"`
}

// DecodeResult reads a stored result.
func DecodeResult(r dbgen.EvalResult) Result {
	out := Result{EvalResult: r, Hits: []HitView{}}
	_ = json.Unmarshal(r.Hits, &out.Hits)
	out.Scores, out.Diagnosis = decodeScores(r.Scores)
	if out.Scores != nil && r.Answer != nil {
		out.Scores.Claims = agents.FillClaimText(*r.Answer, out.Scores.Claims)
	}
	if r.Answer != nil {
		numberLegacyCitations(*r.Answer, out.Hits)
	}
	return out
}

// numberLegacyCitations gives the citations of an answer stored by v0.2.0
// their marker numbers, so the answer shows chips as newer ones do. v0.2.0
// kept each cited document once (its first citation), with its position in
// the answer's citations as Rank, and those citations were the answer's
// marker numbers in ascending order. A repeated document's later markers
// have no entry, and stay text.
func numberLegacyCitations(answer string, hits []HitView) {
	for _, h := range hits {
		if h.N != 0 {
			return
		}
	}
	seen := map[int]bool{}
	var ns []int
	for _, n := range agents.CitedNumbers(answer) {
		if !seen[n] {
			seen[n] = true
			ns = append(ns, n)
		}
	}
	sort.Ints(ns)
	for i := range hits {
		if r := hits[i].Rank; r >= 1 && r <= len(ns) {
			hits[i].N = ns[r-1]
		}
	}
}

// Run returns a run with its results.
func (s *Service) Run(ctx context.Context, a authz.Actor, teamRef string, setID, runID uuid.UUID) (Run, []Result, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return Run{}, nil, err
	}
	if _, err := loadSet(ctx, s.q, acc.Team.ID, setID, false); err != nil {
		return Run{}, nil, err
	}
	run, err := s.q.GetEvalRun(ctx, dbgen.GetEvalRunParams{ID: runID, SetID: setID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return Run{}, nil, errNoRun
	} else if err != nil {
		return Run{}, nil, err
	}
	rows, err := s.q.ListEvalResults(ctx, runID)
	out := make([]Result, len(rows))
	for i, r := range rows {
		out[i] = DecodeResult(r)
	}
	return DecodeRun(run), out, err
}
