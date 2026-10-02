// A set's questions that need attention (docs/evaluations.md §1, docs/v0.4.1.md
// §2): the question form's check run for every question (expected documents
// not in the knowledge bases, must-mention phrases in no passage) and
// "out of reach", an expected document that's there but wasn't found in the
// top DeepSearch results in each of the question's last OutOfReachRuns
// retrieval runs. Warnings only: nothing here blocks a run.
//
// Sets hold at most a few hundred questions, so the whole check is three
// queries whatever their number: every expected item of the set in one
// (MatchExpectedItems), every distinct phrase in one (PhrasesInSources), and
// every question's latest retrieval results in one (LatestRetrievalResults).

package evals

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// OutOfReachRuns is how many of a question's latest retrieval runs must all
// have missed its expected document in the top DeepSearch results for it to
// be out of reach (owner decision Q3, docs/v0.4.1.md §2).
const OutOfReachRuns = 3

// QuestionProblem is what the set's check found about one question.
type QuestionProblem struct {
	QuestionID uuid.UUID
	// Expected are the expected documents the knowledge bases don't hold
	// (StateNotIndexed or StateDeleted).
	Expected []ExpectedItem
	// Missing is set when none is held (MissingNotIndexed or
	// MissingDeleted): the question can't pass, and runs don't score it.
	Missing string
	// Phrases are must-mention phrases in no passage (an agent's sets).
	Phrases []string
	// OutOfReach is the latest of the runs that missed the expected document
	// (nil unless it's out of reach).
	OutOfReach *OutOfReach
}

// OutOfReach points at the latest result of a question that's out of reach.
type OutOfReach struct {
	RunID, ResultID uuid.UUID
}

// Problems checks every question of a set against its knowledge bases today
// and its latest retrieval runs, and returns those with a problem, in the
// set's order (editors and above; nothing is saved).
func (s *Service) Problems(ctx context.Context, a authz.Actor, teamRef string, setID uuid.UUID) ([]QuestionProblem, error) {
	acc, err := s.access(ctx, a, teamRef, false)
	if err != nil {
		return nil, err
	}
	set, err := loadSet(ctx, s.q, acc.Team.ID, setID, false)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListEvalCases(ctx, setID)
	if err != nil || len(rows) == 0 {
		return []QuestionProblem{}, err
	}
	cases := make([]Case, len(rows))
	for i, r := range rows {
		cases[i] = DecodeCase(r)
	}
	sources, err := s.setSources(ctx, set)
	if err != nil {
		return nil, err
	}
	items, err := s.caseItems(ctx, sources, cases)
	if err != nil {
		return nil, err
	}
	phrases := map[string]bool{}
	if set.AgentID.Valid { // must-mention phrases are checked in full-answer runs, which only an agent's sets have
		if phrases, err = s.phrasesFound(ctx, sources, distinctPhrases(cases)); err != nil {
			return nil, err
		}
	}
	reach, err := s.outOfReach(ctx, setID, cases, items)
	if err != nil {
		return nil, err
	}
	out := []QuestionProblem{}
	for i, c := range cases {
		if p, ok := questionProblem(c, items[i], phrases, set.AgentID.Valid, reach[c.ID]); ok {
			out = append(out, p)
		}
	}
	return out, nil
}

// caseItems are each question's expected items with their state today,
// matched in one query for the whole set (as stateItems does for one).
func (s *Service) caseItems(ctx context.Context, sources []uuid.UUID, cases []Case) ([][]ExpectedItem, error) {
	per := make([][]ExpectedItem, len(cases))
	all := []ExpectedItem{}
	for i, c := range cases {
		per[i] = c.Want.Items()
		all = append(all, per[i]...)
	}
	if err := s.stateItems(ctx, sources, all); err != nil {
		return nil, err
	}
	at := 0
	for i := range per {
		n := len(per[i])
		per[i] = all[at : at+n : at+n]
		at += n
	}
	return per, nil
}

// distinctPhrases are the set's must-mention phrases, each once.
func distinctPhrases(cases []Case) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, c := range cases {
		for _, p := range c.MustMention {
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	return out
}

// questionProblem gathers one question's problems (ok: it has one).
func questionProblem(c Case, items []ExpectedItem, phrases map[string]bool, checkPhrases bool, reach *OutOfReach) (QuestionProblem, bool) {
	p := QuestionProblem{QuestionID: c.ID, Expected: []ExpectedItem{}, Phrases: []string{}}
	for _, it := range items {
		if it.State != StateIndexed {
			p.Expected = append(p.Expected, it)
		}
	}
	if len(items) > 0 {
		p.Missing = missingReason(items)
	}
	if checkPhrases {
		for _, ph := range c.MustMention {
			if found, ok := phrases[ph]; ok && !found {
				p.Phrases = append(p.Phrases, ph)
			}
		}
	}
	// Out of reach means the page is there but retrieval never surfaces it:
	// moot while it isn't there (the missing state says so instead).
	if p.Missing == "" {
		p.OutOfReach = reach
	}
	return p, len(p.Expected) > 0 || len(p.Phrases) > 0 || p.OutOfReach != nil
}

// outOfReach finds the questions whose last OutOfReachRuns retrieval results
// all missed their expected documents in the top DeepSearch, by question,
// with the latest of those results.
func (s *Service) outOfReach(ctx context.Context, setID uuid.UUID, cases []Case, items [][]ExpectedItem) (map[uuid.UUID]*OutOfReach, error) {
	rows, err := s.q.LatestRetrievalResults(ctx, dbgen.LatestRetrievalResultsParams{SetID: setID, PerCase: OutOfReachRuns})
	if err != nil {
		return nil, err
	}
	byCase := map[uuid.UUID][]dbgen.LatestRetrievalResultsRow{}
	for _, r := range rows {
		byCase[r.CaseID] = append(byCase[r.CaseID], r)
	}
	out := map[uuid.UUID]*OutOfReach{}
	for i, c := range cases {
		if res := byCase[c.ID]; missedEvery(res, items[i]) {
			out[c.ID] = &OutOfReach{RunID: res[0].RunID, ResultID: res[0].ID}
		}
	}
	return out, nil
}

// missedEvery reports whether there are OutOfReachRuns results (newest
// first) and each missed the question's expected documents in the top
// DeepSearch.
func missedEvery(results []dbgen.LatestRetrievalResultsRow, items []ExpectedItem) bool {
	if len(results) < OutOfReachRuns || len(items) == 0 {
		return false
	}
	for _, r := range results[:OutOfReachRuns] {
		if !missedDeep(r.Status, r.Scores, items) {
			return false
		}
	}
	return true
}

// missedDeep reports whether a retrieval result is a miss in the top
// DeepSearch of the question as it is now: it failed (the expected document
// was in the knowledge base, not in the top k), its search or the deeper one
// for ranks looked through at least DeepSearch results, no expected document
// got a rank, and the question expected the same documents then (a result
// from before its expected documents changed doesn't count). A result whose
// deeper search failed (no depth) or was stored before diagnoses is no
// evidence either way.
func missedDeep(status string, scores []byte, items []ExpectedItem) bool {
	if status != StatusFail {
		return false
	}
	_, d := decodeScores(scores)
	if max(d.K, d.Depth) < DeepSearch || !sameItems(d.Expected, items) {
		return false
	}
	for _, it := range d.Expected {
		if it.Rank != nil {
			return false
		}
	}
	return true
}

// sameItems reports whether two lists hold the same expected documents
// (order aside).
func sameItems(a, b []ExpectedItem) bool {
	if len(a) != len(b) {
		return false
	}
	keys := map[string]int{}
	for _, it := range a {
		keys[it.key()]++
	}
	for _, it := range b {
		if keys[it.key()] == 0 {
			return false
		}
		keys[it.key()]--
	}
	return true
}
