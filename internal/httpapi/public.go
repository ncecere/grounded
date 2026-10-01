// The anonymous public API (docs/phase4-publishing.md §5-§7): public agent
// profiles, anonymous sessions and chat. Nothing else is served
// anonymously.

package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/public"
)

// publicRoutes: the anonymous API, the widget loader and the embed page.
func (a *api) publicRoutes() []route {
	return []route{
		{"GET", "/widget.js", http.HandlerFunc(a.widgetScript)},
		{"GET", "/embed/{agentId}", http.HandlerFunc(a.embedPage)},
		{"GET", "/v1/public/agents/{agentRef}", a.anonymous(a.getPublicAgent)},
		{"GET", "/v1/public/teams/{team}/agents/{agent}", a.anonymous(a.getPublicAgentByTeam)},
		{"GET", "/v1/public/agents/{agentId}/widget-check", a.anonymous(a.widgetCheck)},
		{"POST", "/v1/public/sessions", a.anonymous(a.createPublicSession)},
		{"GET", "/v1/public/sessions/current", a.anonymous(a.getPublicSession)},
		{"POST", "/v1/public/agents/{agentId}/chat", a.anonymous(a.publicChat)},
		{"GET", "/v1/public/agents/{agentId}/messages/{messageId}/sources/{n}", a.anonymous(a.getPublicCitedPassage)},
	}
}

// anonymous guards the public API: no credentials, and browser writes only
// from Grounded's own pages (the public page and the embed page are served by
// Grounded, so no CORS is needed; docs/phase4-publishing.md §2 decision 5).
func (a *api) anonymous(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			httpx.Error(w, http.StatusBadRequest, "credentials_not_accepted", "The public API takes no credentials")
			return
		}
		if r.Method != http.MethodGet && !a.sameOrigin(r) {
			httpx.Error(w, http.StatusForbidden, "origin_not_allowed", "Cross-site requests are not accepted")
			return
		}
		if a.Public == nil {
			httpx.Fail(w, r, agents.ErrPublicDisabled())
			return
		}
		h(w, r)
	})
}

// sameOrigin reports a request without an Origin (non-browser) or from
// APP_URL (or the Vite dev server with dev auth).
func (a *api) sameOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" || o == a.Config.AppURL {
		return true
	}
	return a.Config.DevAuth && (o == "http://localhost:5173" || o == "http://127.0.0.1:5173")
}

func (a *api) getPublicAgent(w http.ResponseWriter, r *http.Request) {
	a.writePublicAgent(w, r, r.PathValue("agentRef"))
}

// getPublicAgentByTeam serves the profile at the agent's team address, so
// /a/{team}/{agent} shows signed-out visitors the public page (F-07).
func (a *api) getPublicAgentByTeam(w http.ResponseWriter, r *http.Request) {
	team, agent := r.PathValue("team"), r.PathValue("agent")
	if strings.Contains(team, "/") || strings.Contains(agent, "/") {
		httpx.Error(w, http.StatusNotFound, "agent_not_found", "Agent not found")
		return
	}
	a.writePublicAgent(w, r, team+"/"+agent)
}

func (a *api) writePublicAgent(w http.ResponseWriter, r *http.Request, ref string) {
	// The widget loader reads the name and accent from other sites; the
	// profile is public and sent without credentials.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	t, err := a.Agents.PublicProfile(r.Context(), ref)
	if failed(w, r, err) {
		return
	}
	ag := t.Agent
	out := apitypes.PublicAgent{
		Id: ag.ID, Name: ag.Name, TeamName: t.TeamName, Description: ag.Description, AccentColor: ag.AccentColor,
		WelcomeMessage: ag.WelcomeMessage, StarterQuestions: nonNilStrings(ag.StarterQuestions),
		CitationMode: apitypes.CitationMode(t.CitationMode), Status: apitypes.AgentStatus(ag.Status), ShortName: t.ShortName,
		Captcha:         apitypes.CaptchaInfo{Provider: apitypes.CaptchaInfoProvider(a.Public.Captcha.Provider()), SiteKey: a.Public.Captcha.SiteKey()},
		MaxMessageChars: a.publicMessageLimit(r.Context(), t.TeamID),
	}
	httpx.JSON(w, http.StatusOK, out)
}

// publicMessageLimit is the longest message anonymous visitors of a team's
// public agents may send: the chat limit, or the team's public limit if
// lower.
func (a *api) publicMessageLimit(ctx context.Context, teamID uuid.UUID) int {
	n := agents.MaxMessageChars
	if set, err := a.Limits.Effective(ctx, nil, teamID); err == nil {
		if m := set.Get(limits.PublicMessageMaxChars); m != nil && *m < int64(n) {
			n = int(*m)
		}
	}
	return n
}

// anonCookie names an agent's anonymous session cookie: one per agent, so
// a visitor of two public agents keeps both sessions.
func anonCookie(agentID uuid.UUID) string {
	return "grounded_anon_" + strings.ReplaceAll(agentID.String(), "-", "")
}

// setAnonCookie sets the session cookie: SameSite=None; Secure; Partitioned
// for the widget's third-party iframe on HTTPS, Lax otherwise.
func (a *api) setAnonCookie(w http.ResponseWriter, sess public.Session, token string) {
	secure := a.Config.SecureCookies()
	c := &http.Cookie{Name: anonCookie(sess.AgentID), Value: token, Path: "/v1/public", HttpOnly: true, Secure: secure,
		MaxAge: int(a.Public.SessionTTL.Seconds()), SameSite: http.SameSiteLaxMode}
	if sess.Channel == agents.ChannelWidget && secure {
		c.SameSite, c.Partitioned = http.SameSiteNoneMode, true
	}
	http.SetCookie(w, c)
}

func toAPIPublicSession(s public.Session) apitypes.PublicSession {
	return apitypes.PublicSession{AgentId: s.AgentID, Channel: apitypes.PublicSessionChannel(s.Channel), ExpiresAt: s.ExpiresAt}
}

func (a *api) createPublicSession(w http.ResponseWriter, r *http.Request) {
	var in apitypes.PublicSessionCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	req := public.StartRequest{AgentID: in.AgentId, CaptchaToken: deref(in.CaptchaToken, ""), Key: strings.TrimSpace(deref(in.Key, "")),
		EmbedOrigin: strings.TrimSpace(deref(in.EmbedOrigin, "")), ClientIP: httpx.ClientIP(r, a.Config.TrustedProxies), UserAgent: r.UserAgent()}
	if o := r.Header.Get("Origin"); o != "" && o != a.Config.AppURL {
		req.Origin = o
	}
	sess, _, token, err := a.Public.Start(r.Context(), req)
	if failed(w, r, err) {
		return
	}
	a.setAnonCookie(w, sess, token)
	httpx.JSON(w, http.StatusCreated, toAPIPublicSession(sess))
}

// resume loads the caller's session for an agent from its cookie and
// refreshes the cookie.
func (a *api) resume(w http.ResponseWriter, r *http.Request, agentID uuid.UUID) (public.Session, bool) {
	token := ""
	if c, err := r.Cookie(anonCookie(agentID)); err == nil {
		token = c.Value
	}
	sess, err := a.Public.Resume(r.Context(), token, agentID)
	if failed(w, r, err) {
		return sess, false
	}
	a.setAnonCookie(w, sess, token)
	return sess, true
}

func (a *api) getPublicSession(w http.ResponseWriter, r *http.Request) {
	agentID, err := uuid.Parse(r.URL.Query().Get("agentId"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_id", "Invalid agentId")
		return
	}
	if _, err := a.Agents.PublicProfile(r.Context(), agentID.String()); failed(w, r, err) {
		return
	}
	sess, ok := a.resume(w, r, agentID)
	if !ok {
		return
	}
	v, err := a.Public.Current(r.Context(), sess)
	if failed(w, r, err) {
		return
	}
	out := apitypes.PublicSessionState{Session: toAPIPublicSession(sess)}
	if v != nil {
		d := toAPIConversationDetail(*v)
		out.Conversation = &d
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) publicChat(w http.ResponseWriter, r *http.Request) {
	agentID, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	var in apitypes.PublicChatRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	if _, err := a.Agents.PublicProfile(r.Context(), agentID.String()); failed(w, r, err) {
		return
	}
	sess, ok := a.resume(w, r, agentID)
	if !ok {
		return
	}
	req := public.ChatRequest{Message: in.Message, NewConversation: deref(in.NewConversation, false)}
	a.runChat(w, r, in.Stream == nil || *in.Stream, func(ctx context.Context, emit func(agents.Event)) (agents.Answer, error) {
		return a.Public.Chat(ctx, sess, req, emit)
	})
}

// errPublicUnavailable is the embed page's error when the public service
// is not configured.
var errPublicUnavailable = apperr.New(http.StatusServiceUnavailable, "public_disabled", "Public agents are turned off on this platform right now.")

// widgetCheck tells widget.js whether to show its launcher on the page
// that loaded it (F-09): always 200 (so any site can read it, without
// credentials), with allowed false and the reason otherwise. The origin is
// the request's Origin header, or ?origin= when the browser sent none.
func (a *api) widgetCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-store")
	id, err := uuid.Parse(r.PathValue("agentId"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "agent_not_found", "Agent not found")
		return
	}
	origin := r.Header.Get("Origin")
	if origin == "" || origin == "null" {
		origin = r.URL.Query().Get("origin")
	}
	out := apitypes.WidgetCheck{Allowed: false}
	if a.Public == nil {
		code, msg := "public_disabled", "Public agents are unavailable."
		out.Code, out.Message = &code, &msg
		httpx.JSON(w, http.StatusOK, out)
		return
	}
	t, err := a.Public.WidgetCheck(r.Context(), r.URL.Query().Get("key"), id, origin)
	if e, ok := apperr.As(err); ok {
		out.Code, out.Message = &e.Code, &e.Message
	} else if err != nil {
		httpx.Internal(w, r, err)
		return
	} else {
		out.Allowed = true
	}
	if t.Agent.ID != uuid.Nil {
		out.Name, out.AccentColor = &t.Agent.Name, &t.Agent.AccentColor
	}
	httpx.JSON(w, http.StatusOK, out)
}
