package catalog

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/llm"
)

// thinkingProvider answers the thinking-off probe with one scripted message (or error) and records the options.
type thinkingProvider struct {
	msg  llm.AssistantMessage
	opts []llm.Options
}

func (p *thinkingProvider) Stream(_ context.Context, _ llm.Model, _ llm.Context, o llm.Options) <-chan llm.Event {
	p.opts = append(p.opts, o)
	ch := make(chan llm.Event, 2)
	ch <- llm.Event{Type: llm.EventStart, ContentIndex: -1}
	if p.msg.StopReason == llm.StopReasonError {
		ch <- llm.Event{Type: llm.EventError, ContentIndex: -1, Reason: llm.StopReasonError, Message: p.msg, Err: errors.New(p.msg.ErrorMessage)}
	} else {
		ch <- llm.Event{Type: llm.EventDone, ContentIndex: -1, Reason: p.msg.StopReason, Message: p.msg}
	}
	close(ch)
	return ch
}

func pong() llm.AssistantMessage {
	return llm.AssistantMessage{StopReason: llm.StopReasonStop, Usage: llm.Usage{Output: 3}, Content: []llm.Block{llm.Text{Text: "pong"}}}
}

func TestStillThinking(t *testing.T) {
	cases := []struct {
		name       string
		msg        llm.AssistantMessage
		wantOn     bool
		wantTokens int
	}{
		{"a plain reply", pong(), false, 0},
		{"a reasoning block", llm.AssistantMessage{Content: []llm.Block{llm.Thinking{Text: "The user wants…"}, llm.Text{Text: "pong"}}}, true, 0},
		{"reasoning tokens reported without the text", llm.AssistantMessage{Usage: llm.Usage{Output: 340, Reasoning: 330}, Content: []llm.Block{llm.Text{Text: "pong"}}}, true, 330},
		{"think tags in the text", llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: "<think>Let me see</think>pong"}}}, true, 0},
		{"the word think in an ordinary reply is not a think tag", llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: "I think pong"}}}, false, 0},
		{"an empty reasoning block is not reasoning", llm.AssistantMessage{Content: []llm.Block{llm.Thinking{Text: "  "}, llm.Text{Text: "pong"}}}, false, 0},
	}
	for _, c := range cases {
		on, tokens := stillThinking(c.msg)
		if on != c.wantOn || tokens != c.wantTokens {
			t.Errorf("%s: stillThinking = (%v, %d), want (%v, %d)", c.name, on, tokens, c.wantOn, c.wantTokens)
		}
	}
}

func TestThinkingOffSetting(t *testing.T) {
	if got := thinkingOffSetting(llm.ThinkingOffEffortNone); got != "reasoning_effort: none" {
		t.Errorf("effort none = %q", got)
	}
	if got := thinkingOffSetting(llm.ThinkingOffTemplateKwarg); got != "chat_template_kwargs.enable_thinking: false" {
		t.Errorf("template kwarg = %q", got)
	}
}

func TestCheckThinkingOffAsksTheWayTheChatPathDoes(t *testing.T) {
	p := &thinkingProvider{msg: pong()}
	model := llm.Model{ID: "m", Compat: llm.Compat{ThinkingOff: llm.ThinkingOffEffortNone}}
	got := checkThinkingOff(context.Background(), p, model, "admin-test")
	if len(p.opts) != 1 || p.opts[0].ReasoningEffort != llm.EffortOff || p.opts[0].User != "admin-test" {
		t.Fatalf("options = %+v, want one call with reasoning effort off", p.opts)
	}
	if p.opts[0].MaxTokens < 64 {
		t.Errorf("MaxTokens = %d: too small to let reasoning show up before the reply", p.opts[0].MaxTokens)
	}
	if got == nil || !got.Honoured || got.Setting != "reasoning_effort: none" || got.ReasoningTokens != 0 || got.Error != "" {
		t.Errorf("result = %+v, want honoured", got)
	}
}

func TestCheckThinkingOffReportsAModelThatStillReasons(t *testing.T) {
	p := &thinkingProvider{msg: llm.AssistantMessage{StopReason: llm.StopReasonLength, Usage: llm.Usage{Output: 256, Reasoning: 250},
		Content: []llm.Block{llm.Thinking{Text: "The user wants me to reply with pong…"}}}}
	model := llm.Model{ID: "m", Compat: llm.Compat{ThinkingOff: llm.ThinkingOffTemplateKwarg}}
	got := checkThinkingOff(context.Background(), p, model, "u")
	if got == nil || got.Honoured || got.ReasoningTokens != 250 {
		t.Fatalf("result = %+v, want not honoured with 250 reasoning tokens", got)
	}
	for _, want := range []string{"isn't honoured", "chat_template_kwargs.enable_thinking: false"} {
		if !strings.Contains(got.Message, want) {
			t.Errorf("message %q lacks %q", got.Message, want)
		}
	}
}

func TestCheckThinkingOffDoesNotFailTheTestWhenTheProbeFails(t *testing.T) {
	p := &thinkingProvider{msg: llm.AssistantMessage{StopReason: llm.StopReasonError, ErrorMessage: "gateway timeout", ErrorKind: "timeout"}}
	model := llm.Model{ID: "m", Compat: llm.Compat{ThinkingOff: llm.ThinkingOffEffortNone}}
	got := checkThinkingOff(context.Background(), p, model, "u")
	if got == nil || got.Error == "" || got.Honoured {
		t.Fatalf("result = %+v, want an error that says the check could not run", got)
	}
	if !strings.Contains(got.Message, "wasn't checked") {
		t.Errorf("message = %q, want it to say the check wasn't run (not that thinking is on)", got.Message)
	}
}

func TestCheckThinkingOffIsSkippedWithoutASetting(t *testing.T) {
	p := &thinkingProvider{msg: pong()}
	if got := checkThinkingOff(context.Background(), p, llm.Model{ID: "m"}, "u"); got != nil {
		t.Errorf("result = %+v, want none: there is no thinking-off setting to check", got)
	}
	if len(p.opts) != 0 {
		t.Errorf("calls = %d, want none", len(p.opts))
	}
}
