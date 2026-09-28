package demo

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// The built-in fake model gateway (`grounded demo --serve-fake-models`,
// docs/demo.md): a small OpenAI-compatible API so the demo runs without any
// model keys. It is not a language model. Embeddings are hashed bags of
// words (texts sharing words are close, so retrieval works), and chat
// answers are canned: they quote the best-matching passages with their
// citations, under a label that says so.
const (
	// FakeChatModel and FakeEmbedModel are the upstream model IDs it serves.
	FakeChatModel  = "grounded-demo-chat"
	FakeEmbedModel = "grounded-demo-embed"
	// FakeEmbedDims is the fake embedding model's dimensions.
	FakeEmbedDims = 768
	// FakeAPIKey is the key the fake gateway expects. It protects nothing:
	// the gateway serves no data.
	FakeAPIKey = "sk-grounded-demo-fake"
	// FakeLabel starts every canned answer that quotes sources.
	FakeLabel = "*Demo model: this is a canned answer, not a real language model. It quotes the passages that best match your question.*"
	// fakeNothing answers when no source was retrieved and the agent has no refusal message.
	fakeNothing = "*Demo model:* I found nothing about that in the documentation."
)

// quotedSources is how many retrieved passages a canned answer quotes.
const quotedSources = 3

// quoteWords bounds each quoted passage.
const quoteWords = 45

// NewFakeModels returns the fake gateway's handler, serving /v1/models,
// /v1/embeddings and /v1/chat/completions (JSON or SSE) to clients sending
// apiKey as a bearer token.
func NewFakeModels(apiKey string) http.Handler { return NewPacedFakeModels(apiKey, 0) }

// NewPacedFakeModels is NewFakeModels with wordDelay between the words of
// every chat reply (streamed or not), so a load test can hold answers open
// the way a real model's generation does (deploy/loadtest). 0 answers at once.
func NewPacedFakeModels(apiKey string, wordDelay time.Duration) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{"object": "list", "data": []map[string]string{
			{"id": FakeChatModel, "object": "model"}, {"id": FakeEmbedModel, "object": "model"},
		}})
	})
	mux.HandleFunc("POST /v1/embeddings", fakeEmbeddings)
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		fakeCompletions(w, r, wordDelay)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+apiKey {
			fakeError(w, http.StatusUnauthorized, "invalid api key")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func fakeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": msg}})
}

func fakeEmbeddings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Model string `json:"model"`
		Input any    `json:"input"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&in); err != nil {
		fakeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if in.Model != FakeEmbedModel {
		fakeError(w, http.StatusNotFound, "model not found")
		return
	}
	var inputs []string
	switch v := in.Input.(type) {
	case string:
		inputs = []string{v}
	case []any:
		for _, s := range v {
			str, _ := s.(string)
			inputs = append(inputs, str)
		}
	}
	data := make([]map[string]any, len(inputs))
	tokens := 0
	for i, text := range inputs {
		data[i] = map[string]any{"object": "embedding", "index": i, "embedding": fakeEmbedding(text, FakeEmbedDims)}
		tokens += len(strings.Fields(text)) + 1
	}
	writeJSON(w, map[string]any{"object": "list", "data": data, "model": in.Model,
		"usage": map[string]int{"prompt_tokens": tokens, "total_tokens": tokens}})
}

// fakeEmbedding is a hashed bag of words at unit length: texts sharing words
// are close, equal texts are identical. A small hash of the whole text
// avoids zero vectors.
func fakeEmbedding(text string, dims int) []float32 {
	v := make([]float64, dims)
	for _, w := range strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if len(w) < 3 {
			continue // short function words carry little meaning
		}
		sum := sha256.Sum256([]byte(w))
		v[binary.BigEndian.Uint32(sum[:4])%uint32(dims)]++
	}
	whole := sha256.Sum256([]byte(text))
	var norm float64
	for i := range v {
		v[i] += float64(whole[i%len(whole)]) / 255 * 0.01
		norm += v[i] * v[i]
	}
	norm = math.Sqrt(norm)
	out := make([]float32, dims)
	for i := range v {
		out[i] = float32(v[i] / norm)
	}
	return out
}

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
}

// messageText reads a message content: a string or text parts.
func messageText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(raw, &parts)
	var b strings.Builder
	for _, p := range parts {
		b.WriteString(p.Text)
	}
	return b.String()
}

func fakeCompletions(w http.ResponseWriter, r *http.Request, wordDelay time.Duration) {
	var in fakeChatRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&in); err != nil {
		fakeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if in.Model != FakeChatModel {
		fakeError(w, http.StatusNotFound, "model not found")
		return
	}
	text, promptWords := fakeReply(&in)
	completion := len(strings.Fields(text))
	usage := map[string]int{"prompt_tokens": promptWords + 1, "completion_tokens": completion, "total_tokens": promptWords + 1 + completion}
	if !in.Stream {
		if !pause(r, time.Duration(completion)*wordDelay) {
			return
		}
		writeJSON(w, map[string]any{
			"id": "chatcmpl-demo", "object": "chat.completion", "created": 1790000000, "model": in.Model,
			"choices": []map[string]any{{"index": 0, "finish_reason": "stop",
				"message": map[string]any{"role": "assistant", "content": text}}},
			"usage": usage,
		})
		return
	}
	streamReply(w, r, in, text, usage, wordDelay)
}

// pause waits d, or less when the client goes away (false then).
func pause(r *http.Request, d time.Duration) bool {
	if d <= 0 {
		return r.Context().Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-r.Context().Done():
		return false
	}
}

// fakeReply chooses the canned reply, looking at the system prompt and at
// the last user message and what follows it (where retrieved sources are).
func fakeReply(in *fakeChatRequest) (string, int) {
	var system, current []string
	question, words := "", 0
	for _, m := range in.Messages {
		text := messageText(m.Content)
		words += len(strings.Fields(text))
		switch m.Role {
		case "system", "developer":
			system = append(system, text)
		case "user":
			question, current = text, nil
		}
		if m.Role != "system" && m.Role != "developer" {
			current = append(current, text)
		}
	}
	sys := strings.Join(system, "\n")
	switch {
	case strings.Contains(strings.ToLower(sys), "standalone"):
		return question, words // query rewrite: the question as it is
	case strings.Contains(strings.ToLower(sys), "latest message is small talk"):
		return "*Demo model:* Hello! Ask me a question about the documentation.", words
	}
	if quotes := quoteSources(strings.Join(current, "\n")); quotes != "" {
		return FakeLabel + "\n\n" + quotes, words
	}
	if strings.Contains(strings.ToLower(question), "pong") {
		return "pong", words // the admin model test: "Reply with the single word: pong"
	}
	if refusal := refusalMessage(sys); refusal != "" {
		return refusal, words
	}
	return fakeNothing, words
}

var sourceRE = regexp.MustCompile(`(?s)<source id="(\d+)"([^>]*)>(.*?)</source>`)
var titleRE = regexp.MustCompile(`title="([^"]*)"`)

// quoteSources quotes the first passages of a <sources> block, each as
// "**Title**: words… [n]".
func quoteSources(text string) string {
	var out []string
	for _, m := range sourceRE.FindAllStringSubmatch(text, quotedSources) {
		title := "Source " + m[1]
		if t := titleRE.FindStringSubmatch(m[2]); t != nil && strings.TrimSpace(t[1]) != "" {
			title = html.UnescapeString(t[1])
		}
		quote := passage(m[3])
		if quote == "" {
			continue
		}
		out = append(out, fmt.Sprintf("- **%s**: %s [%s]", title, quote, m[1]))
	}
	if len(out) == 0 {
		return ""
	}
	return "The closest passages I found:\n\n" + strings.Join(out, "\n")
}

// passage is the start of a source body as plain text: headings (the title
// already names the page) and links' URLs are dropped and whitespace is
// collapsed. A body of headings only is quoted as it is.
func passage(body string) string {
	var words, headings []string
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		fields := strings.Fields(markdownLinks.ReplaceAllString(strings.TrimLeft(line, "#>*- "), "$1"))
		if strings.HasPrefix(line, "#") {
			headings = append(headings, fields...)
		} else {
			words = append(words, fields...)
		}
	}
	if len(words) == 0 {
		words = headings
	}
	if len(words) > quoteWords {
		return strings.Join(words[:quoteWords], " ") + " …"
	}
	return strings.Join(words, " ")
}

var markdownLinks = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)

// refusalMessage finds the preamble's line `Refusal message: "<text>"`.
func refusalMessage(system string) string {
	for _, line := range strings.Split(system, "\n") {
		_, rest, ok := strings.Cut(line, "Refusal message:")
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

// streamReply sends the reply as chat.completion.chunk events, word by
// word (wordDelay apart), then [DONE].
func streamReply(w http.ResponseWriter, r *http.Request, in fakeChatRequest, text string, usage map[string]int, wordDelay time.Duration) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, _ := w.(http.Flusher)
	send := func(v any) bool {
		b, _ := json.Marshal(v)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
			return false
		}
		if flusher != nil {
			flusher.Flush()
		}
		return r.Context().Err() == nil
	}
	chunk := func(delta map[string]any, finish any) map[string]any {
		return map[string]any{"id": "chatcmpl-demo", "object": "chat.completion.chunk", "created": 1790000000, "model": in.Model,
			"choices": []map[string]any{{"index": 0, "delta": delta, "finish_reason": finish}}}
	}
	chunks := []map[string]any{chunk(map[string]any{"role": "assistant", "content": ""}, nil)}
	for _, word := range strings.SplitAfter(text, " ") {
		if word != "" {
			chunks = append(chunks, chunk(map[string]any{"content": word}, nil))
		}
	}
	words := len(chunks) - 1
	chunks = append(chunks, chunk(map[string]any{}, "stop"))
	if in.StreamOptions != nil && in.StreamOptions.IncludeUsage {
		chunks = append(chunks, map[string]any{"id": "chatcmpl-demo", "object": "chat.completion.chunk", "created": 1790000000,
			"model": in.Model, "choices": []any{}, "usage": usage})
	}
	for i, c := range chunks {
		// The role chunk goes out at once; each word waits wordDelay.
		if i > 0 && i <= words && !pause(r, wordDelay) {
			return
		}
		if !send(c) {
			return
		}
	}
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}
