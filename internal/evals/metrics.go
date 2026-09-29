// Scores (docs/evaluations.md §2-§4): recall@k and MRR of a retrieval
// check, the pass rate and answer scores of a full-answer check, what
// dropped between two automatic runs, and how two runs compare.

package evals

import (
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
)

// Run kinds and result statuses.
const (
	KindRetrieval = "retrieval"
	KindAnswer    = "answer"

	StatusPass    = "pass"
	StatusFail    = "fail"
	StatusMissing = "missing" // no expected document is in the knowledge base: not a failure
	StatusError   = "error"   // the check itself failed (the model was unavailable, ...)
)

// Summary is a run's scores. Questions none of whose expected documents is
// in the knowledge base, and questions whose check failed, are counted
// apart and left out of the rates.
type Summary struct {
	// K is the results per search the run checked (retrieval).
	K         int `json:"k"`
	Questions int `json:"questions"`
	Passed    int `json:"passed"`
	Failed    int `json:"failed"`
	Missing   int `json:"missing"`
	// NotIndexed counts the missing questions whose expected documents
	// never were in the knowledge base (the rest were deleted since).
	NotIndexed int `json:"notIndexed"`
	Errors     int `json:"errors"`
	// Recall is recall@k: the share of scored questions whose expected
	// document came back in the top k (retrieval runs).
	Recall *float64 `json:"recall,omitempty"`
	// MRR is the mean reciprocal rank of the first expected document (0
	// when it didn't come back), over the scored questions.
	MRR *float64 `json:"mrr,omitempty"`
	// PassRate is the share of scored answers that passed (full-answer runs).
	PassRate *float64 `json:"passRate,omitempty"`
	// Cited and Refused count answers that cited an expected document and
	// answers that refused.
	Cited   int `json:"cited"`
	Refused int `json:"refused"`
	// CitedOnly counts passes of questions without must-mention phrases:
	// the answer cited an expected document, but nothing checked what it
	// said ("Cited the right source (content not checked)").
	CitedOnly int `json:"citedOnly"`
	// SupportedShare is the mean share of supported claims over the answers
	// SystemOne checked (nil: none were checked).
	SupportedShare *float64 `json:"supportedShare,omitempty"`
}

// Scored is one question's outcome, for the summary.
type Scored struct {
	Status string
	Rank   int
	Answer *AnswerScores
	// Missing is why a missing question wasn't scored (Diagnosis.Missing).
	Missing string
}

// Summarize computes a run's summary from its results.
func Summarize(kind string, k int, rs []Scored) Summary {
	s := Summary{K: k, Questions: len(rs)}
	var rr, share float64
	checked := 0
	for _, r := range rs {
		switch r.Status {
		case StatusPass:
			s.Passed++
		case StatusFail:
			s.Failed++
		case StatusMissing:
			s.Missing++
			if r.Missing == MissingNotIndexed {
				s.NotIndexed++
			}
		default:
			s.Errors++
		}
		if (r.Status == StatusPass || r.Status == StatusFail) && r.Rank > 0 {
			rr += 1 / float64(r.Rank)
		}
		if a := r.Answer; a != nil {
			if a.Cited {
				s.Cited++
			}
			if r.Status == StatusPass && len(a.Mentions) == 0 {
				s.CitedOnly++
			}
			if a.Refused {
				s.Refused++
			}
			if a.SupportedShare != nil {
				share += *a.SupportedShare
				checked++
			}
		}
	}
	scored := s.Passed + s.Failed
	if scored > 0 {
		rate := float64(s.Passed) / float64(scored)
		if kind == KindAnswer {
			s.PassRate = &rate
		} else {
			mrr := rr / float64(scored)
			s.Recall, s.MRR = &rate, &mrr
		}
	}
	if checked > 0 {
		v := share / float64(checked)
		s.SupportedShare = &v
	}
	return s
}

// Mention is whether an answer mentions a must-mention phrase.
type Mention struct {
	Phrase string `json:"phrase"`
	Found  bool   `json:"found"`
}

// AnswerScores are a full answer's scores.
type AnswerScores struct {
	// Cited: the answer cites an expected document.
	Cited    bool      `json:"cited"`
	Mentions []Mention `json:"mentions"`
	// Refused: the answer was a refusal ("I don't know").
	Refused bool `json:"refused"`
	// SupportedShare is verified / checked citation pairs, when SystemOne
	// citation checks are on for the agent.
	SupportedShare *float64 `json:"supportedShare,omitempty"`
}

// ScoreAnswer scores an answer: whether it cites an expected document and
// mentions each phrase (case-insensitive, citation markers and spacing
// aside). It passes when it cites one and mentions every phrase.
func ScoreAnswer(e Expected, phrases []string, text string, cited []Doc, refused bool, checks *agents.CitationsRecord) (AnswerScores, bool) {
	sc := AnswerScores{Refused: refused, Mentions: []Mention{}}
	for _, d := range cited {
		if e.Matches(d) {
			sc.Cited = true
			break
		}
	}
	plain := strings.ToLower(strings.Join(strings.Fields(agents.RemoveMarkers(text)), " "))
	all := true
	for _, p := range phrases {
		found := strings.Contains(plain, strings.ToLower(strings.Join(strings.Fields(p), " ")))
		all = all && found
		sc.Mentions = append(sc.Mentions, Mention{Phrase: p, Found: found})
	}
	if checks != nil && checks.Checked > 0 {
		v := float64(checks.Verified) / float64(checks.Checked)
		sc.SupportedShare = &v
	}
	return sc, sc.Cited && all
}

// RecallDropPoints is the drop in recall@k (percentage points) above which
// an automatic run notifies the team's editors.
const RecallDropPoints = 5.0

// Drop is how an automatic run compares with the previous run.
type Drop struct {
	Recall, PrevRecall float64
	// NewlyFailing counts questions that passed before and fail now.
	NewlyFailing int
}

// Notify reports whether the drop is worth telling the editors about:
// recall fell by more than RecallDropPoints, or a question newly fails.
func (d Drop) Notify() bool {
	return (d.PrevRecall-d.Recall)*100 > RecallDropPoints+1e-9 || d.NewlyFailing > 0
}

// DetectDrop compares a run with the previous one: recall@k of both (0
// when unknown) and the questions (by ID) that passed before and fail now.
func DetectDrop(prev, cur Summary, prevStatus, curStatus map[uuid.UUID]string) Drop {
	d := Drop{}
	if prev.Recall != nil {
		d.PrevRecall = *prev.Recall
	}
	if cur.Recall != nil {
		d.Recall = *cur.Recall
	} else {
		d.Recall = d.PrevRecall
	}
	for id, st := range curStatus {
		if st == StatusFail && prevStatus[id] == StatusPass {
			d.NewlyFailing++
		}
	}
	return d
}

// Changes of a question between two runs.
const (
	ChangeBetter = "better"
	ChangeWorse  = "worse"
	ChangeSame   = "same"
	// ChangeOnlyA and ChangeOnlyB: the question was checked in one run only.
	ChangeOnlyA = "only_a"
	ChangeOnlyB = "only_b"
)

// Outcome is one question's result in a run, for comparing.
type Outcome struct {
	Status string
	Rank   int
}

// Compare says how a question changed from run a to run b: passing where
// it failed is better, failing where it passed is worse; between two passes
// a better rank is better. Missing and errored results only change to or
// from a pass.
func Compare(a, b *Outcome) string {
	switch {
	case a == nil && b == nil:
		return ChangeSame
	case a == nil:
		return ChangeOnlyB
	case b == nil:
		return ChangeOnlyA
	case a.Status != StatusPass && b.Status == StatusPass:
		return ChangeBetter
	case a.Status == StatusPass && b.Status != StatusPass:
		return ChangeWorse
	case a.Status == StatusPass && a.Rank > 0 && b.Rank > 0 && b.Rank < a.Rank:
		return ChangeBetter
	case a.Status == StatusPass && a.Rank > 0 && b.Rank > a.Rank:
		return ChangeWorse
	}
	return ChangeSame
}
