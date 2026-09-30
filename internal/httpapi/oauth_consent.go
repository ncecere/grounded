// OAuth sign-in for MCP clients, the /v1 side (api/openapi.yaml, tag
// oauth): the consent page's view of an authorization request and its
// decision, and a person's connected apps (theirs, or anyone's for platform
// admins and auditors).

package httpapi

import (
	"errors"
	"net/http"
	"net/url"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/oauth"
)

// oauthRESTRoutes: the consent page and connected apps.
func (a *api) oauthRESTRoutes() []route {
	return []route{
		{"GET", "/v1/oauth/consent", a.session(a.getOAuthConsent)},
		{"POST", "/v1/oauth/consent", a.session(a.decideOAuthConsent)},
		{"GET", "/v1/me/oauth-grants", a.session(a.grants(a.listMyOAuthGrants))},
		{"DELETE", "/v1/me/oauth-grants/{grantId}", a.session(a.grants(a.revokeMyOAuthGrant))},
		{"GET", "/v1/admin/users/{userId}/oauth-grants", a.admin(a.grants(a.adminListUserOAuthGrants))},
		{"DELETE", "/v1/admin/users/{userId}/oauth-grants/{grantId}", a.admin(a.grants(a.adminRevokeUserOAuthGrant))},
	}
}

// grants serves connected apps whether or not OAuth sign-in is on (so they
// can always be disconnected); only an install without an API-key pepper,
// which has no authorization server, answers 404.
func (a *api) grants(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.OAuth == nil {
			httpx.Error(w, http.StatusNotFound, "not_found", "Not found")
			return
		}
		h(w, r)
	}
}

// consentOn answers 404 while OAuth sign-in is off.
func (a *api) consentOn(w http.ResponseWriter, r *http.Request) bool {
	if !a.oauthOn(r.Context()) {
		httpx.Error(w, http.StatusNotFound, "oauth_off", "OAuth sign-in for MCP clients is off.")
		return false
	}
	return true
}

// checkConsent reads and checks an authorization request for the consent
// page. Every problem is a 400 with the reason: the page shows it and
// never sends the browser anywhere.
func (a *api) checkConsent(w http.ResponseWriter, r *http.Request, q url.Values) (oauth.Client, oauth.AuthorizeRequest, bool) {
	req, err := oauth.RequestFromQuery(q)
	var c oauth.Client
	if err == nil {
		c, err = a.OAuth.Check(r.Context(), req)
	}
	var oe *oauth.Error
	if errors.As(err, &oe) {
		httpx.Error(w, http.StatusBadRequest, "oauth_"+oe.Code, oe.Description)
		return c, req, false
	}
	return c, req, !failed(w, r, err)
}

func (a *api) getOAuthConsent(w http.ResponseWriter, r *http.Request) {
	if !a.consentOn(w, r) {
		return
	}
	c, req, ok := a.checkConsent(w, r, r.URL.Query())
	if !ok {
		return
	}
	remembered, err := a.OAuth.Remembered(r.Context(), a.actor(r).UserID, c.ID)
	if failed(w, r, err) {
		return
	}
	redirect, _ := url.Parse(req.RedirectURI)
	httpx.JSON(w, http.StatusOK, apitypes.OAuthConsent{
		Client: apitypes.OAuthClientInfo{
			Id: c.ID, Kind: apitypes.OAuthClientInfoKind(c.Kind), Name: c.Name, Host: c.Host(),
			Uri: nilIfEmpty(c.URI), LogoUrl: nilIfEmpty(c.LogoURI),
		},
		RedirectUri: req.RedirectURI, RedirectHost: redirect.Host, Remembered: remembered,
	})
}

func (a *api) decideOAuthConsent(w http.ResponseWriter, r *http.Request) {
	if !a.consentOn(w, r) {
		return
	}
	var in apitypes.OAuthConsentDecision
	if !httpx.Decode(w, r, &in) {
		return
	}
	q, err := url.ParseQuery(in.Query)
	if err != nil || len(in.Query) > 8000 || !in.Decision.Valid() {
		httpx.Error(w, http.StatusBadRequest, "invalid_request", "Send the authorization request's query and allow or deny.")
		return
	}
	c, req, ok := a.checkConsent(w, r, q)
	if !ok {
		return
	}
	to := a.OAuth.DenyRedirect(req)
	if in.Decision == apitypes.OAuthConsentDecisionDecisionAllow {
		if to, err = a.OAuth.Approve(r.Context(), a.actor(r), c, req); failed(w, r, err) {
			return
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"redirectUrl": to})
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func toAPIOAuthGrant(g oauth.Grant) apitypes.OAuthGrant {
	host := ""
	if g.ClientUri != nil {
		if u, err := url.Parse(*g.ClientUri); err == nil {
			host = u.Host
		}
	}
	return apitypes.OAuthGrant{Id: g.ID, ClientId: g.ClientID, ClientKind: apitypes.OAuthGrantClientKind(g.ClientKind), ClientName: g.ClientName,
		ClientHost: host, CreatedAt: g.CreatedAt, LastUsedAt: g.LastUsedAt}
}

func (a *api) listMyOAuthGrants(w http.ResponseWriter, r *http.Request) {
	grants, err := a.OAuth.ListGrants(r.Context(), a.actor(r), a.actor(r).UserID)
	writeList(w, r, grants, err, toAPIOAuthGrant)
}

func (a *api) revokeMyOAuthGrant(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "grantId")
	if !ok {
		return
	}
	writeOK(w, r, a.OAuth.RevokeGrant(r.Context(), a.actor(r), a.actor(r).UserID, id))
}

func (a *api) adminListUserOAuthGrants(w http.ResponseWriter, r *http.Request) {
	userID, ok := pathUUID(w, r, "userId")
	if !ok {
		return
	}
	grants, err := a.OAuth.ListGrants(r.Context(), a.actor(r), userID)
	writeList(w, r, grants, err, toAPIOAuthGrant)
}

func (a *api) adminRevokeUserOAuthGrant(w http.ResponseWriter, r *http.Request) {
	userID, ok := pathUUID(w, r, "userId")
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "grantId")
	if !ok {
		return
	}
	writeOK(w, r, a.OAuth.RevokeGrant(r.Context(), a.actor(r), userID, id))
}
