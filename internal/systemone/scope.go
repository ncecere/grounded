// The scope check (docs/systemone.md §4): before retrieval, is the message
// small talk, and is it within the agent's subject? Two yes/no questions
// in one request; the thresholds and routing live in code.

package systemone

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"
)

// Question IDs of the scope check.
const (
	QSmallTalk = "small_talk"
	QInScope   = "in_scope"
)

// Scope decisions.
const (
	ScopeInScope    = "in_scope"     // answered normally
	ScopeSmallTalk  = "small_talk"   // answered briefly without retrieval
	ScopeOutOfScope = "out_of_scope" // a strict agent refuses without retrieval
	ScopeSkipped    = "skipped"      // the request failed: answered normally
)

var scopeQuestions = map[string]Question{
	QSmallTalk: Noul("Is `message` only small talk, such as a greeting, thanks, a goodbye or a pleasantry, with no question or request for information?",
		"It is only small talk: there is nothing to look up or answer.",
		"It asks for information or help, even if it also greets or thanks."),
	QInScope: Noul("Is `message` about the subject `agent` is meant to help with, judging from its name, description and subject?",
		"It asks about something within the agent's subject.",
		"It is about something else, outside what the agent covers."),
}

// ScopeQuestions returns the scope-check questions (tests and tools).
func ScopeQuestions() map[string]Question { return scopeQuestions }

// ScopeAgent describes the agent to the model.
type ScopeAgent struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// Subject is a summary of the agent's instructions.
	Subject string `json:"subject,omitempty"`
}

// ScopeState is the state of a scope check. PreviousMessage is the user's
// previous message in a conversation, so a follow-up ("and the fee?") is
// judged in context.
type ScopeState struct {
	Message         string     `json:"message"`
	PreviousMessage string     `json:"previous_message,omitempty"`
	Agent           ScopeAgent `json:"agent"`
}

// maxSubjectRunes bounds the instructions summary.
const maxSubjectRunes = 1200

// Summary shortens instructions to the subject summary: whitespace
// collapsed, cut at a word boundary.
func Summary(instructions string) string {
	s := strings.Join(strings.Fields(instructions), " ")
	if utf8.RuneCountInString(s) <= maxSubjectRunes {
		return s
	}
	s = string([]rune(s)[:maxSubjectRunes])
	if i := strings.LastIndexByte(s, ' '); i > maxSubjectRunes/2 {
		s = s[:i]
	}
	return s + " …"
}

// ScopeResult is the outcome of a scope check.
type ScopeResult struct {
	SmallTalk, InScope float64
	Decision           string
	Latency            time.Duration
	Err                error
}

// RouteScope decides from the answers; small talk wins over scope (a
// greeting is outside every agent's subject).
func RouteScope(smallTalk, inScope float64, s Scope) string {
	switch {
	case smallTalk >= s.SmallTalk:
		return ScopeSmallTalk
	case inScope < s.InScope:
		return ScopeOutOfScope
	}
	return ScopeInScope
}

// CheckScope asks the scope questions. It never fails: on error the
// decision is skipped (the message is answered normally).
func (cl *Client) CheckScope(ctx context.Context, st ScopeState, s Scope) ScopeResult {
	start := time.Now()
	res, err := cl.Ask(ctx, Call{Feature: FeatureScope, Timeout: s.Timeout()}, st, scopeQuestions)
	out := ScopeResult{Latency: time.Since(start), Err: err, Decision: ScopeSkipped}
	if err != nil {
		return out
	}
	out.SmallTalk, out.InScope = res.Noul(QSmallTalk), res.Noul(QInScope)
	out.Decision = RouteScope(out.SmallTalk, out.InScope, s)
	return out
}
