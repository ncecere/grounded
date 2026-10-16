// Who is asking, and which conversation a question continues (Chat's checks before an answer starts).

package agents

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// checkCaller decides whether the caller is stateless (service keys and the
// OpenAI-compatible endpoint send prior turns in history; users' conversations
// are stored) and checks the history it sent.
func checkCaller(a authz.Actor, req ChatRequest) (bool, []HistoryMessage, error) {
	stateless := req.Stateless || (a.Key != nil && !a.Key.Personal()) || a.UserID == uuid.Nil
	if stateless && req.ConversationID != nil {
		return false, nil, apperr.Invalid("conversation_not_allowed",
			"This caller is stateless (service key or OpenAI-compatible endpoint): send prior turns in history instead of conversationId")
	}
	if !stateless && len(req.History) > 0 {
		return false, nil, apperr.Invalid("history_not_allowed", "Conversations are stored for you: send conversationId instead of history")
	}
	hist, err := checkHistory(req.History)
	if err != nil {
		return false, nil, err
	}
	return stateless, hist, nil
}

// continuedConversation loads the conversation a user continues: it must be
// theirs and belong to the agent.
func (s *Service) continuedConversation(ctx context.Context, a authz.Actor, agentID, id uuid.UUID) (*dbgen.Conversation, error) {
	c, err := s.q.GetConversation(ctx, id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && (!ownedBy(c.UserID, a.UserID) || c.AgentID != agentID)) {
		return nil, apperr.NotFound(conversationNotFoundCode, "Conversation not found")
	} else if err != nil {
		return nil, err
	}
	return &c, nil
}
