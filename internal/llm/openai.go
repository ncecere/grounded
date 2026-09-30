package llm

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/gateway"
)

// DefaultIdleTimeout is how long a stream may go without receiving any data
// (including keep-alive comments) before it is treated as dead.
const DefaultIdleTimeout = 60 * time.Second

// maxJSONResponse bounds a non-streamed body returned to a streaming request.
const maxJSONResponse = 16 << 20

// OpenAI is the Provider for OpenAI-compatible chat completions (the only
// adapter in v1). It sends every request through a gateway.Client, so the
// connection's base URL, API key, timeout and error kinds apply.
type OpenAI struct {
	Client *gateway.Client
	// IdleTimeout bounds the gap between chunks once the response has
	// started; 0 means DefaultIdleTimeout. The connection timeout bounds only
	// the wait for the response headers.
	IdleTimeout time.Duration
}

// NewOpenAI returns an adapter for client.
func NewOpenAI(client *gateway.Client) *OpenAI {
	return &OpenAI{Client: client}
}

var errIdle = errors.New("idle timeout")

// Stream implements Provider.
func (p *OpenAI) Stream(ctx context.Context, model Model, c Context, opts Options) <-chan Event {
	ch := make(chan Event, 16)
	go func() {
		defer close(ch)
		a := newAssembler(ch, model.ID, model.Compat.ThinkingField)
		ctx, span := gateway.StartModelSpan(ctx, gateway.OperationChat, model.ID,
			attribute.Bool("grounded.llm.stream", true), attribute.Int("grounded.llm.tools", len(c.Tools)))
		start := time.Now()
		p.run(ctx, a, model, c, opts)
		endStreamSpan(span, a, start)
	}()
	return ch
}

// endStreamSpan records a streamed call on its span: the time to the first
// token, the token counts and the stop reason (never the content).
func endStreamSpan(span trace.Span, a *assembler, start time.Time) {
	m := a.msg
	if !a.firstDelta.IsZero() {
		span.SetAttributes(attribute.Float64("grounded.llm.time_to_first_token_ms", float64(a.firstDelta.Sub(start).Microseconds())/1000))
	}
	span.SetAttributes(attribute.String("gen_ai.response.finish_reasons", string(m.StopReason)))
	var err error
	if m.StopReason == StopReasonError || m.StopReason == StopReasonAborted {
		err = &gateway.Error{Kind: cmp.Or(m.ErrorKind, string(m.StopReason))}
	}
	gateway.EndModelSpan(span, m.Usage.Input, m.Usage.Output, err)
}

func (p *OpenAI) run(ctx context.Context, a *assembler, model Model, c Context, opts Options) {
	if ctx.Err() != nil {
		a.fail(StopReasonAborted, "", "Request was aborted", ctx.Err())
		return
	}
	idle := p.IdleTimeout
	if idle <= 0 {
		idle = DefaultIdleTimeout
	}
	reqCtx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)

	res, err := p.Client.PostStream(reqCtx, "/chat/completions", buildRequest(model, c, opts, true))
	if err != nil {
		a.failErr(ctx, err)
		return
	}
	defer res.Body.Close()

	timer := time.AfterFunc(idle, func() { cancel(errIdle) })
	defer timer.Stop()
	resetIdle := func() { timer.Reset(idle) }

	a.start()
	if strings.Contains(res.ContentType, "application/json") {
		// The proxy ignored "stream": read the whole completion as one chunk.
		readCompletion(ctx, reqCtx, idle, a, res.Body)
		return
	}
	readEvents(ctx, reqCtx, idle, a, newSSEReader(res.Body, resetIdle))
}

// readCompletion reads a non-streamed chat completion as one chunk.
func readCompletion(ctx, reqCtx context.Context, idle time.Duration, a *assembler, body io.Reader) {
	raw, err := io.ReadAll(io.LimitReader(body, maxJSONResponse))
	if err != nil {
		a.failRead(ctx, reqCtx, idle, err)
		return
	}
	var ch chunk
	if err := json.Unmarshal(raw, &ch); err != nil {
		a.fail(StopReasonError, gateway.KindBadResponse, "response is not a chat completion", err)
		return
	}
	for i := range ch.Choices {
		if m := ch.Choices[i].Message; m != nil {
			ch.Choices[i].Delta = *m
			for j := range ch.Choices[i].Delta.ToolCalls {
				if ch.Choices[i].Delta.ToolCalls[j].Index == nil {
					idx := j
					ch.Choices[i].Delta.ToolCalls[j].Index = &idx
				}
			}
		}
	}
	if a.handle(&ch) {
		a.finish(true)
	}
}

// readEvents reads a streamed chat completion until [DONE], the end of the
// stream or an error.
func readEvents(ctx, reqCtx context.Context, idle time.Duration, a *assembler, sse *sseReader) {
	for {
		ev, err := sse.Next()
		if err == io.EOF {
			a.finish(false)
			return
		}
		if err != nil {
			a.failRead(ctx, reqCtx, idle, err)
			return
		}
		data := bytes.TrimSpace(ev.Data)
		if string(data) == "[DONE]" {
			a.finish(true)
			return
		}
		if len(data) == 0 {
			continue
		}
		var ch chunk
		if err := json.Unmarshal(data, &ch); err != nil {
			a.fail(StopReasonError, gateway.KindBadResponse, "malformed stream chunk from the model", err)
			return
		}
		if ev.Event == "error" && ch.Error == nil {
			a.fail(StopReasonError, gateway.KindUnavailable, "the model stream reported an error", nil)
			return
		}
		if !a.handle(&ch) {
			return
		}
	}
}

// --- wire chunk -----------------------------------------------------------

type chunk struct {
	ID      string        `json:"id"`
	Choices []chunkChoice `json:"choices"`
	Usage   *wireUsage    `json:"usage"`
	Error   *struct {
		Message string `json:"message"`
		Code    any    `json:"code"`
	} `json:"error"`
}

type chunkChoice struct {
	Delta        chunkDelta  `json:"delta"`
	Message      *chunkDelta `json:"message"` // non-streamed responses
	FinishReason *string     `json:"finish_reason"`
}

type chunkDelta struct {
	Content          *string         `json:"content"`
	ReasoningContent *string         `json:"reasoning_content"`
	Reasoning        *string         `json:"reasoning"`
	ReasoningText    *string         `json:"reasoning_text"`
	ToolCalls        []toolCallDelta `json:"tool_calls"`
}

type toolCallDelta struct {
	Index    *int   `json:"index"`
	ID       string `json:"id"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type wireUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	// ReasoningTokens is where SGLang reports reasoning, beside
	// completion_tokens rather than in completion_tokens_details.
	ReasoningTokens     int `json:"reasoning_tokens"`
	PromptTokensDetails *struct {
		CachedTokens     int `json:"cached_tokens"`
		CacheWriteTokens int `json:"cache_write_tokens"`
	} `json:"prompt_tokens_details"`
	CompletionTokensDetails *struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details"`
}

func (u *wireUsage) usage() Usage {
	out := Usage{Input: u.PromptTokens, Output: u.CompletionTokens, Total: u.TotalTokens}
	if d := u.PromptTokensDetails; d != nil {
		out.CacheRead, out.CacheWrite = d.CachedTokens, d.CacheWriteTokens
	}
	if d := u.CompletionTokensDetails; d != nil {
		out.Reasoning = d.ReasoningTokens
	}
	if out.Reasoning == 0 {
		out.Reasoning = u.ReasoningTokens
	}
	if out.Total == 0 {
		out.Total = out.Input + out.Output
	}
	return out
}

func (d *chunkDelta) thinking(field string) string {
	pick := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	switch field {
	case "reasoning_content":
		return pick(d.ReasoningContent)
	case "reasoning":
		return pick(d.Reasoning)
	}
	// Auto: the first non-empty field, so a server that sends the same text
	// in two fields is not read twice.
	for _, p := range []*string{d.ReasoningContent, d.Reasoning, d.ReasoningText} {
		if s := pick(p); s != "" {
			return s
		}
	}
	return ""
}
