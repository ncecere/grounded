package agents

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Sharing a conversation (v0.6.0, C12; ADR-0010 amendment; docs/specs/v0.6.0/DESIGN.md §3). The owner makes a link to a read-only view of their
// own conversation. A share names the conversation and the last message it covers (so it is a snapshot); it holds no copy of the transcript,
// so the conversation's deletion ends it (shares_view.go decides who may open one).

// Who a share is for.
const (
	// ShareAgentUsers: signed-in people who may chat with the agent.
	ShareAgentUsers = "agent_users"
	// ShareAnyone: anyone with the link, only for a public agent.
	ShareAnyone = "anyone"

	// MaxSharesPerConversation bounds the links of one conversation.
	MaxSharesPerConversation = 10
)

// shareTokenLen is the length of a link's secret as text: 32 random bytes, base64url without padding.
const shareTokenLen = 43

var (
	errNoShare        = apperr.NotFound("share_not_found", "Shared conversation not found")
	errNothingToShare = apperr.Conflict("nothing_to_share", "This conversation has no finished answer to share yet")
	errRoutedShare    = apperr.Conflict("not_shareable", "This conversation holds answers from other agents, sent by a router, whose audience may differ: it can't be shared. Share the conversation with the agent itself")
	errTooManyShares  = apperr.Conflict("too_many_shares", "This conversation has as many links as allowed: revoke one first")
	errShareNeedsUser = apperr.Forbidden("Only people signed in can share a conversation, and not through an API key")
	errAgentNotShared = apperr.Conflict("agent_unavailable", "This agent is not available now, so its conversations can't be shared")
	errPublicShare    = apperr.Conflict("public_share_unavailable", "A link open to anyone needs a public agent and public access turned on")
	errBadAudience    = apperr.Invalid("invalid_audience", "Audience must be agent_users or anyone")
)

// newShareToken makes a link's secret and the hash that is kept.
func newShareToken() (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	return token, sum[:], nil
}

// shareTokenHash is the hash of a link's secret, or false when the text cannot be one (so nothing is looked up for it).
func shareTokenHash(token string) ([]byte, bool) {
	if len(token) != shareTokenLen {
		return nil, false
	}
	// Strict: the canonical text only, so one secret has one spelling.
	if raw, err := base64.RawURLEncoding.Strict().DecodeString(token); err != nil || len(raw) != 32 {
		return nil, false
	}
	sum := sha256.Sum256([]byte(token))
	return sum[:], true
}

// ShareInput is what the owner chooses.
type ShareInput struct {
	Audience string
	// ShowName puts the sharer's display name on the shared view (off by default).
	ShowName bool
}

// Share is one of a conversation's links, as its owner lists it (the secret is not kept, so the link is not shown again).
type Share struct {
	ID           uuid.UUID
	Audience     string
	ShowName     bool
	UpToSeq      int32
	MessageCount int
	CreatedAt    time.Time
}

// CreatedShare is a new link: its secret is shown once.
type CreatedShare struct {
	Share
	Token string
}

// shareable loads the conversation's agent and says whether its conversations can be shared now: published and active, and, for a link open to
// anyone, public with public access on.
func (s *Service) shareable(ctx context.Context, agentID uuid.UUID, audience string) error {
	ag, err := s.q.GetAgent(ctx, agentID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return errAgentNotShared
	} else if err != nil {
		return err
	}
	if ag.DeletedAt != nil || ag.Status != StatusActive || !ag.PublishedVersionID.Valid {
		return errAgentNotShared
	}
	if audience != ShareAnyone {
		return nil
	}
	grant := s.grantOf(ctx, agentID)
	on, err := s.publicEnabled(ctx)
	if err != nil {
		return err
	}
	if grant != authz.AudiencePublic || !on {
		return errPublicShare
	}
	return nil
}

// grantOf is the agent's published audience (the team when it has none).
func (s *Service) grantOf(ctx context.Context, agentID uuid.UUID) string {
	if g, err := s.q.GetAudienceGrant(ctx, agentID); err == nil {
		return g.PrincipalType
	}
	return authz.AudienceTeam
}

// CreateShare makes a link to the owner's conversation, up to its last finished answer. Only the conversation's owner, signed in (an API key
// cannot make links); everyone else gets 404.
func (s *Service) CreateShare(ctx context.Context, a authz.Actor, conversationID uuid.UUID, in ShareInput) (CreatedShare, error) {
	if a.Delegated() || a.UserID == uuid.Nil {
		return CreatedShare{}, errShareNeedsUser
	}
	if in.Audience != ShareAgentUsers && in.Audience != ShareAnyone {
		return CreatedShare{}, errBadAudience
	}
	conv, err := s.ownConversation(ctx, a, conversationID)
	if err != nil {
		return CreatedShare{}, err
	}
	if err := s.shareable(ctx, conv.AgentID, in.Audience); err != nil {
		return CreatedShare{}, err
	}
	token, hash, err := newShareToken()
	if err != nil {
		return CreatedShare{}, err
	}
	var out dbgen.ConversationShare
	err = store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		// The conversation's row is locked so two requests cannot both pass the limit; deleted in between: gone.
		if _, err := q.LockConversation(ctx, conversationID); err != nil {
			return notFoundAs(store.NotFound(err), errNoConversation)
		}
		seq, err := q.LastCompleteAnswerSeq(ctx, conversationID)
		if err != nil {
			return err
		}
		if seq == 0 {
			return errNothingToShare
		}
		if routed, err := s.hasRoutedAnswers(ctx, conversationID, seq); err != nil {
			return err
		} else if routed {
			return errRoutedShare
		}
		if n, err := q.CountConversationShares(ctx, conversationID); err != nil {
			return err
		} else if n >= MaxSharesPerConversation {
			return errTooManyShares
		}
		if out, err = q.InsertConversationShare(ctx, dbgen.InsertConversationShareParams{
			ConversationID: conversationID, TokenHash: hash, UpToSeq: seq, Audience: in.Audience, ShowName: in.ShowName, CreatedBy: a.UserID,
		}); err != nil {
			return err
		}
		return audit.Record(ctx, q, shareAudit(a, "conversation_share.create", out.ID, in.Audience, in.ShowName))
	})
	if err != nil {
		return CreatedShare{}, err
	}
	listed, err := s.q.ListConversationShares(ctx, conversationID)
	if err != nil {
		return CreatedShare{}, err
	}
	for _, m := range listed {
		if m.ID == out.ID {
			return CreatedShare{Share: shareOf(m), Token: token}, nil
		}
	}
	return CreatedShare{Share: Share{ID: out.ID, Audience: out.Audience, ShowName: out.ShowName, UpToSeq: out.UpToSeq, CreatedAt: out.CreatedAt}, Token: token}, nil
}

func shareOf(r dbgen.ListConversationSharesRow) Share {
	return Share{ID: r.ID, Audience: r.Audience, ShowName: r.ShowName, UpToSeq: r.UpToSeq, MessageCount: int(r.MessageCount), CreatedAt: r.CreatedAt}
}

// shareAudit is the platform audit entry of a link made or revoked. It names no team, agent or conversation, and holds no content: teams never
// see who a user is (ADR-0010), and the platform log needs only that a link exists, who made it, and whether it is open to anyone.
func shareAudit(a authz.Actor, action string, id uuid.UUID, audience string, showName bool) audit.Entry {
	e := a.Audit(action, "conversation_share", id.String())
	e.Metadata = map[string]any{"audience": audience, "showName": showName}
	return e
}

// ListShares lists the owner's links to a conversation, newest first.
func (s *Service) ListShares(ctx context.Context, a authz.Actor, conversationID uuid.UUID) ([]Share, error) {
	if a.Delegated() || a.UserID == uuid.Nil {
		return nil, errShareNeedsUser
	}
	if _, err := s.ownConversation(ctx, a, conversationID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListConversationShares(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	out := make([]Share, len(rows))
	for i, r := range rows {
		out[i] = shareOf(r)
	}
	return out, nil
}

// RevokeShare ends a link at once (the owner's own conversation only).
func (s *Service) RevokeShare(ctx context.Context, a authz.Actor, conversationID, shareID uuid.UUID) error {
	if a.Delegated() || a.UserID == uuid.Nil {
		return errShareNeedsUser
	}
	if _, err := s.ownConversation(ctx, a, conversationID); err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		var audience string
		var showName bool
		rows, err := q.ListConversationShares(ctx, conversationID)
		if err != nil {
			return err
		}
		for _, r := range rows {
			if r.ID == shareID {
				audience, showName = r.Audience, r.ShowName
			}
		}
		n, err := q.DeleteConversationShare(ctx, dbgen.DeleteConversationShareParams{ID: shareID, ConversationID: conversationID})
		if err != nil {
			return err
		}
		if n == 0 {
			return errNoShare
		}
		return audit.Record(ctx, q, shareAudit(a, "conversation_share.revoke", shareID, audience, showName))
	})
}
