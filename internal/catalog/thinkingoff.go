package catalog

import (
	"context"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/llm"
)

// Some reasoning models ignore every way of turning thinking off (issue #7): the setting is saved, an agent's Reasoning
// effort Off does nothing, and quick calls such as follow-up suggestions stay slow. The model Test therefore asks once,
// the way the chat path does, and says whether the model still reasoned.

// ThinkingOffTest is the result of the extra request a chat model's Test sends when the model has a way to turn
// thinking off.
type ThinkingOffTest struct {
	// Setting is the way configured, as an admin reads it: "reasoning_effort: none".
	Setting string
	// Honoured is true when the reply had no reasoning.
	Honoured bool
	// ReasoningTokens is what the gateway reported, when it did (0: not reported or none).
	ReasoningTokens int
	// Error is set when the check itself could not run (the model's ordinary test is not affected).
	Error string
	// Message says it in a sentence for the Test result.
	Message string
}

// thinkingOffProbeTokens leaves room for reasoning to show up before the one-word reply; the timeout bounds a model that
// reasons at length anyway.
const (
	thinkingOffProbeTokens  = 256
	thinkingOffProbeTimeout = 30 * time.Second
)

// thinkingOffSetting is a configured way to turn thinking off, as the Compatibility section shows it.
func thinkingOffSetting(way string) string {
	switch way {
	case llm.ThinkingOffEffortNone:
		return "reasoning_effort: none"
	case llm.ThinkingOffTemplateKwarg:
		return "chat_template_kwargs.enable_thinking: false"
	}
	return way
}

// stillThinking reports reasoning in a reply: a reasoning block, reasoning tokens the gateway counted, or think tags in
// the text. It returns the counted tokens (0 when not reported).
func stillThinking(m llm.AssistantMessage) (bool, int) {
	if strings.TrimSpace(m.Thinking()) != "" || m.Usage.Reasoning > 0 || strings.Contains(m.Text(), "<think>") {
		return true, m.Usage.Reasoning
	}
	return false, 0
}

// checkThinkingOff sends the probe with thinking off requested exactly as an agent's Reasoning effort Off does
// (llm applies the model's compatibility), and reads the reply. It returns nil when the model has no way to turn
// thinking off, so there is nothing to check.
func checkThinkingOff(ctx context.Context, p llm.Provider, model llm.Model, user string) *ThinkingOffTest {
	if model.Compat.ThinkingOff == "" {
		return nil
	}
	res := &ThinkingOffTest{Setting: thinkingOffSetting(model.Compat.ThinkingOff)}
	msg, err := llm.Complete(ctx, p, model, llm.Context{Messages: []llm.Message{llm.UserMessage{Content: "Reply with the single word: pong"}}},
		llm.Options{MaxTokens: thinkingOffProbeTokens, ReasoningEffort: llm.EffortOff, User: user})
	if err != nil {
		res.Error = err.Error()
		res.Message = "Thinking off wasn't checked: the request failed (" + res.Error + ")."
		return res
	}
	on, tokens := stillThinking(msg)
	res.Honoured, res.ReasoningTokens = !on, tokens
	if res.Honoured {
		res.Message = "Thinking off works: the model did not reason with " + res.Setting + "."
	} else {
		res.Message = "Thinking off isn't honoured by this model: it still reasoned with " + res.Setting + "."
	}
	return res
}
