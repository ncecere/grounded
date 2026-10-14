package agents

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/llm"
)

// replyProvider answers each call with the next scripted message and records the options it was called with.
type replyProvider struct {
	mu      sync.Mutex
	replies []llm.AssistantMessage
	opts    []llm.Options
}

func (p *replyProvider) Stream(_ context.Context, _ llm.Model, _ llm.Context, o llm.Options) <-chan llm.Event {
	p.mu.Lock()
	i := len(p.opts)
	p.opts = append(p.opts, o)
	msg := p.replies[min(i, len(p.replies)-1)]
	p.mu.Unlock()
	ch := make(chan llm.Event, 2)
	ch <- llm.Event{Type: llm.EventStart, ContentIndex: -1}
	ch <- llm.Event{Type: llm.EventDone, ContentIndex: -1, Reason: msg.StopReason, Message: msg}
	close(ch)
	return ch
}

func (p *replyProvider) calls() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.opts)
}

// A model that cannot stop thinking: it spends the whole budget reasoning and writes nothing.
func exhausted(reasoning int) llm.AssistantMessage {
	return llm.AssistantMessage{StopReason: llm.StopReasonLength, Usage: llm.Usage{Output: 1024, Reasoning: reasoning, Total: 1100},
		Content: []llm.Block{llm.Thinking{Text: "Let me think about the follow-up questions…"}}}
}

func answered(text string) llm.AssistantMessage {
	return llm.AssistantMessage{StopReason: llm.StopReasonStop, Usage: llm.Usage{Output: 60, Total: 160}, Content: []llm.Block{llm.Text{Text: text}}}
}

func TestThinkingExhausted(t *testing.T) {
	cases := []struct {
		name string
		msg  llm.AssistantMessage
		want bool
	}{
		{"no text at the token limit, with reasoning", exhausted(1000), true},
		{"no text at the token limit, reasoning not reported", llm.AssistantMessage{StopReason: llm.StopReasonLength}, true},
		{"text at the token limit is not exhausted (parse what there is)", llm.AssistantMessage{StopReason: llm.StopReasonLength, Content: []llm.Block{llm.Text{Text: "What next?"}}}, false},
		{"whitespace only counts as no text", llm.AssistantMessage{StopReason: llm.StopReasonLength, Content: []llm.Block{llm.Text{Text: " \n"}}}, true},
		{"a normal answer", answered("What next?"), false},
		{"stopped normally with no text: more budget will not help", llm.AssistantMessage{StopReason: llm.StopReasonStop, Usage: llm.Usage{Reasoning: 300}}, false},
		{"an error is not exhaustion", llm.AssistantMessage{StopReason: llm.StopReasonError}, false},
	}
	for _, c := range cases {
		if got := thinkingExhausted(c.msg); got != c.want {
			t.Errorf("%s: thinkingExhausted = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestSuggestRetryBudget(t *testing.T) {
	cases := []struct {
		name      string
		reasoning int
		want      int
	}{
		{"reasoning not reported: the full retry budget", 0, suggestRetryMaxTokens},
		{"reasoning reported: it plus the normal budget", 1500, 1500 + suggestMaxTokens},
		{"never above the cap", 9000, suggestRetryMaxTokens},
		{"never below twice the first budget", 10, 2 * suggestMaxTokens},
	}
	for _, c := range cases {
		if got := suggestRetryBudget(exhausted(c.reasoning)); got != c.want {
			t.Errorf("%s: budget = %d, want %d", c.name, got, c.want)
		}
	}
}

func callSuggestions(p llm.Provider) (llm.AssistantMessage, error) {
	return completeSuggestions(context.Background(), p, llm.Model{ID: "m"}, "input", llm.EffortOff, "user")
}

func TestCompleteSuggestionsRetriesOnceWithALargerBudget(t *testing.T) {
	p := &replyProvider{replies: []llm.AssistantMessage{exhausted(1500), answered("What does the policy say about refunds?")}}
	msg, err := callSuggestions(p)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if p.calls() != 2 {
		t.Fatalf("calls = %d, want 2", p.calls())
	}
	if p.opts[0].MaxTokens != suggestMaxTokens {
		t.Errorf("first budget = %d, want %d", p.opts[0].MaxTokens, suggestMaxTokens)
	}
	if want := 1500 + suggestMaxTokens; p.opts[1].MaxTokens != want {
		t.Errorf("retry budget = %d, want %d (the reasoning it saw plus the normal budget)", p.opts[1].MaxTokens, want)
	}
	if p.opts[1].ReasoningEffort != llm.EffortOff || p.opts[1].User != "user" {
		t.Errorf("the retry keeps the effort and the user tag: %+v", p.opts[1])
	}
	if msg.Text() != "What does the policy say about refunds?" {
		t.Errorf("text = %q", msg.Text())
	}
}

func TestCompleteSuggestionsSumsBothCallsUsage(t *testing.T) {
	p := &replyProvider{replies: []llm.AssistantMessage{exhausted(1000), answered("What next?")}}
	msg, _ := callSuggestions(p)
	// the first call cost 1100 tokens and the retry 160: both are billed, so both are recorded
	if msg.Usage.Total != 1100+160 || msg.Usage.Output != 1024+60 || msg.Usage.Reasoning != 1000 {
		t.Errorf("usage = %+v, want the sum of both calls", msg.Usage)
	}
}

func TestCompleteSuggestionsRetriesOnlyOnce(t *testing.T) {
	p := &replyProvider{replies: []llm.AssistantMessage{exhausted(1000)}} // every call exhausts
	msg, err := callSuggestions(p)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if p.calls() != 2 {
		t.Errorf("calls = %d, want 2: one retry, never a loop", p.calls())
	}
	if msg.Text() != "" {
		t.Errorf("text = %q, want none: no chips is the outcome, not an error", msg.Text())
	}
}

func TestCompleteSuggestionsDoesNotRetryAGoodOrFailedReply(t *testing.T) {
	for name, msg := range map[string]llm.AssistantMessage{
		"a normal reply":       answered("What next?"),
		"none":                 answered("NONE"),
		"an error":             {StopReason: llm.StopReasonError, ErrorMessage: "boom", ErrorKind: "upstream"},
		"stopped without text": {StopReason: llm.StopReasonStop},
	} {
		p := &replyProvider{replies: []llm.AssistantMessage{msg}}
		callSuggestions(p)
		if p.calls() != 1 {
			t.Errorf("%s: calls = %d, want 1", name, p.calls())
		}
	}
}

func TestCompleteSuggestionsStopsRetryingWhenTheRequestIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	p := &replyProvider{replies: []llm.AssistantMessage{exhausted(1000), answered("What next?")}}
	cancel()
	completeSuggestions(ctx, p, llm.Model{ID: "m"}, "input", llm.EffortOff, "user")
	if p.calls() > 1 {
		t.Errorf("calls = %d: a cancelled request must not start a second call", p.calls())
	}
}

func TestSuggestTimeoutsFitTheRetry(t *testing.T) {
	// the retry is allowed longer than the first call, and both stay bounded: suggestions come before the stream's done
	if suggestRetryTimeout <= suggestTimeout || suggestRetryTimeout > 30*time.Second {
		t.Errorf("retry timeout %v should be longer than %v and at most 30s", suggestRetryTimeout, suggestTimeout)
	}
}
