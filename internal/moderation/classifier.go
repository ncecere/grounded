package moderation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ncecere/grounded/internal/catalog"
)

// classifier uses any chat model as a classifier (ADR-0019 kind
// chat_classifier): our versioned prompt asks for one JSON object with a
// probability per category, validated against a schema. An invalid reply
// is retried once with a reminder. The probabilities are the model's own
// estimates, so the result is not calibrated.
type classifier struct{ chat chatCaller }

// classifierMaxTokens leaves room for reasoning models to think first.
const classifierMaxTokens = 2048

// ClassifierPrompt is the system prompt (definitions.v1.json with the
// categories filled in).
func ClassifierPrompt() string {
	return strings.NewReplacer("{{categories}}", categoryList(), "{{keys}}", string(zeroScores())).Replace(defs.ClassifierPrompt)
}

// zeroScores is the reply shape, in category order.
func zeroScores() json.RawMessage {
	var b strings.Builder
	b.WriteString("{")
	for i, c := range Categories {
		if i > 0 {
			b.WriteString(", ")
		}
		fmt.Fprintf(&b, "%q: 0.0", c)
	}
	b.WriteString("}")
	return json.RawMessage(b.String())
}

// classifierMessage frames the text as data to judge.
func classifierMessage(in Input) string {
	if in.Stage == StageOutput {
		return "Judge the ASSISTANT ANSWER below (the user's question is only context).\n\nUSER QUESTION:\n<<<\n" +
			in.Question + "\n>>>\n\nASSISTANT ANSWER:\n<<<\n" + in.Text + "\n>>>"
	}
	return "Judge the USER MESSAGE below.\n\nUSER MESSAGE:\n<<<\n" + in.Text + "\n>>>"
}

var errInvalidJSON = errors.New("invalid classifier JSON")

func (p *classifier) Check(ctx context.Context, in Input) (Result, error) {
	msgs := []chatMsg{{Role: "system", Content: ClassifierPrompt()}, {Role: "user", Content: classifierMessage(in)}}
	reply, err := p.chat.complete(ctx, msgs, classifierMaxTokens, nil)
	if err != nil {
		return Result{}, err
	}
	res, perr := parseClassifier(reply.Text)
	if perr == nil {
		return res, nil
	}
	// One retry, showing the model its reply and the problem.
	msgs = append(msgs, chatMsg{Role: "assistant", Content: truncate(reply.Text, 2000)},
		chatMsg{Role: "user", Content: "That reply was not valid (" + perr.Error() + "). Reply with only the JSON object: " + string(zeroScores())})
	reply, err = p.chat.complete(ctx, msgs, classifierMaxTokens, nil)
	if err != nil {
		return Result{}, err
	}
	res, perr = parseClassifier(reply.Text)
	if perr != nil {
		return Result{}, badResponse("the classifier did not return valid JSON twice: %v", perr)
	}
	return res, nil
}

// parseClassifier validates the reply: one JSON object (optionally in a
// code fence) with a number from 0 to 1 for every category. Other keys are
// ignored.
func parseClassifier(text string) (Result, error) {
	text = strings.TrimSpace(text)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end < start {
		return Result{}, fmt.Errorf("%w: no JSON object", errInvalidJSON)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(text[start:end+1]), &raw); err != nil {
		return Result{}, fmt.Errorf("%w: %v", errInvalidJSON, err)
	}
	out := newResult(catalog.ModerationClassifier, false)
	for _, c := range Categories {
		v, ok := raw[c]
		if !ok {
			return Result{}, fmt.Errorf("%w: missing %q", errInvalidJSON, c)
		}
		var p float64
		if err := json.Unmarshal(v, &p); err != nil || p < 0 || p > 1 {
			return Result{}, fmt.Errorf("%w: %q must be a number from 0 to 1", errInvalidJSON, c)
		}
		out.set(c, p)
	}
	return out, nil
}
