// Feedback from anonymous visitors (the public page and the widget;
// walkthrough addition, docs/v0.4.0.md §2): the same thumbs, reasons and
// share tick as signed-in feedback, for answers in the anonymous session's
// own conversations with the agent (the source viewer's rule). A
// thumbs-down evicts a saved answer and feeds the gap report, each
// anonymous session counting as one person (ADR-0010 as amended).

package agents

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/store"
)

// PublicFeedback rates an answer in a conversation of an anonymous session
// with the agent; 404 for any other message. The caller has checked the
// agent is public and live, and the guardrails.
func (s *Service) PublicFeedback(ctx context.Context, sessionID, agentID, messageID uuid.UUID, rating string, reason *string, share bool) error {
	reason, err := checkFeedback(rating, reason)
	if err != nil {
		return err
	}
	errNoMessage := apperr.NotFound("message_not_found", "Message not found")
	m, err := s.q.GetCitedMessage(ctx, messageID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) ||
		(err == nil && (!m.AnonSessionID.Valid || m.AnonSessionID.UUID != sessionID || m.AgentID != agentID || m.Role != "assistant")) {
		return errNoMessage
	} else if err != nil {
		return err
	}
	return s.recordFeedback(ctx, messageID, rating, reason, share && rating == "down", s.anonPseudonym(agentID, sessionID), errNoMessage)
}
