// Agent directory, profiles and chat handlers (JSON or SSE, see sse.go).

package httpapi

import (
	"context"
	"net/http"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

func (a *api) listAgentDirectory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cards, err := a.Agents.Directory(r.Context(), a.actor(r), agents.DirectoryFilter{Search: q.Get("q"), Team: q.Get("team")})
	writeList(w, r, cards, err, toAPICard)
}

func (a *api) getAgentProfile(w http.ResponseWriter, r *http.Request) {
	c, err := a.Agents.Profile(r.Context(), a.actor(r), r.PathValue("team"), r.PathValue("agent"))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPICard(c))
}

func (a *api) getAgentProfileByID(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	c, err := a.Agents.Profile(r.Context(), a.actor(r), "", id.String())
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPICard(c))
}

func toAPICitations(c []agents.Citation) []apitypes.Citation {
	out := viaJSON[[]apitypes.Citation](c)
	if out == nil {
		out = []apitypes.Citation{}
	}
	return out
}

func toAPIAnswer(ans agents.Answer) apitypes.ChatAnswer {
	out := apitypes.ChatAnswer{
		ConversationId: ans.ConversationID, UserMessageId: ans.UserMessageID, MessageId: ans.MessageID, Persisted: ans.Persisted,
		AgentVersion: ans.AgentVersion, Text: ans.Text, Thinking: ans.Thinking, Citations: toAPICitations(ans.Citations),
		Sources: viaJSON[[]apitypes.RetrievalHit](ans.Sources), Usage: viaJSON[apitypes.ChatUsage](ans.Usage),
		StopReason: apitypes.StopReason(ans.StopReason), Refused: ans.Refused, NoContext: ans.NoContext,
		LatencyMs: ans.Latency.Milliseconds(),
	}
	if out.Sources == nil {
		out.Sources = []apitypes.RetrievalHit{}
	}
	if ans.ErrorCode != "" {
		out.ErrorCode, out.ErrorMessage = &ans.ErrorCode, &ans.ErrorMessage
	}
	if ans.Moderation != nil {
		m := viaJSON[apitypes.ChatEventModeration](*ans.Moderation)
		out.Moderation = &m
	}
	return out
}

func historyOf(h *[]apitypes.ChatHistoryMessage) []agents.HistoryMessage {
	if h == nil {
		return nil
	}
	out := make([]agents.HistoryMessage, len(*h))
	for i, m := range *h {
		out[i] = agents.HistoryMessage{Role: string(m.Role), Content: m.Content}
	}
	return out
}

func channelOf(actor authz.Actor) string {
	if actor.Key != nil {
		return agents.ChannelAPI
	}
	return agents.ChannelUI
}

// runChat streams an answer as SSE, or returns it as JSON.
func (a *api) runChat(w http.ResponseWriter, r *http.Request, stream bool, fn func(context.Context, func(agents.Event)) (agents.Answer, error)) {
	if !stream {
		ans, err := fn(r.Context(), nil)
		if failed(w, r, err) {
			return
		}
		if ans.ErrorCode == agents.ErrCodeModelUnavailable {
			httpx.Fail(w, r, &apperr.Error{Status: http.StatusServiceUnavailable, Code: ans.ErrorCode, Message: ans.ErrorMessage,
				Details: map[string]any{"conversationId": ans.ConversationID, "messageId": ans.MessageID}})
			return
		}
		httpx.JSON(w, http.StatusOK, toAPIAnswer(ans))
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	sse := newSSE(w, cancel)
	defer sse.close()
	_, err := fn(ctx, func(ev agents.Event) { sse.event(ev.Type, ev.Data) })
	if err != nil {
		if !sse.isStarted() {
			httpx.Fail(w, r, err)
			return
		}
		code, msg := "internal", "Something went wrong while answering."
		if e, ok := apperr.As(err); ok {
			code, msg = e.Code, e.Message
		}
		sse.event("error", agents.ErrorEvent{Code: code, Message: msg})
	}
	if sse.isStarted() {
		sse.event("done", struct{}{})
	}
}

func (a *api) chat(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ChatRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	actor := a.actor(r)
	req := agents.ChatRequest{
		TeamRef: r.PathValue("team"), AgentRef: r.PathValue("agent"), Message: in.Message,
		ConversationID: in.ConversationId, History: historyOf(in.History), Channel: channelOf(actor),
	}
	a.runChat(w, r, in.Stream == nil || *in.Stream, func(ctx context.Context, emit func(agents.Event)) (agents.Answer, error) {
		return a.Agents.Chat(ctx, actor, req, emit)
	})
}

func (a *api) testAgent(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	var in apitypes.TestChatRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	actor, team := a.actor(r), r.PathValue("team")
	a.runChat(w, r, in.Stream == nil || *in.Stream, func(ctx context.Context, emit func(agents.Event)) (agents.Answer, error) {
		return a.Agents.TestChat(ctx, actor, team, id, in.Message, historyOf(in.History), emit)
	})
}
