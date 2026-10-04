package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/answercache"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

var errNoConversation = apperr.NotFound(conversationNotFoundCode, "Conversation not found")

// Conversations belong to their user alone (ADR-0010): every function here
// answers 404 to anyone else, including team admins and platform staff. A
// personal API key acts as its user only with the query scope (chat is
// what makes conversations), and only for conversations with agents it
// could chat with: its team's, and the ones it is restricted to (DESIGN.md
// §3.3; keyReaches).
func ownerOnly(a authz.Actor) error {
	if a.UserID == uuid.Nil || (a.Key != nil && (!a.Key.Personal() || !a.Key.HasScope(authz.ScopeQuery))) {
		return errNoConversation
	}
	return nil
}

// keyReaches reports whether the actor's API key, if any, may reach a
// conversation with the agent.
func (s *Service) keyReaches(ctx context.Context, a authz.Actor, agentID uuid.UUID) (bool, error) {
	if a.Key == nil {
		return true, nil
	}
	if !a.Key.AllowsAgent(agentID) {
		return false, nil
	}
	var teamID uuid.UUID
	if err := s.Pool.QueryRow(ctx, `SELECT team_id FROM agents WHERE id = $1`, agentID).Scan(&teamID); err != nil {
		return false, store.NotFound(err)
	}
	return teamID == a.Key.TeamID, nil
}

// ConversationSummary is one conversation in a list.
type ConversationSummary = dbgen.ListConversationsRow

// ConversationCursor is the position after the last listed conversation.
type ConversationCursor struct {
	UpdatedAt time.Time
	ID        uuid.UUID
}

// ConversationFilter narrows a conversation list. Empty fields don't filter.
type ConversationFilter struct {
	AgentID *uuid.UUID
	// Search matches the title or the agent's name (case-insensitive substring).
	Search string
	// From and To bound the last activity (updated_at); To is exclusive.
	From, To *time.Time
}

// ListConversations lists the actor's conversations, most recent first.
func (s *Service) ListConversations(ctx context.Context, a authz.Actor, f ConversationFilter, after *ConversationCursor, limit int32) ([]ConversationSummary, *ConversationCursor, error) {
	if err := ownerOnly(a); err != nil {
		return []ConversationSummary{}, nil, nil
	}
	p := dbgen.ListConversationsParams{UserID: a.UserID, PageSize: limit + 1, UpdatedFrom: f.From, UpdatedTo: f.To}
	if a.Key != nil {
		p.TeamID = uuid.NullUUID{UUID: a.Key.TeamID, Valid: true}
		if len(a.Key.AgentIDs) > 0 {
			p.AgentIDs = a.Key.AgentIDs
		}
	}
	if f.AgentID != nil {
		p.AgentID = uuid.NullUUID{UUID: *f.AgentID, Valid: true}
	}
	if q := strings.TrimSpace(f.Search); q != "" {
		escaped := store.EscapeLike(q)
		p.Search = &escaped
	}
	if after != nil {
		p.BeforeUpdated, p.BeforeID = &after.UpdatedAt, uuid.NullUUID{UUID: after.ID, Valid: true}
	}
	rows, err := s.q.ListConversations(ctx, p)
	if err != nil {
		return nil, nil, err
	}
	var next *ConversationCursor
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		next = &ConversationCursor{UpdatedAt: last.UpdatedAt, ID: last.ID}
	}
	return rows, next, nil
}

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
	Claims    []Claim   `json:"claims,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// ConversationView is a conversation with its transcript.
type ConversationView struct {
	Conversation dbgen.Conversation
	Agent        dbgen.Agent // may be soft-deleted
	AgentDeleted bool
	TeamSlug     string
	Messages     []MessageView
}

func (s *Service) ownConversation(ctx context.Context, a authz.Actor, id uuid.UUID) (dbgen.Conversation, error) {
	if err := ownerOnly(a); err != nil {
		return dbgen.Conversation{}, err
	}
	c, err := s.q.GetConversation(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && !ownedBy(c.UserID, a.UserID)) {
		return c, errNoConversation
	} else if err != nil {
		return c, err
	}
	if ok, err := s.keyReaches(ctx, a, c.AgentID); err != nil || !ok {
		return c, notFoundAs(err, errNoConversation)
	}
	return c, nil
}

// notFoundAs returns notFound for a refusal (nil) or a missing row, and
// other errors as they are.
func notFoundAs(err, notFound error) error {
	if err == nil || errors.Is(err, store.ErrNotFound) {
		return notFound
	}
	return err
}

// GetConversation returns the actor's own conversation with its messages.
func (s *Service) GetConversation(ctx context.Context, a authz.Actor, id uuid.UUID) (ConversationView, error) {
	c, err := s.ownConversation(ctx, a, id)
	if err != nil {
		return ConversationView{}, err
	}
	return s.conversationView(ctx, c)
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

// RenameConversation changes the title of the actor's conversation.
func (s *Service) RenameConversation(ctx context.Context, a authz.Actor, id uuid.UUID, title string) (dbgen.Conversation, error) {
	title = strings.TrimSpace(title)
	if n := len([]rune(title)); n < 1 || n > 200 {
		return dbgen.Conversation{}, apperr.Invalid("invalid_title", "The title must be 1-200 characters")
	}
	if _, err := s.ownConversation(ctx, a, id); err != nil {
		return dbgen.Conversation{}, err
	}
	return s.q.RenameConversation(ctx, dbgen.RenameConversationParams{ID: id, Title: title})
}

// DeleteConversation hides the actor's conversation at once; retention
// removes it for good later (Phase 5).
func (s *Service) DeleteConversation(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if _, err := s.ownConversation(ctx, a, id); err != nil {
		return err
	}
	return s.q.SoftDeleteConversation(ctx, id)
}

// ExportMarkdown renders a conversation as Markdown with its citations, its
// times in the reader's zone.
func ExportMarkdown(v ConversationView, loc *time.Location) string {
	var b strings.Builder
	title := v.Conversation.Title
	if title == "" {
		title = "Conversation"
	}
	fmt.Fprintf(&b, "# %s\n\n", title)
	fmt.Fprintf(&b, "- Agent: %s (%s/%s)\n", v.Agent.Name, v.TeamSlug, v.Agent.Slug)
	fmt.Fprintf(&b, "- Started: %s\n", v.Conversation.CreatedAt.In(loc).Format(time.RFC3339))
	fmt.Fprintf(&b, "- Exported: %s\n\n", time.Now().In(loc).Format(time.RFC3339))
	for _, m := range v.Messages {
		who := "You"
		if m.Role == "assistant" {
			who = v.Agent.Name
		}
		fmt.Fprintf(&b, "## %s (%s)\n\n", who, m.CreatedAt.In(loc).Format("2006-01-02 15:04 MST"))
		text := strings.TrimSpace(m.Text)
		switch {
		case text != "":
			b.WriteString(text + "\n\n")
		case m.ErrorCode != "":
			fmt.Fprintf(&b, "_No answer (%s)._\n\n", m.ErrorCode)
		case m.StopReason == string(llm.StopReasonAborted):
			b.WriteString("_Stopped before answering._\n\n")
		}
		if len(m.Citations) > 0 {
			b.WriteString("Sources:\n\n")
			for _, c := range m.Citations {
				fmt.Fprintf(&b, "%d. %s", c.N, c.Title)
				if len(c.HeadingPath) > 0 {
					fmt.Fprintf(&b, " — %s", strings.Join(c.HeadingPath, " › "))
				}
				if c.PageStart != nil && *c.PageStart > 0 {
					fmt.Fprintf(&b, ", p. %d", *c.PageStart)
				}
				if c.URL != "" {
					fmt.Fprintf(&b, " <%s>", c.URL)
				}
				b.WriteString("\n")
				if c.Snippet != "" {
					fmt.Fprintf(&b, "   > %s\n", c.Snippet)
				}
			}
			b.WriteString("\n")
		}
	}
	return b.String()
}

// FeedbackNone takes a rating back (v0.4.2 US-11): the answer has none again.
const FeedbackNone = "none"

// Feedback reasons (docs/phase3-agents.md §7).
var feedbackReasons = map[string]bool{
	"incorrect": true, "not_helpful": true, "missing_sources": true, "wrong_sources": true,
	"outdated": true, "harmful_or_unsafe": true, "other": true,
}

// SetFeedback rates an answer in the actor's own conversation. It is
// recorded on the answer's analytics event (no free text). A thumbs-down
// keeps the question for the gap report, shown in full to the team's
// editors only when share is set (gaps.go, ADR-0010 as amended).
func (s *Service) SetFeedback(ctx context.Context, a authz.Actor, messageID uuid.UUID, rating string, reason *string, share bool) error {
	reason, err := checkFeedback(rating, reason)
	if err != nil {
		return err
	}
	errNoMessage := apperr.NotFound("message_not_found", "Message not found")
	if err := ownerOnly(a); err != nil {
		return errNoMessage
	}
	m, err := s.q.GetMessageOwner(ctx, messageID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && (!ownedBy(m.UserID, a.UserID) || m.Role != "assistant")) {
		return errNoMessage
	} else if err != nil {
		return err
	}
	if ok, err := s.keyReaches(ctx, a, m.AgentID); err != nil || !ok {
		return notFoundAs(err, errNoMessage)
	}
	var teamID uuid.UUID
	if err := s.Pool.QueryRow(ctx, `SELECT team_id FROM agents WHERE id = $1`, m.AgentID).Scan(&teamID); err != nil {
		return err
	}
	return s.recordFeedback(ctx, messageID, rating, reason, share && rating == "down", s.pseudonym(teamID, a), errNoMessage)
}

// checkFeedback validates a rating and its reason ("" is none).
func checkFeedback(rating string, reason *string) (*string, error) {
	if rating != "up" && rating != "down" && rating != FeedbackNone {
		return nil, apperr.Invalid("invalid_rating", "Rating must be up, down or none")
	}
	if rating == FeedbackNone {
		return nil, nil
	}
	if reason != nil && *reason == "" {
		reason = nil
	}
	if reason != nil && !feedbackReasons[*reason] {
		return nil, apperr.Invalid("invalid_reason", "Reason must be one of incorrect, not_helpful, missing_sources, wrong_sources, outdated, harmful_or_unsafe or other")
	}
	return reason, nil
}

// recordFeedback stores a rating on the answer's analytics event and acts on
// it (afterFeedback); errNoMessage when the answer has no event.
func (s *Service) recordFeedback(ctx context.Context, messageID uuid.UUID, rating string, reason *string, share bool, asker *string, errNoMessage error) error {
	stored := &rating
	if rating == FeedbackNone {
		stored = nil // taken back: no rating (v0.4.2 US-11)
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		n, err := q.SetMessageFeedback(ctx, dbgen.SetMessageFeedbackParams{
			MessageID: uuid.NullUUID{UUID: messageID, Valid: true}, Feedback: stored, FeedbackReason: reason, FeedbackShared: share,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return errNoMessage
		}
		return afterFeedback(ctx, tx, messageID, rating, reason, share, asker)
	})
}

// afterFeedback evicts a thumbs-down answer from the answer cache, so the
// next person gets a fresh one (docs/answer-cache.md), and records the
// rating for the gap report (gaps.go).
func afterFeedback(ctx context.Context, tx pgx.Tx, messageID uuid.UUID, rating string, reason *string, share bool, asker *string) error {
	if rating == "down" {
		if _, err := answercache.EvictMessage(ctx, tx, messageID); err != nil {
			return err
		}
	}
	return gapFeedback(ctx, tx, messageID, rating, reason, share, asker)
}

// ownedBy reports whether a conversation's user is id (anonymous
// conversations have none).
func ownedBy(user uuid.NullUUID, id uuid.UUID) bool {
	return user.Valid && id != uuid.Nil && user.UUID == id
}
