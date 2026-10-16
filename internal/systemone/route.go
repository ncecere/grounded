// The routing question (docs/specs/v0.6.0/DESIGN.md §4): a router agent asks which of the agents it may send a
// question to is the best place for it. One choice question; the options are the candidates, described by
// name, description and a summary of their instructions, plus small talk and none. What a choice does (answer
// it, send it on, say nothing fits) is decided in code by the caller, as for the scope check.

package systemone

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// QRoute is the question ID of the routing question.
const QRoute = "route"

// Routing decisions.
const (
	RouteRouted    = "routed"     // a candidate was chosen with enough confidence
	RouteNone      = "none"       // no candidate fits (or the model was not sure enough)
	RouteSmallTalk = "small_talk" // only a greeting or thanks: the router answers it itself
	RouteSkipped   = "skipped"    // the request failed
)

// Options that are not an agent.
const (
	optNone      = "none"
	optSmallTalk = "small_talk"
)

// RouteMinConfidence is the confidence a chosen agent needs; below it the question counts as fitting none.
const RouteMinConfidence = 0.5

// maxRouteDescription bounds one candidate's description to the model.
const maxRouteDescription = 700

// RouteAgent is a candidate. Key is the option the model chooses ("agent_1"…).
type RouteAgent struct {
	Key         string
	Name        string
	Team        string
	Description string
	Subject     string
}

// RouteState is the state of a routing request.
type RouteState struct {
	Message         string `json:"message"`
	PreviousMessage string `json:"previous_message,omitempty"`
}

// RouteQuestion builds the routing question for the candidates.
func RouteQuestion(agents []RouteAgent) Question {
	opts := make(map[string]string, len(agents)+2)
	for _, a := range agents {
		opts[a.Key] = describeRoute(a)
	}
	opts[optSmallTalk] = "The message is only small talk, such as a greeting, thanks or a goodbye, with no question or request."
	opts[optNone] = "No agent here covers what the message asks, or the message is too vague to tell. Choose this rather than guess."
	return Choice("Which option is the best place to send `message`? Each agent option names an assistant and says what it helps with; "+
		"choose the one whose subject the message is about. `previous_message`, when present, is the user's earlier message, so a follow-up is judged in context.", opts)
}

func describeRoute(a RouteAgent) string {
	var b strings.Builder
	fmt.Fprintf(&b, "The assistant %q", a.Name)
	if a.Team != "" {
		fmt.Fprintf(&b, " of %s", a.Team)
	}
	if d := strings.TrimSpace(a.Description); d != "" {
		b.WriteString(". It helps with: " + d)
	}
	if s := strings.TrimSpace(a.Subject); s != "" {
		b.WriteString(". Its instructions begin: " + s)
	}
	out := b.String()
	if utf8.RuneCountInString(out) > maxRouteDescription {
		out = string([]rune(out)[:maxRouteDescription]) + " …"
	}
	return out
}

// RouteResult is the outcome of a routing request. Key is the chosen candidate's option when Decision is routed.
type RouteResult struct {
	Decision   string
	Key        string
	Confidence float64
	Latency    time.Duration
	Err        error
}

// Route asks the routing question. It never fails: on error the decision is skipped, and the router answers as
// if nothing fit.
func (cl *Client) Route(ctx context.Context, st RouteState, agents []RouteAgent, s Scope) RouteResult {
	start := time.Now()
	qs := map[string]Question{QRoute: RouteQuestion(agents)}
	res, err := cl.Ask(ctx, Call{Feature: FeatureScope, Timeout: s.Timeout()}, st, qs)
	out := RouteResult{Latency: time.Since(start), Err: err, Decision: RouteSkipped}
	if err != nil {
		return out
	}
	a := res.Answers[QRoute]
	if a.Confidence != nil {
		out.Confidence = *a.Confidence
	} else if p, ok := a.Probabilities[a.Choice]; ok {
		out.Confidence = p
	} else {
		out.Confidence = 1 // a model that gives no confidence is taken at its word
	}
	out.Decision, out.Key = routeDecision(a.Choice, out.Confidence, agents)
	return out
}

// routeDecision maps the chosen option to a decision: an agent needs RouteMinConfidence.
func routeDecision(choice string, confidence float64, agents []RouteAgent) (decision, key string) {
	switch choice {
	case optSmallTalk:
		return RouteSmallTalk, ""
	case optNone:
		return RouteNone, ""
	}
	for _, a := range agents {
		if a.Key == choice && confidence >= RouteMinConfidence {
			return RouteRouted, a.Key
		}
	}
	return RouteNone, ""
}
