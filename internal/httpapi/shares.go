package httpapi

import (
	"net/http"
	"strings"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// Sharing a conversation (v0.6.0, C12; ADR-0010 amendment; docs/specs/v0.6.0/DESIGN.md §3). The owner makes, lists and revokes links with
// a signed-in session (never an API key); whoever the share is for opens it, signed in or, for a link open to anyone, not.

func (a *api) shareRoutes() []route {
	return []route{
		{"GET", "/v1/conversations/{conversationId}/shares", a.session(a.listConversationShares)},
		{"POST", "/v1/conversations/{conversationId}/shares", a.session(a.createConversationShare)},
		{"DELETE", "/v1/conversations/{conversationId}/shares/{shareId}", a.session(a.revokeConversationShare)},
		{"GET", "/v1/shared/{token}", a.shared(a.getSharedConversation)},
		{"GET", "/v1/shared/{token}/messages/{messageId}/sources/{n}", a.shared(a.getSharedCitedPassage)},
	}
}

// shared serves a shared conversation to a signed-in session or to no one: a request with credentials of another kind (an API key) is refused,
// and the response is never cached or sent on as a referrer, because the address holds the link's secret.
func (a *api) shared(h http.HandlerFunc) http.Handler {
	withSession := a.session(h)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hd := w.Header()
		hd.Set("Cache-Control", "no-store")
		hd.Set("Referrer-Policy", "no-referrer")
		hd.Set("X-Robots-Tag", "noindex, nofollow")
		if r.Header.Get("Authorization") != "" {
			httpx.Error(w, http.StatusBadRequest, "credentials_not_accepted", "Shared conversations take a signed-in session, not an API key")
			return
		}
		if !a.Auth.HasSessionCookie(r) {
			h(w, r)
			return
		}
		withSession.ServeHTTP(w, r)
	})
}

func toAPIShare(s agents.Share) apitypes.ConversationShare {
	return apitypes.ConversationShare{Id: s.ID, Audience: apitypes.ShareAudience(s.Audience), ShowName: s.ShowName, UpToSeq: int(s.UpToSeq),
		MessageCount: s.MessageCount, CreatedAt: s.CreatedAt}
}

func (a *api) listConversationShares(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "conversationId")
	if !ok {
		return
	}
	list, err := a.Agents.ListShares(r.Context(), a.actor(r), id)
	writeList(w, r, list, err, toAPIShare)
}

func (a *api) createConversationShare(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "conversationId")
	if !ok {
		return
	}
	var in apitypes.ConversationShareCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	made, err := a.Agents.CreateShare(r.Context(), a.actor(r), id, agents.ShareInput{Audience: string(in.Audience), ShowName: deref(in.ShowName, false)})
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, apitypes.ConversationShareCreated{
		Share: toAPIShare(made.Share), Token: made.Token, Url: strings.TrimRight(a.Config.AppURL, "/") + "/shared/" + made.Token,
	})
}

func (a *api) revokeConversationShare(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "conversationId")
	if !ok {
		return
	}
	shareID, ok := pathUUID(w, r, "shareId")
	if !ok {
		return
	}
	writeOK(w, r, a.Agents.RevokeShare(r.Context(), a.actor(r), id, shareID))
}

func toAPISharedConversation(c agents.SharedConversation) apitypes.SharedConversation {
	out := apitypes.SharedConversation{
		Title: c.Title, SharedBy: c.SharedBy, SharedAt: c.SharedAt, Audience: apitypes.ShareAudience(c.Audience), Owner: c.Owner,
		Messages: make([]apitypes.SharedMessage, len(c.Messages)),
	}
	out.Agent.Name, out.Agent.Slug, out.Agent.TeamSlug = c.AgentName, c.AgentSlug, c.TeamSlug
	out.Agent.Description, out.Agent.AccentColor = c.AgentDescription, c.AccentColor
	for i, m := range c.Messages {
		out.Messages[i] = viaJSON[apitypes.SharedMessage](m)
	}
	return out
}

func (a *api) getSharedConversation(w http.ResponseWriter, r *http.Request) {
	c, err := a.Agents.ViewShare(r.Context(), a.actor(r), r.PathValue("token"))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPISharedConversation(c))
}

func (a *api) getSharedCitedPassage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "messageId")
	if !ok {
		return
	}
	n, ok := citationNumber(w, r)
	if !ok {
		return
	}
	p, err := a.Agents.SharedCitedPassage(r.Context(), a.actor(r), r.PathValue("token"), id, n)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPICitedPassage(p))
}
