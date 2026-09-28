// Package public serves public agents to anonymous visitors
// (docs/phase4-publishing.md §5-§7): anonymous sessions, the public chat
// with its guardrails, the widget's publishable keys and allowed origins,
// and CAPTCHA on session creation.
package public

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/netip"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/captcha"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// DefaultSessionTTL is how long an anonymous session lives after its last
// use (ANON_SESSION_TTL).
const DefaultSessionTTL = 24 * time.Hour

// sessionsPerIPPerMinute bounds session creation per network address, so
// a script cannot fill the table (fails closed with the other counters).
const sessionsPerIPPerMinute = 30

// Service runs anonymous sessions, public chat and publishable keys.
type Service struct {
	Pool    *pgxpool.Pool
	Agents  *agents.Service
	Teams   *teams.Service
	Limits  *limits.Service
	Guard   *Guard
	Captcha captcha.Verifier
	// Pepper keys the publishable key digests (API_KEY_PEPPER; nil: keys
	// can't be created or used).
	Pepper []byte
	// PreviousPepper is API_KEY_PEPPER_PREVIOUS (nil: no rotation).
	PreviousPepper []byte
	SessionTTL     time.Duration
	Log            *slog.Logger
	q              *dbgen.Queries
}

// New returns a Service.
func New(pool *pgxpool.Pool, a *agents.Service, t *teams.Service, l *limits.Service, g *Guard, v captcha.Verifier, pepper []byte, ttl time.Duration, log *slog.Logger) *Service {
	if ttl <= 0 {
		ttl = DefaultSessionTTL
	}
	if v == nil {
		v = captcha.None{}
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{Pool: pool, Agents: a, Teams: t, Limits: l, Guard: g, Captcha: v, Pepper: pepper, SessionTTL: ttl, Log: log, q: dbgen.New(pool)}
}

// Session is an anonymous visitor's session.
type Session = dbgen.AnonSession

func digest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// IPPrefix is the network an address belongs to: /24 for IPv4, /48 for
// IPv6. Only the prefix is stored and rate-limited (ADR-0010).
func IPPrefix(ip string) string {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return "unknown"
	}
	addr = addr.Unmap()
	bits := 48
	if addr.Is4() {
		bits = 24
	}
	p, _ := addr.Prefix(bits)
	return p.String()
}

// StartRequest starts an anonymous session.
type StartRequest struct {
	AgentID      uuid.UUID
	CaptchaToken string
	// Key is the widget's publishable key ("" on the public page).
	Key string
	// Origin is the request's Origin header when it is not Grounded's own
	// origin; EmbedOrigin is the embedding page's origin, as the embed page
	// saw it. A widget session needs one of them, and each given must be
	// allowed by the key.
	Origin, EmbedOrigin string
	ClientIP, UserAgent string
}

var (
	errKey          = apperr.New(403, "invalid_publishable_key", "This widget's key is invalid, disabled or revoked.")
	errOrigin       = apperr.New(403, "origin_not_allowed", "This site is not allowed to embed this assistant.")
	errCaptchaFail  = apperr.New(403, "captcha_failed", "The verification didn't succeed. Try again.")
	errCaptchaError = apperr.New(503, "captcha_unavailable", "Verification is unavailable right now. Try again shortly.")
	errNoSession    = apperr.New(401, "session_required", "Start a session first.")
	errDisabled     = apperr.New(403, "agent_disabled", "This assistant has been turned off.")
)

// Start creates an anonymous session for a live public agent: the widget's
// key and origins are checked, then the CAPTCHA. token is the cookie value
// (shown once; only its digest is stored).
func (s *Service) Start(ctx context.Context, in StartRequest) (Session, agents.PublicTarget, string, error) {
	t, err := s.Agents.PublicProfile(ctx, in.AgentID.String())
	if err != nil {
		return Session{}, t, "", err
	}
	if t.Agent.Status != agents.StatusActive {
		return Session{}, t, "", errDisabled
	}
	channel, keyID := agents.ChannelPublic, uuid.NullUUID{}
	if in.Key != "" {
		k, err := s.checkKey(ctx, in.Key, in.AgentID)
		if err != nil {
			return Session{}, t, "", err
		}
		if !originsAllowed(in.Origin, in.EmbedOrigin, k.AllowedOrigins) {
			return Session{}, t, "", errOrigin
		}
		channel, keyID = agents.ChannelWidget, uuid.NullUUID{UUID: k.ID, Valid: true}
	}
	prefix := IPPrefix(in.ClientIP)
	if err := s.Guard.rate(ctx, limits.PublicQueriesPerIPPerMinute, "pub:start:"+prefix, sessionsPerIPPerMinute); err != nil {
		return Session{}, t, "", err
	}
	if err := s.Captcha.Verify(ctx, in.CaptchaToken, in.ClientIP); errors.Is(err, captcha.ErrFailed) {
		return Session{}, t, "", errCaptchaFail
	} else if err != nil {
		s.Log.Warn("captcha verification failed", "err", err)
		return Session{}, t, "", errCaptchaError
	}
	token := httpx.NewID(32)
	ua := sha256.Sum256([]byte(in.UserAgent))
	sess, err := s.q.InsertAnonSession(ctx, dbgen.InsertAnonSessionParams{
		TokenDigest: digest(token), AgentID: in.AgentID, Channel: channel, PublishableKeyID: keyID,
		IPPrefix: prefix, UserAgentHash: hex.EncodeToString(ua[:16]), ExpiresAt: time.Now().Add(s.SessionTTL),
	})
	return sess, t, token, err
}

// originsAllowed: every origin the request reveals must be allowed, and a
// widget session must reveal at least one.
func originsAllowed(origin, embed string, allowed []string) bool {
	if origin == "" && embed == "" {
		return false
	}
	for _, o := range []string{origin, embed} {
		if o != "" && !MatchOrigin(o, allowed) {
			return false
		}
	}
	return true
}

// Resume loads the session behind a cookie for an agent and extends it.
func (s *Service) Resume(ctx context.Context, token string, agentID uuid.UUID) (Session, error) {
	if token == "" || len(token) > 256 {
		return Session{}, errNoSession
	}
	sess, err := s.q.GetAnonSession(ctx, digest(token))
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && sess.AgentID != agentID) {
		return Session{}, apperr.New(401, "session_expired", "Your session has ended. Start a new chat.")
	} else if err != nil {
		return Session{}, err
	}
	if time.Since(sess.LastSeenAt) > time.Minute {
		sess.ExpiresAt = time.Now().Add(s.SessionTTL)
		if err := s.q.TouchAnonSession(ctx, dbgen.TouchAnonSessionParams{ID: sess.ID, ExpiresAt: sess.ExpiresAt}); err != nil {
			return Session{}, err
		}
	}
	return sess, nil
}

// ChatRequest is an anonymous question.
type ChatRequest struct {
	Message         string
	NewConversation bool
}

// Chat answers an anonymous question after the guardrails: the message
// length, the widget key (still enabled), then the rate limits, daily caps
// and concurrency.
func (s *Service) Chat(ctx context.Context, sess Session, req ChatRequest, emit func(agents.Event)) (agents.Answer, error) {
	t, err := s.Agents.PublicProfile(ctx, sess.AgentID.String())
	if err != nil {
		return agents.Answer{}, err
	}
	set, err := s.Limits.Effective(ctx, nil, t.TeamID)
	if err != nil {
		return agents.Answer{}, err
	}
	if max := set.Get(limits.PublicMessageMaxChars); max != nil && int64(utf8.RuneCountInString(req.Message)) > *max {
		return agents.Answer{}, &apperr.Error{Status: 400, Code: "message_too_long",
			Message: "Your message is too long. Keep it under " + strconv.FormatInt(*max, 10) + " characters.", Details: map[string]any{"max": *max}}
	}
	adm := Admission{AgentID: sess.AgentID, IPPrefix: sess.IPPrefix, SessionID: sess.ID, Limits: set,
		Usage: func(ctx context.Context) (int64, int64, error) {
			u, err := s.q.AgentPublicUsageSince(ctx, dbgen.AgentPublicUsageSinceParams{AgentID: uuid.NullUUID{UUID: sess.AgentID, Valid: true}, Since: limits.StartOfDay(time.Now())})
			return u.Queries, u.Tokens, err
		}}
	if sess.PublishableKeyID.Valid {
		k, err := s.q.GetPublishableKey(ctx, sess.PublishableKeyID.UUID)
		if err != nil || !k.Enabled {
			return agents.Answer{}, errKey
		}
		_ = json.Unmarshal(k.RateLimits, &adm.Key)
	} else if sess.Channel == agents.ChannelWidget {
		return agents.Answer{}, errKey // the key was deleted
	}
	release, err := s.Guard.Admit(ctx, adm)
	if err != nil {
		return agents.Answer{}, err
	}
	defer release()
	caller := agents.AnonCaller{SessionID: sess.ID, Channel: sess.Channel}
	if sess.ConversationID.Valid {
		id := sess.ConversationID.UUID
		caller.ConversationID = &id
	}
	return s.Agents.PublicChat(ctx, caller, sess.AgentID, req.Message, req.NewConversation, emit)
}

// Current is the session's current conversation (nil when none).
func (s *Service) Current(ctx context.Context, sess Session) (*agents.ConversationView, error) {
	var id *uuid.UUID
	if sess.ConversationID.Valid {
		v := sess.ConversationID.UUID
		id = &v
	}
	return s.Agents.PublicConversation(ctx, sess.ID, id)
}

// WidgetCheck is what widget.js asks before showing its launcher
// (docs/ui-review F-09): whether the key works for the agent on the page's
// origin and the agent is live. A refusal is an apperr (the code tells the
// site owner why); it reveals nothing about the key's other origins.
func (s *Service) WidgetCheck(ctx context.Context, rawKey string, agentID uuid.UUID, origin string) (agents.PublicTarget, error) {
	t, err := s.Agents.PublicProfile(ctx, agentID.String())
	if err != nil {
		return t, err
	}
	if t.Agent.Status != agents.StatusActive {
		return t, errDisabled
	}
	k, err := s.checkKey(ctx, rawKey, agentID)
	if err != nil {
		return t, err
	}
	if origin == "" || !MatchOrigin(origin, k.AllowedOrigins) {
		return t, errOrigin
	}
	return t, nil
}
