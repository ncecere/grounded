// Chat completions of the fake gateway: the deterministic reply rules
// (documented on FakeProxy) and the JSON or SSE responses.

package testutil

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type fakeChatRequest struct {
	Model    string `json:"model"`
	Messages []struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"messages"`
	Stream        bool `json:"stream"`
	StreamOptions *struct {
		IncludeUsage bool `json:"include_usage"`
	} `json:"stream_options"`
	Tools []struct {
		Function struct {
			Name string `json:"name"`
		} `json:"function"`
	} `json:"tools"`
	ToolChoice json.RawMessage `json:"tool_choice"`
	// Moderation requests (fakemoderation.go).
	Logprobs           bool           `json:"logprobs"`
	ChatTemplateKwargs map[string]any `json:"chat_template_kwargs"`
}

// fakeText extracts text from a message content (a string or text parts).
func fakeText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(raw, &parts)
	var b strings.Builder
	for _, pt := range parts {
		b.WriteString(pt.Text)
	}
	return b.String()
}

// fakeReply is the deterministic answer; see FakeProxy.
type fakeReply struct {
	toolName, toolArgs string // set for a tool call
	text               string
	promptTokens       int
}

// decideFakeReply applies the rules; answer is SetAnswer's text.
func decideFakeReply(in *fakeChatRequest, answer string) fakeReply {
	var system []string
	lastUser, words := -1, 0
	for i, m := range in.Messages {
		text := fakeText(m.Content)
		words += len(strings.Fields(text))
		switch m.Role {
		case "system", "developer":
			system = append(system, text)
		case "user":
			lastUser = i
		}
	}
	out := fakeReply{promptTokens: words + 1}
	sys := strings.Join(system, "\n")
	question, hasToolResult := "", false
	var current []string // contents of the last user message and what follows
	if lastUser >= 0 {
		question = fakeText(in.Messages[lastUser].Content)
		for _, m := range in.Messages[lastUser:] {
			current = append(current, fakeText(m.Content))
			hasToolResult = hasToolResult || m.Role == "tool"
		}
	}
	var choice string
	_ = json.Unmarshal(in.ToolChoice, &choice)

	switch {
	case len(in.Tools) == 0 && strings.Contains(strings.ToLower(sys), "standalone"):
		out.text = question
	case len(in.Tools) > 0 && choice != "none" && !hasToolResult:
		out.toolName = in.Tools[0].Function.Name
		for _, t := range in.Tools {
			if t.Function.Name == "search_knowledge" {
				out.toolName = t.Function.Name
			}
		}
		args, _ := json.Marshal(map[string]string{"query": question})
		out.toolArgs = string(args)
	default:
		out.text = fakeAnswer(sys, question, current, answer)
	}
	return out
}

// fakeAnswer is a text answer (rules 3-7).
func fakeAnswer(sys, question string, current []string, answer string) string {
	line := fakeSourceLine(current)
	switch {
	case strings.Contains(strings.ToLower(sys), "latest message is small talk"):
		return FakeSmallTalk
	case answer != "" && line != "":
		return answer
	case strings.Contains(line, "FAKE-LIST"):
		return fakeSourceList(current)
	case line != "":
		return line + " [1]"
	}
	if refusal := fakeRefusalMessage(sys); refusal != "" {
		return refusal
	}
	if q := strings.ToLower(question); strings.Contains(q, "ping") || strings.Contains(q, "pong") {
		return "pong"
	}
	return FakeRefusal
}

// fakeSourceLine returns the first non-empty line of the `<source id="1"`
// block in the most recent content that has one.
func fakeSourceLine(contents []string) string { return fakeSourceLineN(contents, 1) }

// fakeSourceLineN is fakeSourceLine for source n.
func fakeSourceLineN(contents []string, n int) string {
	for i := len(contents) - 1; i >= 0; i-- {
		c := contents[i]
		start := strings.Index(c, fmt.Sprintf(`<source id="%d"`, n))
		if start < 0 {
			continue
		}
		body := c[start:]
		gt := strings.Index(body, ">")
		if gt < 0 {
			continue
		}
		body = body[gt+1:]
		if end := strings.Index(body, "</source>"); end >= 0 {
			body = body[:end]
		}
		for _, line := range strings.Split(body, "\n") {
			if line = strings.TrimSpace(line); line != "" {
				return line
			}
		}
	}
	return ""
}

// FakeSmallTalk is the reply to a small-talk prompt (the scope check's
// small-talk route).
const FakeSmallTalk = "Hello! Ask me anything about this subject."

// fakeSourceList answers with a Markdown list when the first line of
// source 1 contains FAKE-LIST: one item per source, "- <first line> [n]",
// so an answer has several claims citing different sources.
func fakeSourceList(contents []string) string {
	if !strings.Contains(fakeSourceLine(contents), "FAKE-LIST") {
		return ""
	}
	var items []string
	for n := 1; n <= 20; n++ {
		line := fakeSourceLineN(contents, n)
		if line == "" {
			break
		}
		items = append(items, fmt.Sprintf("- %s [%d]", line, n))
	}
	return "The sources say:\n\n" + strings.Join(items, "\n")
}

// fakeRefusalMessage finds a line `Refusal message: "<text>"`.
func fakeRefusalMessage(system string) string {
	const prefix = "Refusal message:"
	for _, line := range strings.Split(system, "\n") {
		_, rest, ok := strings.Cut(line, prefix)
		if !ok {
			continue
		}
		first, last := strings.Index(rest, `"`), strings.LastIndex(rest, `"`)
		if first >= 0 && last > first {
			return rest[first+1 : last]
		}
	}
	return ""
}

// splitN cuts s into at most n pieces of similar size on rune boundaries.
func splitN(s string, n int) []string {
	r := []rune(s)
	if len(r) == 0 {
		return nil
	}
	size := (len(r) + n - 1) / n
	var out []string
	for i := 0; i < len(r); i += size {
		out = append(out, string(r[i:min(i+size, len(r))]))
	}
	return out
}

func (p *FakeProxy) completions(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 32<<20))
	var in fakeChatRequest
	if err == nil {
		err = json.Unmarshal(raw, &in)
	}
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	p.log(r, in.Model)
	if p.moderationChat(w, r, &in) {
		return
	}
	if p.visionChat(w, &in, raw) {
		return
	}
	p.mu.Lock()
	if st := p.chatFail; st != 0 {
		p.mu.Unlock()
		if st == http.StatusTooManyRequests || st == http.StatusServiceUnavailable {
			w.Header().Set("Retry-After", "1")
		}
		writeErr(w, st, "chat failure (test)")
		return
	}
	ok := p.chat[in.Model]
	p.chatBodies = append(p.chatBodies, raw)
	delay, answer := p.chunkDelay, p.answer
	p.mu.Unlock()
	if !ok {
		writeErr(w, 404, "model not found")
		return
	}

	reply := decideFakeReply(&in, answer)
	completion := len(strings.Fields(reply.text)) + len(strings.Fields(reply.toolArgs)) + len(FakeReasoning)
	usage := map[string]any{
		"prompt_tokens": reply.promptTokens, "completion_tokens": completion,
		"total_tokens":              reply.promptTokens + completion,
		"completion_tokens_details": map[string]int{"reasoning_tokens": len(FakeReasoning)},
	}
	if !in.Stream {
		writeFakeCompletion(w, &in, reply, usage)
		return
	}
	streamFakeChunks(w, r, fakeChunks(&in, reply, usage), delay)
}

const fakeCompletionID, fakeCallID = "chatcmpl-fake", "call_fake_1"

func (r fakeReply) finishReason() string {
	if r.toolName != "" {
		return "tool_calls"
	}
	return "stop"
}

// writeFakeCompletion answers with one chat.completion.
func writeFakeCompletion(w http.ResponseWriter, in *fakeChatRequest, reply fakeReply, usage map[string]any) {
	msg := map[string]any{"role": "assistant", "content": nil, "reasoning_content": strings.Join(FakeReasoning, "")}
	if reply.toolName != "" {
		msg["tool_calls"] = []map[string]any{{"id": fakeCallID, "type": "function",
			"function": map[string]string{"name": reply.toolName, "arguments": reply.toolArgs}}}
	} else {
		msg["content"] = reply.text
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id": fakeCompletionID, "object": "chat.completion", "created": 1790000000, "model": in.Model,
		"choices": []map[string]any{{"index": 0, "message": msg, "finish_reason": reply.finishReason()}},
		"usage":   usage,
	})
}

// fakeChunks is the streamed reply: role, reasoning, the tool call (in
// fragments) or the text (word by word), the finish chunk and optionally
// usage.
func fakeChunks(in *fakeChatRequest, reply fakeReply, usage map[string]any) []map[string]any {
	chunk := func(delta map[string]any, finish any) map[string]any {
		return map[string]any{
			"id": fakeCompletionID, "object": "chat.completion.chunk", "created": 1790000000, "model": in.Model,
			"choices": []map[string]any{{"index": 0, "delta": delta, "finish_reason": finish}},
		}
	}
	chunks := []map[string]any{chunk(map[string]any{"role": "assistant", "content": ""}, nil)}
	for _, t := range FakeReasoning {
		chunks = append(chunks, chunk(map[string]any{"reasoning_content": t}, nil))
	}
	if reply.toolName != "" {
		chunks = append(chunks, chunk(map[string]any{"tool_calls": []map[string]any{{"index": 0, "id": fakeCallID, "type": "function",
			"function": map[string]string{"name": reply.toolName, "arguments": ""}}}}, nil))
		for _, frag := range splitN(reply.toolArgs, 4) {
			chunks = append(chunks, chunk(map[string]any{"tool_calls": []map[string]any{{"index": 0,
				"function": map[string]string{"arguments": frag}}}}, nil))
		}
	} else {
		for _, word := range strings.SplitAfter(reply.text, " ") {
			if word != "" {
				chunks = append(chunks, chunk(map[string]any{"content": word}, nil))
			}
		}
	}
	chunks = append(chunks, chunk(map[string]any{}, reply.finishReason()))
	if in.StreamOptions != nil && in.StreamOptions.IncludeUsage {
		chunks = append(chunks, map[string]any{
			"id": fakeCompletionID, "object": "chat.completion.chunk", "created": 1790000000, "model": in.Model,
			"choices": []any{}, "usage": usage,
		})
	}
	return chunks
}

// streamFakeChunks sends the chunks as SSE, pausing delay before each, then
// [DONE]. It stops when the client goes away.
func streamFakeChunks(w http.ResponseWriter, r *http.Request, chunks []map[string]any, delay time.Duration) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, _ := w.(http.Flusher)
	send := func(v any) bool {
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-r.Context().Done():
				return false
			}
		}
		b, _ := json.Marshal(v)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
			return false
		}
		if flusher != nil {
			flusher.Flush()
		}
		return r.Context().Err() == nil
	}
	for _, c := range chunks {
		if !send(c) {
			return
		}
	}
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}
