// Conversation history: loading, storing the question, trimming it to the
// context window and rewriting the question into a search query.

package agents

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// prepareConversation loads the history and, for stored conversations,
// creates the conversation if needed and appends the user message.
func (ru *run) prepareConversation(ctx context.Context) error {
	s := ru.s
	if !ru.persist {
		for _, m := range ru.stateless {
			if m.Role == "user" {
				ru.history = append(ru.history, llm.UserMessage{Content: m.Content})
			} else if strings.TrimSpace(m.Content) != "" {
				ru.history = append(ru.history, llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: m.Content}}, StopReason: llm.StopReasonStop})
			}
		}
		ru.trimHistory()
		return nil
	}
	if ru.conv != nil {
		rows, err := s.q.ListMessages(ctx, ru.conv.ID)
		if err != nil {
			return err
		}
		ru.history = historyFromRows(rows)
		ru.trimHistory()
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if ru.conv == nil {
			c, err := ru.newConversation(ctx, q)
			if err != nil {
				return err
			}
			ru.conv = &c
		} else {
			if _, err := q.LockConversation(ctx, ru.conv.ID); err != nil {
				return err
			}
			if err := q.TouchConversation(ctx, dbgen.TouchConversationParams{ID: ru.conv.ID, LastVersionID: ru.versionID()}); err != nil {
				return err
			}
		}
		seq, err := q.NextMessageSeq(ctx, ru.conv.ID)
		if err != nil {
			return err
		}
		content, _ := json.Marshal(map[string]string{"text": ru.question})
		m, err := q.InsertMessage(ctx, dbgen.InsertMessageParams{
			ID: uuid.New(), ConversationID: ru.conv.ID, Seq: seq, Role: "user", Content: content,
			AgentVersionID: ru.versionID(),
		})
		if err != nil {
			return err
		}
		ru.userMsgID = m.ID
		return nil
	})
}

// newConversation stores a new conversation: the user's, or an anonymous
// session's (which becomes the session's current conversation).
func (ru *run) newConversation(ctx context.Context, q *dbgen.Queries) (dbgen.Conversation, error) {
	if ru.anon == nil {
		return q.InsertConversation(ctx, dbgen.InsertConversationParams{
			AgentID: ru.agent.ID, UserID: ru.a.UserID, Title: titleFrom(ru.question), LastVersionID: ru.versionID(),
		})
	}
	sess := uuid.NullUUID{UUID: ru.anon.SessionID, Valid: true}
	c, err := q.InsertAnonConversation(ctx, dbgen.InsertAnonConversationParams{
		AgentID: ru.agent.ID, AnonSessionID: sess, Title: titleFrom(ru.question), LastVersionID: ru.versionID(),
	})
	if err != nil {
		return c, err
	}
	return c, q.SetAnonSessionConversation(ctx, dbgen.SetAnonSessionConversationParams{
		ID: ru.anon.SessionID, ConversationID: uuid.NullUUID{UUID: c.ID, Valid: true},
	})
}

// titleFrom is a conversation's initial title: the first line of the
// question, shortened.
func titleFrom(q string) string {
	line, _, _ := strings.Cut(q, "\n")
	return truncateRunes(strings.TrimSpace(line), 80)
}

// historyFromRows rebuilds the model history: user questions and the final
// text of completed answers. Sources, thinking and tool calls are not
// replayed, nor are turns moderation replaced with a notice (neither the
// question nor the notice).
func historyFromRows(rows []dbgen.ListMessagesRow) []llm.Message {
	var out []llm.Message
	for _, r := range rows {
		if r.Role == "assistant" && isModerationCode(r.ErrorCode) {
			if n := len(out); n > 0 && out[n-1].MessageRole() == llm.RoleUser {
				out = out[:n-1]
			}
			continue
		}
		switch r.Role {
		case "user":
			var c struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal(r.Content, &c)
			out = append(out, llm.UserMessage{Content: c.Text})
		case "assistant":
			if r.StopReason != string(llm.StopReasonStop) && r.StopReason != string(llm.StopReasonLength) {
				continue
			}
			text := textOf(r.Content)
			if strings.TrimSpace(text) != "" {
				out = append(out, llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: text}}, StopReason: llm.StopReasonStop})
			}
		}
	}
	return out
}

func textOf(content json.RawMessage) string {
	blocks, err := llm.UnmarshalBlocks(content)
	if err != nil {
		return ""
	}
	var b strings.Builder
	for _, bl := range blocks {
		if t, ok := bl.(llm.Text); ok {
			b.WriteString(t.Text)
		}
	}
	return b.String()
}

// trimHistory keeps the most recent turns that fit the model's context
// window next to the sources, the answer and the system prompt.
func (ru *run) trimHistory() {
	window := ru.model.ContextWindow
	if window <= 0 {
		window = defaultContextWindow
	}
	reserve := ru.cfg.ContextTokenBudget + 3000 + estimateTokens(ru.cfg.Instructions) + estimateTokens(ru.question)
	if ru.cfg.MaxOutputTokens != nil {
		reserve += *ru.cfg.MaxOutputTokens
	} else if ru.model.MaxOutputTokens > 0 {
		reserve += min(ru.model.MaxOutputTokens, window/4)
	} else {
		reserve += 4000
	}
	avail := window - reserve
	if len(ru.history) > maxHistory {
		ru.history = ru.history[len(ru.history)-maxHistory:]
	}
	cost := func(m llm.Message) int {
		switch v := m.(type) {
		case llm.UserMessage:
			return estimateTokens(v.Content) + 4
		case llm.AssistantMessage:
			return estimateTokens(v.Text()) + 4
		}
		return 0
	}
	total := 0
	for _, m := range ru.history {
		total += cost(m)
	}
	for len(ru.history) > 0 && total > avail {
		total -= cost(ru.history[0])
		ru.history = ru.history[1:]
	}
	// Never start with an assistant turn.
	for len(ru.history) > 0 && ru.history[0].MessageRole() != llm.RoleUser {
		ru.history = ru.history[1:]
	}
}

// rewrite turns the question into a search query that stands on its own
// (non-streaming, at most 200 tokens). On failure the question is used.
func (ru *run) rewrite(ctx context.Context) string {
	msgs := append([]llm.Message(nil), ru.history[max(0, len(ru.history)-6):]...)
	msgs = append(msgs, llm.UserMessage{Content: ru.question})
	rctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	msg, err := llm.Complete(rctx, ru.s.NewProvider(ru.target.Client), ru.model,
		llm.Context{SystemPrompt: rewritePrompt, Messages: msgs},
		llm.Options{MaxTokens: 200, User: ru.userTag()})
	addUsage(&ru.extraUsage, msg.Usage)
	q := strings.TrimSpace(strings.Trim(strings.TrimSpace(msg.Text()), `"`))
	if err != nil || q == "" || utf8.RuneCountInString(q) > 1000 {
		if err != nil && ctx.Err() == nil {
			ru.s.Log.Warn("query rewrite failed; using the question", "err", err, "agent", ru.agent.ID)
		}
		return ru.question
	}
	return q
}
