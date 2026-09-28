package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// streamResult is one streamed /chat/completions call.
type streamResult struct {
	Content        string
	Reasoning      string
	ReasoningField string // delta field that carried reasoning
	ToolCalls      []toolCall
	FinishReason   string
	PromptTokens   int
	OutputTokens   int
	ReasonTokens   int
	UsageInChunk   bool // a chunk carried usage
	UsageInFinal   bool // usage came in a chunk with no choices, or the last data chunk
	FirstAny       time.Duration
	FirstContent   time.Duration
	Total          time.Duration
	Chunks         int
}

type toolCall struct {
	ID, Name, Args string
}

// wireChunk is one chat.completion.chunk.
type wireChunk struct {
	Choices []wireChoice `json:"choices"`
	Usage   *wireUsage   `json:"usage"`
}

type wireChoice struct {
	Delta        wireDelta `json:"delta"`
	FinishReason *string   `json:"finish_reason"`
}

type wireDelta struct {
	Content          *string `json:"content"`
	ReasoningContent *string `json:"reasoning_content"`
	Reasoning        *string `json:"reasoning"`
	ReasoningText    *string `json:"reasoning_text"`
	ToolCalls        []struct {
		Index    int    `json:"index"`
		ID       string `json:"id"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	} `json:"tool_calls"`
}

// wireUsage accepts both places reasoning tokens are reported: OpenAI's
// completion_tokens_details (vLLM) and a top-level field (SGLang).
type wireUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	ReasoningTokens  int `json:"reasoning_tokens"`
	Details          *struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details"`
}

// streamParser accumulates a streamResult from SSE data lines.
type streamParser struct {
	res          streamResult
	start        time.Time
	calls        map[int]*toolCall
	lastHadUsage bool
}

// streamChat sends a streaming chat request and parses the SSE stream. When
// record is non-empty the raw stream is written there.
func (e *endpoint) streamChat(ctx context.Context, body map[string]any, record string) (streamResult, error) {
	body["model"] = e.model
	body["stream"] = true
	p := &streamParser{start: time.Now(), calls: map[int]*toolCall{}}
	resp, err := e.post(ctx, "/chat/completions", body)
	if err != nil {
		return p.res, err
	}
	defer resp.Body.Close()
	var src io.Reader = resp.Body
	if record != "" {
		if err := os.MkdirAll(filepath.Dir(record), 0o755); err != nil {
			return p.res, err
		}
		f, err := os.Create(record)
		if err != nil {
			return p.res, err
		}
		defer f.Close()
		src = io.TeeReader(resp.Body, f)
	}
	if err := p.read(src); err != nil {
		return p.res, err
	}
	return p.finish(), nil
}

// read consumes the stream up to [DONE].
func (p *streamParser) read(r io.Reader) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		data, ok := strings.CutPrefix(sc.Text(), "data:")
		if !ok {
			continue
		}
		data = strings.TrimSpace(data)
		if data == "[DONE]" {
			// Drain so a recording keeps the whole stream.
			_, _ = io.Copy(io.Discard, r)
			return nil
		}
		var ch wireChunk
		if err := json.Unmarshal([]byte(data), &ch); err != nil {
			return fmt.Errorf("bad chunk %q: %w", truncate(data, 200), err)
		}
		p.chunk(ch)
	}
	return sc.Err()
}

func (p *streamParser) chunk(ch wireChunk) {
	p.res.Chunks++
	p.lastHadUsage = false
	if u := ch.Usage; u != nil && u.CompletionTokens > 0 {
		p.res.UsageInChunk, p.lastHadUsage = true, true
		p.res.PromptTokens, p.res.OutputTokens, p.res.ReasonTokens = u.PromptTokens, u.CompletionTokens, u.ReasoningTokens
		if u.Details != nil && u.Details.ReasoningTokens > 0 {
			p.res.ReasonTokens = u.Details.ReasoningTokens
		}
		if len(ch.Choices) == 0 {
			p.res.UsageInFinal = true
		}
	}
	for _, c := range ch.Choices {
		p.delta(c.Delta, time.Since(p.start))
		if c.FinishReason != nil && *c.FinishReason != "" {
			p.res.FinishReason = *c.FinishReason
		}
	}
}

// delta applies one choice delta; now is the time since the request.
func (p *streamParser) delta(d wireDelta, now time.Duration) {
	seen := func() {
		if p.res.FirstAny == 0 {
			p.res.FirstAny = now
		}
	}
	for _, r := range []struct {
		name string
		v    *string
	}{{"reasoning_content", d.ReasoningContent}, {"reasoning", d.Reasoning}, {"reasoning_text", d.ReasoningText}} {
		if r.v != nil && *r.v != "" {
			p.res.Reasoning += *r.v
			if p.res.ReasoningField == "" {
				p.res.ReasoningField = r.name
			}
			seen()
			break
		}
	}
	if d.Content != nil && *d.Content != "" {
		p.res.Content += *d.Content
		seen()
		if p.res.FirstContent == 0 && strings.TrimSpace(*d.Content) != "" {
			p.res.FirstContent = now
		}
	}
	for _, tc := range d.ToolCalls {
		seen()
		c := p.calls[tc.Index]
		if c == nil {
			c = &toolCall{}
			p.calls[tc.Index] = c
		}
		if tc.ID != "" {
			c.ID = tc.ID
		}
		c.Name += tc.Function.Name
		c.Args += tc.Function.Arguments
	}
}

func (p *streamParser) finish() streamResult {
	if p.lastHadUsage {
		p.res.UsageInFinal = true
	}
	p.res.Total = time.Since(p.start)
	idx := make([]int, 0, len(p.calls))
	for i := range p.calls {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	for _, i := range idx {
		p.res.ToolCalls = append(p.res.ToolCalls, *p.calls[i])
	}
	return p.res
}
