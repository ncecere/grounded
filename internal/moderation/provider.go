package moderation

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/systemone"
)

// Stages of a chat that are moderated.
const (
	StageInput  = "input"  // the user's message, before retrieval
	StageOutput = "output" // the final answer
)

// Input is the text to judge.
type Input struct {
	Stage string // StageInput or StageOutput
	Text  string // the user's message (input) or the answer (output)
	// Question is the user's message when judging an answer, as context
	// for providers that judge a conversation (guardrail models).
	Question string
}

// Provider answers the moderation questions about a text with a score per
// category. Implementations are the adapters of ADR-0019.
type Provider interface {
	Check(ctx context.Context, in Input) (Result, error)
}

// NewProvider builds the adapter for a moderation model.
func NewProvider(t catalog.ModerationTarget) (Provider, error) {
	m := t.Model
	switch kind := catalog.ModerationProviderOf(m); kind {
	case catalog.ModerationEndpoint:
		return &moderationsEndpoint{cl: t.Client, model: m.UpstreamModel}, nil
	case catalog.ModerationClassifier:
		return &classifier{chat: chatCaller{cl: t.Client, model: m.UpstreamModel, compat: catalog.DecodeCompat(m.Compat)}}, nil
	case catalog.ModerationSystemOne:
		return &systemOne{cl: systemone.NewTargetClient(t)}, nil
	case catalog.ModerationGuardrail:
		chat := chatCaller{cl: t.Client, model: m.UpstreamModel, compat: catalog.DecodeCompat(m.Compat), logprobs: true}
		family := ""
		if m.ModerationFamily != nil {
			family = *m.ModerationFamily
		}
		switch family {
		case catalog.FamilyLlamaGuard:
			return &llamaGuard{chat: chat}, nil
		case catalog.FamilyGraniteGuardian:
			return &graniteGuardian{chat: chat}, nil
		case catalog.FamilyShieldGemma:
			return &shieldGemma{chat: chat}, nil
		}
		return nil, fmt.Errorf("moderation: unknown guardrail family %q", family)
	default:
		return nil, fmt.Errorf("moderation: unknown provider %q", kind)
	}
}

// badResponse is a provider answer we could not understand.
func badResponse(format string, args ...any) error {
	return &gateway.Error{Kind: gateway.KindBadResponse, Message: fmt.Sprintf(format, args...)}
}

// ---- chat completions with log-probabilities -----------------------------------

// chatCaller calls /chat/completions for the guardrail and classifier
// adapters. It asks for log-probabilities when logprobs is set and retries
// once without them if the server rejects the request.
type chatCaller struct {
	cl       *gateway.Client
	model    string
	compat   catalog.Compat
	logprobs bool
}

type chatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// tokenProb is one generated token with the top alternatives' log-probabilities.
type tokenProb struct {
	Token   string  `json:"token"`
	Logprob float64 `json:"logprob"`
	Top     []struct {
		Token   string  `json:"token"`
		Logprob float64 `json:"logprob"`
	} `json:"top_logprobs"`
}

type chatReply struct {
	Text   string
	Tokens []tokenProb // nil when the server returned no log-probabilities
}

// complete sends messages; extra holds server extensions such as
// chat_template_kwargs.
func (c chatCaller) complete(ctx context.Context, msgs []chatMsg, maxTokens int, extra map[string]any) (chatReply, error) {
	body := map[string]any{"model": c.model, "messages": msgs, "temperature": 0, "stream": false}
	field := "max_tokens"
	if c.compat.MaxTokensField != nil {
		field = *c.compat.MaxTokensField
	}
	body[field] = maxTokens
	if c.compat.SupportsReasoningEffort != nil && *c.compat.SupportsReasoningEffort {
		body["reasoning_effort"] = "low"
	}
	for k, v := range extra {
		body[k] = v
	}
	// The model's own extraBody (DESIGN.md §10) never overrides the above.
	gateway.MergeExtra(body, c.compat.ExtraBody)
	if c.logprobs {
		body["logprobs"], body["top_logprobs"] = true, 10
	}
	out, err := c.post(ctx, body)
	var ge *gateway.Error
	if c.logprobs && errors.As(err, &ge) && ge.Kind == gateway.KindBadRequest {
		delete(body, "logprobs")
		delete(body, "top_logprobs")
		out, err = c.post(ctx, body)
	}
	return out, err
}

func (c chatCaller) post(ctx context.Context, body map[string]any) (chatReply, error) {
	var res struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Logprobs *struct {
				Content []tokenProb `json:"content"`
			} `json:"logprobs"`
		} `json:"choices"`
	}
	if err := c.cl.PostJSON(ctx, "/chat/completions", body, &res); err != nil {
		return chatReply{}, err
	}
	if len(res.Choices) == 0 {
		return chatReply{}, badResponse("no choices returned")
	}
	ch := res.Choices[0]
	out := chatReply{Text: ch.Message.Content}
	if ch.Logprobs != nil && len(ch.Logprobs.Content) > 0 {
		out.Tokens = ch.Logprobs.Content
	}
	return out, nil
}

// normToken lowers a token and strips tokenizer space markers.
func normToken(t string) string {
	t = strings.NewReplacer("Ġ", "", "▁", "").Replace(t)
	return strings.ToLower(strings.TrimSpace(t))
}

// labelProbability finds the first generated token that is one of the two
// labels (yes/no, unsafe/safe) and returns P(positive) from the top
// log-probabilities, normalised over the two labels. ok is false when the
// reply has no log-probabilities or no label token.
func labelProbability(tokens []tokenProb, positive, negative string) (p float64, ok bool) {
	for _, t := range tokens {
		tok := normToken(t.Token)
		if tok != positive && tok != negative {
			continue
		}
		var pos, neg float64
		for _, alt := range t.Top {
			switch normToken(alt.Token) {
			case positive:
				pos += math.Exp(alt.Logprob)
			case negative:
				neg += math.Exp(alt.Logprob)
			}
		}
		if pos+neg == 0 { // no alternatives listed: the chosen token's probability
			if tok == positive {
				return math.Exp(t.Logprob), true
			}
			return 1 - math.Exp(t.Logprob), true
		}
		return pos / (pos + neg), true
	}
	return 0, false
}

// conversation is the chat judged by guardrail models: the user's message,
// and for output checks the answer after it.
func conversation(in Input) []chatMsg {
	if in.Stage == StageOutput {
		return []chatMsg{{Role: "user", Content: in.Question}, {Role: "assistant", Content: in.Text}}
	}
	return []chatMsg{{Role: "user", Content: in.Text}}
}

// fanOut runs one call per item concurrently and returns the first error.
func fanOut[T any](ctx context.Context, items []T, call func(context.Context, T) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var (
		wg    sync.WaitGroup
		once  sync.Once
		first error
	)
	for _, it := range items {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := call(ctx, it); err != nil {
				once.Do(func() { first = err; cancel() })
			}
		}()
	}
	wg.Wait()
	return first
}
