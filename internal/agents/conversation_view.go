package agents

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ToolCallView is a tool call made while answering, with its result.
type ToolCallView struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Title     string          `json:"title,omitempty"`
	Arguments json.RawMessage `json:"arguments"`
	IsError   bool            `json:"isError"`
	HitCount  int             `json:"hitCount"`
	Query     string          `json:"query,omitempty"`
	// Error says why the call failed or wasn't made; Result is what an MCP
	// tool returned (its source's snippet) or a note (stepOutcome).
	Error  string `json:"error,omitempty"`
	Result string `json:"result,omitempty"`
	// ThinkingBefore is the length, in UTF-16 code units, of the message's
	// joined thinking that came before this call, so the browser can show
	// reasoning and tool steps in the order they happened.
	ThinkingBefore int `json:"thinkingBefore"`
}

// RetrievalView is the search an answer ran before the model (always
// mode), stored in messages.retrieval.
type RetrievalView struct {
	Query    string            `json:"query"`
	HitCount int               `json:"hitCount"`
	Judging  *RetrievalJudging `json:"judging,omitempty"`
}

// MessageView is one transcript message: a user question or an answer.
type MessageView struct {
	ID             uuid.UUID      `json:"id"`
	Seq            int32          `json:"seq"`
	Role           string         `json:"role"`
	Text           string         `json:"text"`
	Thinking       string         `json:"thinking,omitempty"`
	ToolCalls      []ToolCallView `json:"toolCalls,omitempty"`
	Retrieval      *RetrievalView `json:"retrieval,omitempty"`
	Citations      []Citation     `json:"citations,omitempty"`
	StopReason     string         `json:"stopReason,omitempty"`
	ErrorCode      string         `json:"errorCode,omitempty"`
	Usage          *llm.Usage     `json:"usage,omitempty"`
	LatencyMs      *int32         `json:"latencyMs,omitempty"`
	Feedback       *string        `json:"feedback,omitempty"`
	FeedbackReason *string        `json:"feedbackReason,omitempty"`
	// FeedbackShared: the asker shared the question with the team (gaps.go).
	FeedbackShared bool `json:"feedbackShared,omitempty"`
	// Refused: the answer is the agent's refusal (message_events.refused), so a reloaded chat offers the starters again.
	Refused bool `json:"refused,omitempty"`
	// Uncited: the answer's citations were checked (verdicts.go).
	Uncited []UncitedSentence `json:"uncited,omitempty"`
	// Claims: the answer's citations were checked by v0.2.1 or later
	// (claimverdicts.go); answers checked before have per-marker verdicts only.
	Claims []Claim `json:"claims,omitempty"`
	// RoutedTo: a router sent the question to this agent (router.go).
	RoutedTo  *RoutedView `json:"routedTo,omitempty"`
	CreatedAt time.Time   `json:"createdAt"`
}

// ConversationView is a conversation with its transcript.
type ConversationView struct {
	Conversation dbgen.Conversation
	Agent        dbgen.Agent // may be soft-deleted
	AgentDeleted bool
	TeamSlug     string
	Messages     []MessageView
}

// conversationView loads a conversation's agent and messages.
func (s *Service) conversationView(ctx context.Context, c dbgen.Conversation) (ConversationView, error) {
	v := ConversationView{Conversation: c}
	if err := s.Pool.QueryRow(ctx, `SELECT a.id, a.team_id, a.slug, a.name, a.description, a.accent_color, t.slug, a.deleted_at IS NOT NULL
		FROM agents a JOIN teams t ON t.id = a.team_id WHERE a.id = $1`, c.AgentID).Scan(
		&v.Agent.ID, &v.Agent.TeamID, &v.Agent.Slug, &v.Agent.Name, &v.Agent.Description, &v.Agent.AccentColor, &v.TeamSlug, &v.AgentDeleted); err != nil {
		return v, err
	}
	rows, err := s.q.ListMessages(ctx, c.ID)
	if err != nil {
		return v, err
	}
	v.Messages = messageViews(rows)
	s.attachRouting(ctx, rows, v.Messages)
	return v, nil
}

func messageViews(rows []dbgen.ListMessagesRow) []MessageView {
	out := []MessageView{}
	var last *MessageView
	for _, r := range rows {
		switch r.Role {
		case "user":
			var c struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal(r.Content, &c)
			out = append(out, MessageView{ID: r.ID, Seq: r.Seq, Role: "user", Text: c.Text, CreatedAt: r.CreatedAt})
			last = nil
		case "assistant":
			out = append(out, assistantView(r))
			last = &out[len(out)-1]
		case "tool_result":
			if last == nil {
				continue
			}
			var tr struct {
				ToolCallID string      `json:"toolCallId"`
				IsError    bool        `json:"isError"`
				Details    toolDetails `json:"details"`
			}
			if json.Unmarshal(r.Content, &tr) != nil {
				continue
			}
			for i := range last.ToolCalls {
				if last.ToolCalls[i].ID == tr.ToolCallID {
					last.ToolCalls[i].IsError, last.ToolCalls[i].HitCount = tr.IsError, len(tr.Details.Hits)
					last.ToolCalls[i].Query, last.ToolCalls[i].Title = tr.Details.Query, tr.Details.Title
					last.ToolCalls[i].Error, last.ToolCalls[i].Result = stepOutcome(tr.IsError, tr.Details)
				}
			}
		}
	}
	return out
}

// assistantView is a stored answer: its text, thinking, tool calls,
// citations, usage and, when its citations were checked, its uncited
// sentences (found again in the text).
func assistantView(r dbgen.ListMessagesRow) MessageView {
	m := MessageView{ID: r.ID, Seq: r.Seq, Role: "assistant", StopReason: r.StopReason, ErrorCode: r.ErrorCode,
		LatencyMs: r.LatencyMs, Feedback: r.Feedback, FeedbackReason: r.FeedbackReason, FeedbackShared: r.FeedbackShared, CreatedAt: r.CreatedAt,
		Refused: r.AnswerRefused && r.ErrorCode == "", Citations: []Citation{}}
	blocks, _ := llm.UnmarshalBlocks(r.Content)
	var think []string
	thought := 0 // UTF-16 length of strings.Join(think, "\n\n")
	for _, b := range blocks {
		switch v := b.(type) {
		case llm.Text:
			m.Text += v.Text
		case llm.Thinking:
			if len(think) > 0 {
				thought += 2
			}
			think = append(think, v.Text)
			thought += utf16Len(v.Text)
		case llm.ToolCall:
			args := v.Arguments
			if len(args) == 0 {
				args = json.RawMessage("null")
			}
			m.ToolCalls = append(m.ToolCalls, ToolCallView{ID: v.ID, Name: v.Name, Arguments: args, ThinkingBefore: thought})
		}
	}
	m.Thinking = strings.Join(think, "\n\n")
	if len(r.Retrieval) > 0 {
		var rv RetrievalView
		if json.Unmarshal(r.Retrieval, &rv) == nil {
			m.Retrieval = &rv
		}
	}
	if len(r.Citations) > 0 {
		_ = json.Unmarshal(r.Citations, &m.Citations)
	}
	checkedView(&m, r)
	if len(r.Usage) > 0 {
		var u llm.Usage
		if json.Unmarshal(r.Usage, &u) == nil {
			m.Usage = &u
		}
	}
	return m
}

// checkedView adds what an answer's citation check found: its uncited
// sentences (found again in the stored text) and its claims.
func checkedView(m *MessageView, r dbgen.ListMessagesRow) {
	if len(r.CitationCheck) == 0 || r.AnswerRefused || r.ErrorCode != "" {
		return
	}
	if !r.AnswerNoContext {
		m.Uncited = UncitedSentences(m.Text)
	}
	var rec CitationsRecord
	if json.Unmarshal(r.CitationCheck, &rec) == nil {
		m.Claims = FillClaimText(m.Text, rec.ClaimList)
	}
}

// utf16Len is the length of s in UTF-16 code units, as a browser counts a
// string (invalid UTF-8 counts as U+FFFD, as JSON encodes it).
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}
