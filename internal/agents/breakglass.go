// Conversations read under break-glass (ADR-0024): a platform admin with an
// active session that has the conversations scope may list a team's
// conversations and read their transcripts. Every read is audited by
// breakglass.Authorize. Nothing else changes: renaming, deleting,
// exporting, feedback and chat stay the owner's alone (ADR-0010), and the
// admin never sees who a user is.

package agents

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// TeamConversation is a conversation in a team's list (no user identity).
type TeamConversation = dbgen.ListTeamConversationsRow

var errBreakGlassConversations = apperr.Forbidden("Conversations are private to their users. A platform admin needs an active break-glass session with the conversations scope for this team.")

// ReadConversation returns a conversation with its messages to its owner,
// or to a platform admin whose break-glass session covers the
// conversation's team. Anyone else gets 404.
func (s *Service) ReadConversation(ctx context.Context, a authz.Actor, id uuid.UUID) (ConversationView, error) {
	v, err := s.GetConversation(ctx, a, id)
	if err == nil || !errors.Is(err, errNoConversation) || a.Key != nil || !a.IsPlatformAdmin() {
		return v, err
	}
	team, terr := s.q.ConversationTeam(ctx, id)
	if errors.Is(store.NotFound(terr), store.ErrNotFound) {
		return v, err
	} else if terr != nil {
		return v, terr
	}
	g, gerr := s.BreakGlass.Authorize(ctx, a, team, breakglass.Read{
		Kind: breakglass.ReadConversation, TargetType: "conversation", TargetID: id.String(),
	})
	if gerr != nil {
		return v, gerr
	}
	if g == nil {
		return v, err
	}
	c, cerr := s.q.GetConversation(ctx, id)
	if errors.Is(store.NotFound(cerr), store.ErrNotFound) {
		return v, errNoConversation
	} else if cerr != nil {
		return v, cerr
	}
	return s.conversationView(ctx, c)
}

// TeamConversationCursor is the position after the last listed conversation.
type TeamConversationCursor struct {
	UpdatedAt time.Time
	ID        uuid.UUID
}

// ListTeamConversations lists a team's conversations (with its agents,
// by anyone), most recent first, for a platform admin with an active
// break-glass session with the conversations scope. Members, team admins
// and everyone else are refused: a transcript is its user's alone.
func (s *Service) ListTeamConversations(ctx context.Context, a authz.Actor, teamRef string, agentID *uuid.UUID, after *TeamConversationCursor, limit int32) ([]TeamConversation, *TeamConversationCursor, error) {
	if a.Key != nil || !a.IsPlatformAdmin() {
		return nil, nil, errBreakGlassConversations
	}
	acc, err := s.Teams.Get(ctx, a, teamRef)
	if err != nil {
		return nil, nil, err
	}
	g, err := s.BreakGlass.Authorize(ctx, a, acc.Team.ID, breakglass.Read{
		Kind: breakglass.ReadConversationList, TargetType: "team", TargetID: acc.Team.ID.String(),
	})
	if err != nil {
		return nil, nil, err
	}
	if g == nil {
		return nil, nil, errBreakGlassConversations
	}
	p := dbgen.ListTeamConversationsParams{TeamID: acc.Team.ID, PageSize: limit + 1}
	if agentID != nil {
		p.AgentID = uuid.NullUUID{UUID: *agentID, Valid: true}
	}
	if after != nil {
		p.BeforeUpdated, p.BeforeID = &after.UpdatedAt, uuid.NullUUID{UUID: after.ID, Valid: true}
	}
	rows, err := s.q.ListTeamConversations(ctx, p)
	if err != nil {
		return nil, nil, err
	}
	var next *TeamConversationCursor
	if len(rows) > int(limit) {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		next = &TeamConversationCursor{UpdatedAt: last.UpdatedAt, ID: last.ID}
	}
	return rows, next, nil
}
