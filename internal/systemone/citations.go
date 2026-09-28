// Citation checks (docs/systemone.md §3), after TypeSafe's citation
// cookbook: one choice question per claim and cited passage, "how does the
// section relate to the claim?", mapped to a verdict. What the verdicts do
// (annotate, remove markers, refuse) is decided in code by the caller.

package systemone

import (
	"context"
	"sync"
	"time"
	"unicode/utf8"
)

// Verdicts of a claim–source pair.
const (
	Verified     = "verified"     // the source supports the claim
	Unsupported  = "unsupported"  // the source says nothing about it
	Contradicted = "contradicted" // the source says the opposite
	Unchecked    = "unchecked"    // not checked (error or timeout)
)

// QRelation is the question ID of a citation check.
const QRelation = "relation"

// Options of the relation question.
const (
	relSupports    = "supports"
	relContradicts = "contradicts"
	relSaysNothing = "says_nothing"
)

var relationQuestions = map[string]Question{
	QRelation: Choice("How does the section relate to the claim?", map[string]string{
		relSupports:    "The section states the claim or directly implies that it is true",
		relContradicts: "The section states the opposite of the claim or implies it is false",
		relSaysNothing: "The section does not address what the claim asserts, either way",
	}),
}

// RelationQuestions returns the citation-check question (tests and tools).
func RelationQuestions() map[string]Question { return relationQuestions }

// verdictOf maps the chosen relation to a verdict.
var verdictOf = map[string]string{relSupports: Verified, relContradicts: Contradicted, relSaysNothing: Unsupported}

// ClaimPair is one claim and the text of the source it cites.
type ClaimPair struct {
	Claim  string
	Source string
}

// Verdict is the check of one pair. Confidence is the model's confidence
// in the chosen relation (0 when unchecked).
type Verdict struct {
	Verification string
	Confidence   float64
	Err          error
}

// Confident reports whether the verdict stands on its own at the
// auto-accept threshold.
func (v Verdict) Confident(autoAccept float64) bool {
	return v.Verification != Unchecked && v.Confidence >= autoAccept
}

// CheckStats describe one check.
type CheckStats struct {
	Requests int
	Latency  time.Duration
}

// CheckState is the state of one citation check: the claim and the
// section it cites (the cookbook's shape).
func CheckState(p ClaimPair) map[string]string {
	src := p.Source
	if utf8.RuneCountInString(src) > maxPassageRunes {
		src = string([]rune(src)[:maxPassageRunes])
	}
	return map[string]string{"claim": p.Claim, "section": src}
}

// CheckClaims asks the relation question for every pair at once (the
// connection's concurrency cap queues them) and never fails: a pair whose
// request fails, or is still waiting when ctx ends, is unchecked. The
// caller bounds ctx with the feature timeout.
func (cl *Client) CheckClaims(ctx context.Context, pairs []ClaimPair, timeout time.Duration) ([]Verdict, CheckStats) {
	start := time.Now()
	out := make([]Verdict, len(pairs))
	var wg sync.WaitGroup
	for i, p := range pairs {
		wg.Go(func() {
			res, err := cl.Ask(ctx, Call{Feature: FeatureCitations, Timeout: timeout}, CheckState(p), relationQuestions)
			out[i] = verdictFrom(res, err)
		})
	}
	wg.Wait()
	return out, CheckStats{Requests: len(pairs), Latency: time.Since(start)}
}

func verdictFrom(res Response, err error) Verdict {
	if err != nil {
		return Verdict{Verification: Unchecked, Err: err}
	}
	a := res.Answers[QRelation]
	v := Verdict{Verification: verdictOf[a.Choice]}
	switch {
	case a.Confidence != nil:
		v.Confidence = *a.Confidence
	default: // no confidence reported: the chosen option's probability
		v.Confidence = a.Probabilities[a.Choice]
	}
	v.Confidence = min(max(v.Confidence, 0), 1)
	return v
}
