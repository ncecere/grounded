package agents

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/answercache"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/webhooks"
)

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
		// What it was before: the same rating sent again is not a new rating, so it is not a new event.
		var prev, prevReason *string
		if err := tx.QueryRow(ctx, `SELECT feedback, feedback_reason FROM message_events WHERE message_id = $1 FOR UPDATE`, messageID).Scan(&prev, &prevReason); errors.Is(err, pgx.ErrNoRows) {
			return errNoMessage
		} else if err != nil {
			return err
		}
		unchanged := sameText(prev, stored) && sameText(prevReason, reason)
		n, err := q.SetMessageFeedback(ctx, dbgen.SetMessageFeedbackParams{
			MessageID: uuid.NullUUID{UUID: messageID, Valid: true}, Feedback: stored, FeedbackReason: reason, FeedbackShared: share,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return errNoMessage
		}
		if err := afterFeedback(ctx, tx, messageID, rating, reason, share, asker); err != nil {
			return err
		}
		if unchanged {
			return nil
		}
		return s.emitFeedback(ctx, tx, messageID, rating, reason)
	})
}

// sameText reports whether two optional strings are both unset or equal.
func sameText(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

// emitFeedback tells webhooks a rating was given: the agent, the message, the rating and the reason, never the question, the answer, a comment
// or who. Taking a rating back says nothing.
func (s *Service) emitFeedback(ctx context.Context, tx pgx.Tx, messageID uuid.UUID, rating string, reason *string) error {
	if rating == FeedbackNone {
		return nil
	}
	var teamID, agentID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT team_id, agent_id FROM message_events WHERE message_id = $1`, messageID).Scan(&teamID, &agentID); err != nil {
		return err
	}
	data := map[string]any{"agentId": agentID, "messageId": messageID, "rating": rating}
	if reason != nil {
		data["reason"] = *reason
	}
	return s.Webhooks.Emit(ctx, tx, webhooks.Event{Type: webhooks.EventFeedbackSubmitted, TeamID: teamID, Data: data})
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
