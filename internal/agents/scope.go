// The scope check in the chat pipeline (docs/systemone.md §4, ADR-0020):
// before the search's results are used, the SystemOne model says whether
// the message is small talk and whether it is within the agent's subject.
// Small talk is answered briefly without sources; a strict agent refuses
// an out-of-scope question without judging or a chat-model call. It runs
// concurrently with input moderation, the query rewrite and the search
// (whose results are then discarded; progress.go), and fails open (the
// message is answered normally). Only decisions are recorded.

package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/agentloop"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/systemone"
)

// No-context reasons of the scope check.
const (
	// NoContextSmallTalk: the message was small talk, answered without
	// retrieval.
	NoContextSmallTalk = "small_talk"
	// NoContextOutOfScope: a strict agent refused a message outside its
	// subject without retrieval or a chat-model call.
	NoContextOutOfScope = "out_of_scope"
)

// Scope actions (message_events.scope.action).
const (
	scopeActionNone    = "none"    // answered normally
	scopeActionReply   = "reply"   // small talk, answered without retrieval
	scopeActionRefused = "refused" // out of scope, strict: refused
)

// smallTalkMaxTokens bounds the small-talk reply (reasoning included).
const smallTalkMaxTokens = 1024

// ScopeRecord is the content-free record of a scope check
// (message_events.scope).
type ScopeRecord struct {
	Decision  string   `json:"decision"`
	Action    string   `json:"action"`
	SmallTalk *float64 `json:"smallTalk,omitempty"`
	InScope   *float64 `json:"inScope,omitempty"`
	LatencyMs int64    `json:"latencyMs"`
}

// startScopeCheck checks the message in the background (nil when off).
func (ru *run) startScopeCheck(ctx context.Context) <-chan systemone.ScopeResult {
	if ru.scope == nil {
		return nil
	}
	st := systemone.ScopeState{Message: ru.question, PreviousMessage: ru.previousQuestion(),
		Agent: systemone.ScopeAgent{Name: ru.agent.Name, Description: ru.agent.Description, Subject: systemone.Summary(ru.cfg.Instructions)}}
	plan := ru.scope
	ch := make(chan systemone.ScopeResult, 1)
	go func() { ch <- plan.Client.CheckScope(ctx, st, plan.Settings) }()
	return ch
}

// previousQuestion is the user's previous message, if any.
func (ru *run) previousQuestion() string {
	for i := len(ru.history) - 1; i >= 0; i-- {
		if m, ok := ru.history[i].(llm.UserMessage); ok {
			return truncateRunes(m.Content, 2000)
		}
	}
	return ""
}

// awaitScope waits for the scope check and returns its decision ("" when
// it did not run).
func (ru *run) awaitScope(ch <-chan systemone.ScopeResult) string {
	if ch == nil {
		return ""
	}
	res := <-ch
	if res.Err != nil {
		ru.s.Log.Warn("scope check failed; answering normally", "err", res.Err, "agent", ru.agent.ID)
	}
	rec := &ScopeRecord{Decision: res.Decision, Action: scopeActionNone, LatencyMs: res.Latency.Milliseconds()}
	if res.Err == nil {
		st, in := res.SmallTalk, res.InScope
		rec.SmallTalk, rec.InScope = &st, &in
	}
	switch {
	case res.Decision == systemone.ScopeSmallTalk:
		rec.Action = scopeActionReply
	case res.Decision == systemone.ScopeOutOfScope && ru.cfg.StrictlyGrounded:
		rec.Action = scopeActionRefused
	}
	ru.scopeRec = rec
	return res.Decision
}

// OutOfScopeMessage is the answer to a question outside a strict agent's
// subject (the scope check): not the refusal message, which says the
// sources had nothing, since nothing was searched.
func OutOfScopeMessage(agentName string) string {
	return "This is outside what " + agentName + " covers."
}

// refuseOutOfScope answers an out-of-scope question with OutOfScopeMessage,
// without retrieval or a chat-model call.
func (ru *run) refuseOutOfScope(ctx context.Context) (Answer, error) {
	ru.noContextReason = NoContextOutOfScope
	return ru.refuseWithoutModel(ctx)
}

// smallTalk replies to small talk with a short chat-model call: no
// retrieval, no tools, no sources block.
func (ru *run) smallTalk(ctx context.Context) (Answer, error) {
	ru.noContextReason = NoContextSmallTalk
	sys := smallTalkPrompt(ru.agent.Name, ru.team.Name, ru.s.OrgName, ru.agent.Description, ru.now(ctx))
	msgs := append([]llm.Message(nil), ru.history...)
	msgs = append(msgs, llm.UserMessage{Content: ru.question})
	opts := ru.options(false)
	if opts.MaxTokens == 0 || opts.MaxTokens > smallTalkMaxTokens {
		opts.MaxTokens = smallTalkMaxTokens
	}
	ru.status(StepAnswering)
	st := &loopState{}
	cfg := agentloop.Config{Provider: ru.s.NewProvider(ru.target.Client), Model: ru.model, SystemPrompt: sys, MaxTurns: 1, Options: opts}
	added, runErr := agentloop.Run(ctx, cfg, msgs, func(ev agentloop.Event) { ru.onEvent(ev, st) })
	return ru.finish(ctx, added, runErr, st)
}

// smallTalkPrompt is the system prompt of a small-talk reply. It must not
// contain the query rewrite's word ("standalone"); the fake gateway
// recognises "latest message is small talk".
func smallTalkPrompt(agentName, teamName, orgName, description string, now time.Time) string {
	var b strings.Builder
	provider := teamName
	if org := strings.TrimSpace(orgName); org != "" {
		provider += " at " + org
	}
	fmt.Fprintf(&b, "You are %s, an assistant provided by %s. Today is %s.\n", agentName, provider, now.Format("Monday, January 2, 2006"))
	if d := strings.TrimSpace(description); d != "" {
		fmt.Fprintf(&b, "What you help with: %s\n", d)
	}
	b.WriteString("\nThe user's latest message is small talk: a greeting, thanks, a goodbye or a pleasantry. Reply briefly and " +
		"naturally, in one or two sentences and in the user's language, and offer to help with questions about what you " +
		"help with. Do not state facts, give instructions or cite sources in this reply.\n")
	return b.String()
}

// scopeJSON is the message_events.scope value (nil when not checked).
func (ru *run) scopeJSON() json.RawMessage {
	if ru.scopeRec == nil {
		return nil
	}
	b, _ := json.Marshal(ru.scopeRec)
	return b
}
