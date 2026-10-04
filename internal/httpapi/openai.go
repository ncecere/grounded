package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/llm"
)

// The OpenAI-compatible API (docs/phase3-agents.md §7): agents are models
// named agent:{team}/{slug}. It is stateless and uses the OpenAI error
// shape, so OpenAI SDKs work unchanged.

const openaiModelPrefix = "agent:"

// maxOpenAIBody bounds a chat completions request (history included).
const maxOpenAIBody = 4 << 20

// openaiError writes {"error": {"message", "type", "code", "param"}}.
func openaiError(w http.ResponseWriter, status int, code, message string) {
	typ := "invalid_request_error"
	switch {
	case status == http.StatusUnauthorized:
		typ = "authentication_error"
	case status == http.StatusForbidden:
		typ = "permission_error"
	case status == http.StatusNotFound:
		typ = "not_found_error"
	case status == http.StatusTooManyRequests:
		typ = "rate_limit_error"
	case status >= 500:
		typ = "api_error"
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": message, "type": typ, "code": code, "param": nil}})
}

// openaiFail renders a service error in the OpenAI shape.
func openaiFail(w http.ResponseWriter, r *http.Request, err error) {
	if e, ok := apperr.As(err); ok {
		if e.RetryAfter > 0 {
			w.Header().Set("Retry-After", itoaSeconds(e.RetryAfter))
		}
		openaiError(w, e.Status, e.Code, e.Message)
		return
	}
	httpx.Internal(w, r, err)
}

func itoaSeconds(d time.Duration) string {
	secs := int((d + time.Second - 1) / time.Second)
	b, _ := json.Marshal(max(secs, 1))
	return string(b)
}

// openaiAuth accepts API keys (with OpenAI-shaped errors) and browser
// sessions.
func (a *api) openaiAuth(h http.HandlerFunc) http.Handler {
	return a.keyOr(a.Auth.RequireSession(h), h, openaiError)
}

func (a *api) openaiListModels(w http.ResponseWriter, r *http.Request) {
	cards, err := a.Agents.Directory(r.Context(), a.actor(r), agents.DirectoryFilter{})
	if err != nil {
		openaiFail(w, r, err)
		return
	}
	data := make([]map[string]any, len(cards))
	for i, c := range cards {
		data[i] = map[string]any{"id": openaiModelPrefix + c.TeamSlug + "/" + c.Agent.Slug, "object": "model",
			"created": c.Agent.CreatedAt.Unix(), "owned_by": c.TeamSlug}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": data})
}

type openaiMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type openaiRequest struct {
	Model         string          `json:"model"`
	Messages      []openaiMessage `json:"messages"`
	Stream        bool            `json:"stream"`
	StreamOptions *struct {
		IncludeUsage bool `json:"include_usage"`
	} `json:"stream_options"`
	N     *int              `json:"n"`
	Tools []json.RawMessage `json:"tools"`
	// Functions is the legacy form of tools.
	Functions []json.RawMessage `json:"functions"`
}

// openaiText extracts text from a string or an array of content parts.
func openaiText(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", true
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s, true
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) != nil {
		return "", false
	}
	var b strings.Builder
	for _, p := range parts {
		if p.Type == "text" || p.Type == "" {
			b.WriteString(p.Text)
		}
	}
	return b.String(), true
}

func openaiUsage(u llm.Usage) map[string]any {
	return map[string]any{
		"prompt_tokens": u.Input, "completion_tokens": u.Output, "total_tokens": u.Input + u.Output,
		"completion_tokens_details": map[string]any{"reasoning_tokens": u.Reasoning},
	}
}

func finishReason(stop string) string {
	if stop == string(llm.StopReasonLength) {
		return "length"
	}
	return "stop"
}

func (a *api) openaiChatCompletions(w http.ResponseWriter, r *http.Request) {
	in, ok := readOpenAIRequest(w, r)
	if !ok {
		return
	}
	name, ok := strings.CutPrefix(in.Model, openaiModelPrefix)
	team, slug, ok2 := strings.Cut(name, "/")
	if !ok || !ok2 || team == "" || slug == "" || strings.Contains(slug, "/") {
		openaiError(w, http.StatusNotFound, "model_not_found", "The model must be an agent, named agent:{team}/{agent}. GET /v1/models lists them.")
		return
	}
	turns, problem := openaiTurns(in.Messages)
	if problem != "" {
		openaiError(w, http.StatusBadRequest, "invalid_messages", problem)
		return
	}
	req := agents.ChatRequest{
		TeamRef: team, AgentRef: slug, Message: turns[len(turns)-1].Content, History: turns[:len(turns)-1],
		Channel: agents.ChannelOpenAI, Stateless: true,
	}
	if in.Stream {
		a.openaiStream(w, r, req, in)
	} else {
		a.openaiComplete(w, r, req, in.Model)
	}
}

// readOpenAIRequest reads a chat completions request and rejects what agents
// don't support (client tools, n > 1).
func readOpenAIRequest(w http.ResponseWriter, r *http.Request) (openaiRequest, bool) {
	var in openaiRequest
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxOpenAIBody))
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			openaiError(w, http.StatusRequestEntityTooLarge, "body_too_large", "Request body is too large")
			return in, false
		}
		openaiError(w, http.StatusBadRequest, "invalid_json", "Could not read the request body")
		return in, false
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		openaiError(w, http.StatusBadRequest, "invalid_json", "Request body is not valid JSON")
		return in, false
	}
	if len(in.Tools) > 0 || len(in.Functions) > 0 {
		openaiError(w, http.StatusBadRequest, "tools_not_supported", "Agents do not accept client tools")
		return in, false
	}
	if in.N != nil && *in.N != 1 {
		openaiError(w, http.StatusBadRequest, "n_not_supported", "Only n = 1 is supported")
		return in, false
	}
	return in, true
}

// openaiTurns converts the messages to chat turns. System messages are
// dropped (the agent's instructions win); the last user message is the
// question and the rest is history. problem explains invalid messages.
func openaiTurns(msgs []openaiMessage) (turns []agents.HistoryMessage, problem string) {
	for _, m := range msgs {
		text, ok := openaiText(m.Content)
		if !ok {
			return nil, "Message content must be a string or text parts"
		}
		switch m.Role {
		case "user", "assistant":
			turns = append(turns, agents.HistoryMessage{Role: m.Role, Content: text})
		case "system", "developer", "tool", "function":
		default:
			return nil, "Unknown message role " + m.Role
		}
	}
	if len(turns) == 0 || turns[len(turns)-1].Role != "user" {
		return nil, "The last message must be from the user"
	}
	return turns, ""
}

// openaiComplete answers with one chat.completion object.
func (a *api) openaiComplete(w http.ResponseWriter, r *http.Request, req agents.ChatRequest, model string) {
	created := time.Now().Unix()
	ans, err := a.Agents.Chat(r.Context(), a.actor(r), req, nil)
	if err != nil {
		openaiFail(w, r, err)
		return
	}
	if ans.ErrorCode == agents.ErrCodeModelUnavailable {
		openaiError(w, http.StatusServiceUnavailable, ans.ErrorCode, ans.ErrorMessage)
		return
	}
	// A fail-closed safety check that could not run is an error worth
	// retrying, not an answer (docs/ui-review F-01).
	if m := ans.Moderation; m != nil && m.Action == agents.ModerationUnavailable {
		openaiError(w, http.StatusServiceUnavailable, errModerationUnavailable, m.Notice)
		return
	}
	msg := map[string]any{"role": "assistant", "content": ans.Text}
	if ans.Thinking != "" {
		msg["reasoning_content"] = ans.Thinking
	}
	out := map[string]any{
		"id": "chatcmpl-" + ans.MessageID.String(), "object": "chat.completion", "created": created, "model": model,
		"choices": []map[string]any{{"index": 0, "message": msg, "finish_reason": finishReason(ans.StopReason)}},
		"usage":   openaiUsage(ans.Usage), "citations": toAPICitations(ans.Citations),
	}
	// claims: an extension next to citations, when citations were checked (docs/systemone.md §3).
	if len(ans.Claims) > 0 {
		out["claims"] = viaJSON[[]apitypes.Claim](ans.Claims)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(out)
}

// openaiStream answers with chat.completion.chunk server-sent events,
// ending with [DONE].
func (a *api) openaiStream(w http.ResponseWriter, r *http.Request, req agents.ChatRequest, in openaiRequest) {
	created := time.Now().Unix()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	sse := newSSE(w, cancel)
	defer sse.close()
	st := &openaiChunks{sse: sse, model: in.Model, created: created,
		includeUsage: in.StreamOptions != nil && in.StreamOptions.IncludeUsage}
	_, err := a.Agents.Chat(ctx, a.actor(r), req, st.emit)
	if err != nil && !sse.isStarted() {
		openaiFail(w, r, err)
		return
	}
	if err != nil && !st.ended {
		code, msg := "internal", "Something went wrong while answering."
		if e, ok := apperr.As(err); ok {
			code, msg = e.Code, e.Message
		}
		sse.data(map[string]any{"error": map[string]any{"message": msg, "type": "api_error", "code": code, "param": nil}})
	}
	st.flush()
	if sse.isStarted() {
		sse.data("[DONE]")
	}
}

// errModerationUnavailable is the OpenAI error code when a fail-closed
// moderation check could not run.
const errModerationUnavailable = "moderation_unavailable"

// openaiChunks turns agent events into chat.completion.chunk events.
type openaiChunks struct {
	sse          *sseWriter
	id, model    string
	created      int64
	includeUsage bool
	ended        bool
	moderated    bool
	// end is held until the answer is complete: a citations_checked event
	// may follow message_end and annotate its citations (the streamed text
	// cannot change, so SystemOne citation checks only annotate here).
	end *agents.MessageEndEvent
	// hold: the model has tools, and text it streams may be taken back
	// (text_reset, v0.4.2 BU2-01), which this stream can't do: the text is
	// held until the answer ends. sent: some content was sent.
	hold bool
	held strings.Builder
	sent bool
}

// content sends answer text (or holds it).
func (c *openaiChunks) content(text string) {
	if c.hold {
		c.held.WriteString(text)
		return
	}
	c.sent = c.sent || text != ""
	c.sse.data(c.chunk(map[string]any{"content": text}, nil))
}

// release sends the held text.
func (c *openaiChunks) release() {
	if c.held.Len() == 0 {
		return
	}
	text := c.held.String()
	c.held.Reset()
	c.sent = true
	c.sse.data(c.chunk(map[string]any{"content": text}, nil))
}

func (c *openaiChunks) chunk(delta map[string]any, finish any) map[string]any {
	return map[string]any{"id": c.id, "object": "chat.completion.chunk", "created": c.created, "model": c.model,
		"choices": []map[string]any{{"index": 0, "delta": delta, "finish_reason": finish}}}
}

func (c *openaiChunks) emit(ev agents.Event) {
	switch d := ev.Data.(type) {
	case agents.MessageStartEvent:
		c.id = "chatcmpl-" + d.MessageID.String()
		c.hold = d.ToolTurns
		c.sse.data(c.chunk(map[string]any{"role": "assistant", "content": ""}, nil))
	case agents.DeltaEvent:
		if ev.Type == "thinking_delta" {
			c.sse.data(c.chunk(map[string]any{"reasoning_content": d.Delta}, nil))
		} else {
			c.content(d.Delta)
		}
	case agents.TextResetEvent:
		c.held.Reset() // a tool turn's text: never sent
	case agents.ErrorEvent:
		c.release()
		c.sse.data(map[string]any{"error": map[string]any{"message": d.Message, "type": "api_error", "code": d.Code, "param": nil}})
	case agents.ModerationEvent:
		if d.Action == agents.ModerationUnavailable {
			// The safety check could not run: an error the client may retry.
			c.moderated = true
			c.sse.data(map[string]any{"error": map[string]any{"message": d.Notice, "type": "api_error", "code": errModerationUnavailable, "param": nil}})
			return
		}
		// Streamed text cannot be taken back here: send the notice and end
		// with finish_reason content_filter.
		c.moderated = true
		c.held.Reset() // held text is withheld, not retracted
		sep := ""
		if d.Action == agents.ModerationRetracted && c.sent {
			sep = "\n\n"
		}
		c.sse.data(c.chunk(map[string]any{"content": sep + d.Notice}, nil))
	case agents.MessageEndEvent:
		if c.hold && !c.moderated { // the final text, as stored
			c.held.Reset()
			c.held.WriteString(d.Text)
			c.release()
		}
		c.ended, c.end = true, &d
	case agents.CitationsCheckedEvent:
		if c.end != nil {
			c.end.Citations, c.end.Claims = d.Citations, d.Claims
		}
	}
}

// flush sends the final chunk (finish reason and citations) and the usage
// chunk once the answer is complete.
func (c *openaiChunks) flush() {
	d := c.end
	if d == nil {
		return
	}
	c.end = nil
	finish := finishReason(d.StopReason)
	if c.moderated {
		finish = "content_filter"
	}
	last := c.chunk(map[string]any{}, finish)
	last["citations"] = toAPICitations(d.Citations)
	if len(d.Claims) > 0 {
		last["claims"] = viaJSON[[]apitypes.Claim](d.Claims)
	}
	c.sse.data(last)
	if c.includeUsage {
		c.sse.data(map[string]any{"id": c.id, "object": "chat.completion.chunk", "created": c.created, "model": c.model,
			"choices": []any{}, "usage": openaiUsage(d.Usage)})
	}
}
