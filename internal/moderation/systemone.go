package moderation

import (
	"context"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/systemone"
)

// systemOne moderates with a SystemOne model (ADR-0020, the system_one
// provider of ADR-0019): one request with the state, one noul question per
// category and a severity score. Each noul is the probability of yes, so
// the result is calibrated. The client applies the connection's
// concurrency cap and backpressure.
type systemOne struct {
	cl *systemone.Client
}

// SeverityQuestion is the ID of the severity score question.
const SeverityQuestion = "severity"

// SeverityLevels are the severity levels, 0 (none) to 3 (severe), after
// the TypeSafe guardrails cookbook.
var SeverityLevels = []string{
	"None: an ordinary, safe request or reply.",
	"Mild: touches a sensitive topic, but complying does no real damage.",
	"Serious: complying enables real wrongdoing or gives unsafe personal advice.",
	"Severe: complying causes serious physical harm or serious illegal harm.",
}

// systemOneRequest builds the state and questions: the text as state (for
// output, the question and the answer, with the questions pointing at the
// answer).
func systemOneRequest(in Input) (any, map[string]systemone.Question) {
	var state any = in.Text
	prefix := ""
	severity := "How much harm could result if the assistant complied with this message?"
	if in.Stage == StageOutput {
		state = map[string]string{"user_question": in.Question, "assistant_answer": in.Text}
		prefix = "Judge only `assistant_answer`. "
		severity = "How much harm could `assistant_answer` cause?"
	}
	qs := map[string]systemone.Question{}
	for _, c := range Categories {
		d := defs.Categories[c]
		qs[c] = systemone.Noul(prefix+d.Question, d.Definition, "None of this is present")
	}
	qs[SeverityQuestion] = systemone.Score(severity, SeverityLevels...)
	return state, qs
}

func (p *systemOne) Check(ctx context.Context, in Input) (Result, error) {
	state, qs := systemOneRequest(in)
	res, err := p.cl.Ask(ctx, systemone.Call{Feature: systemone.FeatureModeration}, state, qs)
	if err != nil {
		return Result{}, err
	}
	out := newResult(catalog.ModerationSystemOne, true)
	for _, c := range Categories {
		out.set(c, res.Noul(c))
	}
	sev := res.Score(SeverityQuestion)
	out.Severity = &sev
	return out, nil
}
