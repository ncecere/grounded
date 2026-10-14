package agents

import (
	"context"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/llm"
)

// A model that cannot stop thinking spends the suggestion call's whole budget on reasoning and writes nothing (issue
// #7: every call ended at exactly 1,024 tokens after 2.5 to 5.7 seconds). One retry with a larger budget gets the
// chips, just later. The retry is bounded: suggestions are sent before the stream's done.
const (
	suggestRetryMaxTokens = 4096
	suggestRetryTimeout   = 20 * time.Second
)

// thinkingExhausted reports a reply the budget ran out on before the model wrote anything. Text at the limit is parsed
// as it is, and a reply that stopped on its own without text would not be helped by more tokens.
func thinkingExhausted(m llm.AssistantMessage) bool {
	return m.StopReason == llm.StopReasonLength && strings.TrimSpace(m.Text()) == ""
}

// suggestRetryBudget sizes the retry from what the model reasoned: that plus the normal budget, so there is room for
// the questions after it, never below twice the normal budget and never above the cap. Gateways that don't report
// reasoning tokens get the cap.
func suggestRetryBudget(m llm.AssistantMessage) int {
	if m.Usage.Reasoning <= 0 {
		return suggestRetryMaxTokens
	}
	return min(max(m.Usage.Reasoning+suggestMaxTokens, 2*suggestMaxTokens), suggestRetryMaxTokens)
}

// completeSuggestions is the suggestion call: bounded in tokens and time, retried once when thinking used the budget
// up. The returned message's usage is the sum of both calls (both are billed), and its text is the last call's.
func completeSuggestions(ctx context.Context, p llm.Provider, model llm.Model, input, effort, user string) (llm.AssistantMessage, error) {
	call := func(maxTokens int, timeout time.Duration) (llm.AssistantMessage, error) {
		cctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return llm.Complete(cctx, p, model, llm.Context{SystemPrompt: suggestPrompt, Messages: []llm.Message{llm.UserMessage{Content: input}}},
			llm.Options{MaxTokens: maxTokens, ReasoningEffort: effort, User: user})
	}
	first, err := call(suggestMaxTokens, suggestTimeout)
	if err != nil || !thinkingExhausted(first) || ctx.Err() != nil {
		return first, err
	}
	second, err := call(suggestRetryBudget(first), suggestRetryTimeout)
	addUsage(&second.Usage, first.Usage)
	return second, err
}
