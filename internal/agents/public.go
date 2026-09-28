// Anonymous public chat (docs/phase4-publishing.md §5): public profiles by
// ID or short name, chat for an anonymous session and the session's
// current conversation. Guardrails (rate limits, daily caps, concurrency,
// CAPTCHA) are applied by the caller (internal/public) before these run.

package agents

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Channels of anonymous traffic.
const (
	ChannelPublic = "public"
	ChannelWidget = "widget"
)

// ErrPublicDisabled is 503 public_disabled: while the platform switch is
// off, public pages, the embed and the public API refuse.
func ErrPublicDisabled() error {
	return apperr.New(http.StatusServiceUnavailable, "public_disabled", "Public agents are turned off on this platform right now.")
}

// AnonCaller is an anonymous visitor's session.
type AnonCaller struct {
	SessionID uuid.UUID
	// Channel is public (the /a/ page) or widget.
	Channel string
	// ConversationID is the session's current conversation, if any.
	ConversationID *uuid.UUID
}

// PublicTarget is a live public agent: its profile, team and the limits
// scope the guardrails need.
type PublicTarget struct {
	Card
	TeamID uuid.UUID
}

// resolvePublic finds a published public agent by ID or short name while
// the public switch is on (503 public_disabled otherwise; 404 for anything
// that is not public).
func (s *Service) resolvePublic(ctx context.Context, ref string) (resolved, error) {
	var r resolved
	on, err := s.publicEnabled(ctx)
	if err != nil {
		return r, err
	}
	if !on {
		return r, ErrPublicDisabled()
	}
	r.agent, err = s.agentByPublicRef(ctx, ref)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return r, errNoAgent
	} else if err != nil {
		return r, err
	}
	g, err := s.q.GetAudienceGrant(ctx, r.agent.ID)
	if err != nil || g.PrincipalType != authz.AudiencePublic || !r.agent.PublishedVersionID.Valid {
		return r, errNoAgent
	}
	r.grant = g.PrincipalType
	if r.team, err = s.q.GetTeamByID(ctx, r.agent.TeamID); err != nil {
		return r, err
	}
	if r.version, err = s.q.GetAgentVersion(ctx, r.agent.PublishedVersionID.UUID); err != nil {
		return r, err
	}
	r.config = DecodeConfig(r.version.Config)
	return r, nil
}

// agentByPublicRef finds an agent by ID, short name or "{team}/{slug}"
// (the team address, docs/ui-review F-07).
func (s *Service) agentByPublicRef(ctx context.Context, ref string) (dbgen.Agent, error) {
	ref = strings.ToLower(strings.TrimSpace(ref))
	if id, err := uuid.Parse(ref); err == nil {
		return s.q.GetAgent(ctx, id)
	}
	team, slug, ok := strings.Cut(ref, "/")
	if !ok {
		return s.q.AgentByShortName(ctx, ref)
	}
	t, err := s.q.GetTeamBySlug(ctx, team)
	if err != nil {
		return dbgen.Agent{}, err
	}
	return s.q.GetAgentBySlug(ctx, dbgen.GetAgentBySlugParams{TeamID: t.ID, Slug: slug})
}

// PublicProfile is a public agent's profile for anonymous visitors (ref: an
// agent ID, short name or "{team}/{slug}"). Disabled agents are returned with their status.
func (s *Service) PublicProfile(ctx context.Context, ref string) (PublicTarget, error) {
	r, err := s.resolvePublic(ctx, ref)
	if err != nil {
		return PublicTarget{}, err
	}
	return PublicTarget{Card: s.card(ctx, r), TeamID: r.team.ID}, nil
}

// PublicChat answers an anonymous visitor. The conversation is stored for
// the session (anonymous retention deletes it); newConversation starts a
// new one within the session.
func (s *Service) PublicChat(ctx context.Context, caller AnonCaller, agentID uuid.UUID, message string, newConversation bool, emit func(Event)) (Answer, error) {
	question, err := checkMessage(message)
	if err != nil {
		return Answer{}, err
	}
	r, err := s.resolvePublic(ctx, agentID.String())
	if err != nil {
		return Answer{}, err
	}
	if r.agent.Status != StatusActive {
		return Answer{}, disabledError(r.agent)
	}
	pol, err := s.evaluate(ctx, s.q, r.team, &r.version.ChatModelID, r.config.KBIDs(), r.grant)
	if err != nil {
		return Answer{}, err
	}
	if len(pol.Violations) > 0 {
		s.recordViolation(ctx, authz.Actor{}, r.agent, r.version.Version, pol)
		return Answer{}, policyError(pol.Violations[0])
	}
	ru := &run{s: s, team: r.team, agent: r.agent, version: &r.version, cfg: r.config, grant: r.grant,
		rank: pol.Rank, channel: caller.Channel, persist: true, question: question, anon: &caller}
	if !newConversation && caller.ConversationID != nil {
		c, err := s.q.GetConversation(ctx, *caller.ConversationID)
		if err == nil && c.AgentID == r.agent.ID && c.AnonSessionID.Valid && c.AnonSessionID.UUID == caller.SessionID {
			ru.conv = &c
		} else if err != nil && !errors.Is(store.NotFound(err), store.ErrNotFound) {
			return Answer{}, err
		}
	}
	return ru.execute(ctx, emit)
}

// PublicConversation is an anonymous session's current conversation (nil
// when it has none, or it was deleted).
func (s *Service) PublicConversation(ctx context.Context, sessionID uuid.UUID, id *uuid.UUID) (*ConversationView, error) {
	if id == nil {
		return nil, nil
	}
	c, err := s.q.GetConversation(ctx, *id)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && (!c.AnonSessionID.Valid || c.AnonSessionID.UUID != sessionID)) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	v, err := s.conversationView(ctx, c)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// pseudonym is the answer's pseudonymous user: per team for people, per
// agent for anonymous sessions (docs/phase4-publishing.md §5).
func (ru *run) pseudonym() *string {
	if ru.anon == nil {
		return ru.s.pseudonym(ru.team.ID, ru.a)
	}
	if len(ru.s.Pepper) == 0 {
		return nil
	}
	kd := hmac.New(sha256.New, ru.s.Pepper)
	// "ragd-anon-pseudonym:" is a historical derivation label from before the
	// rename to Grounded. It must not change: it would re-key every stored
	// anonymous pseudonym.
	kd.Write([]byte("ragd-anon-pseudonym:" + ru.agent.ID.String()))
	m := hmac.New(sha256.New, kd.Sum(nil))
	m.Write([]byte(ru.anon.SessionID.String()))
	out := hex.EncodeToString(m.Sum(nil)[:16])
	return &out
}
