package agents

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/displaytext"
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

// RenameConversation changes the title of the actor's conversation.
func (s *Service) RenameConversation(ctx context.Context, a authz.Actor, id uuid.UUID, title string) (dbgen.Conversation, error) {
	if err := displaytext.Validate(title, "invalid_title", "Title"); err != nil {
		return dbgen.Conversation{}, err
	}
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

// ownedBy reports whether a conversation's user is id (anonymous
// conversations have none).
func ownedBy(user uuid.NullUUID, id uuid.UUID) bool {
	return user.Valid && id != uuid.Nil && user.UUID == id
}
