// Evaluation events (docs/evaluations.md §4): an automatic retrieval check
// scored worse than the run before it.

package notify

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Regression is what got worse in an evaluation run.
type Regression struct {
	SetID, RunID uuid.UUID
	SetName      string
	// Target names the set's knowledge base or agent.
	Target string
	// Trigger is why the run started: agent_published, profile_switched or nightly.
	Trigger string
	// Recall and PrevRecall are recall@k (0-1) of the run and the one before.
	Recall, PrevRecall float64
	// NewlyFailing counts questions that passed before and fail now.
	NewlyFailing int
}

var triggerText = map[string]string{
	"agent_published":  "after the agent was published",
	"profile_switched": "after the knowledge base switched embedding profile",
	"nightly":          "after the knowledge base's documents changed",
}

// EvaluationRegressionEvent: an automatic run of a set dropped. It reaches
// the team's editors, admins and owners (who can turn it off).
func EvaluationRegressionEvent(t TeamRef, r Regression) Event {
	var what []string
	if drop := (r.PrevRecall - r.Recall) * 100; drop > 0 {
		what = append(what, fmt.Sprintf("recall fell from %.0f%% to %.0f%%", r.PrevRecall*100, r.Recall*100))
	}
	if r.NewlyFailing > 0 {
		what = append(what, fmt.Sprintf("%d %s that passed before now %s", r.NewlyFailing, plural(r.NewlyFailing, "question", "questions"),
			plural(r.NewlyFailing, "fails", "fail")))
	}
	when := triggerText[r.Trigger]
	if when == "" {
		when = "in an automatic run"
	}
	return Event{
		Type: EvaluationRegression, TeamID: t.ID, Link: t.path("/evaluations/" + r.SetID.String() + "?tab=runs&record=" + r.RunID.String()),
		DedupeKey: "evaluation_regression:" + r.RunID.String(),
		Title:     fmt.Sprintf("Evaluation scores dropped: %s (%s)", r.SetName, t.Name),
		Body: fmt.Sprintf("The retrieval check of %s (%s) ran %s: %s. Compare it with the previous run to see which questions got worse.",
			r.SetName, r.Target, when, strings.Join(what, ", and ")),
		Data: map[string]any{"team": t.Slug, "setId": r.SetID, "runId": r.RunID, "recall": r.Recall, "previousRecall": r.PrevRecall,
			"newlyFailing": r.NewlyFailing},
	}
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
