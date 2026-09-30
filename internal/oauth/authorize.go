package oauth

import (
	"context"
	"errors"
	"net/url"
	"regexp"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// AuthorizeRequest is an authorization request (RFC 6749 §4.1.1 with PKCE,
// RFC 7636, and a resource indicator, RFC 8707).
type AuthorizeRequest struct {
	ClientID            string
	RedirectURI         string
	ResponseType        string
	CodeChallenge       string
	CodeChallengeMethod string
	Resource            string
	State               string
	Scope               string
}

// maxStateLen bounds state (echoed back to the client).
const maxStateLen = 1000

// pkceChallenge is an S256 challenge: base64url of a SHA-256, unpadded.
var pkceChallenge = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// RequestFromQuery reads an authorization request from a query string.
// A parameter given twice is refused (RFC 6749 §3.1), before anything is
// known about the client, so as a page.
func RequestFromQuery(q url.Values) (AuthorizeRequest, error) {
	for k, v := range q {
		if len(v) > 1 {
			return AuthorizeRequest{}, pageError("invalid_request", "The request repeats the "+k+" parameter.")
		}
	}
	return AuthorizeRequest{
		ClientID: q.Get("client_id"), RedirectURI: q.Get("redirect_uri"), ResponseType: q.Get("response_type"),
		CodeChallenge: q.Get("code_challenge"), CodeChallengeMethod: q.Get("code_challenge_method"),
		Resource: q.Get("resource"), State: q.Get("state"), Scope: q.Get("scope"),
	}, nil
}

// Check validates a request. The client and its redirect URI come first:
// until both are known to be good an error is shown as a page (ShowPage),
// never sent anywhere, so the endpoint can't be an open redirect. Other
// errors go back to the client's redirect URI.
func (s *Service) Check(ctx context.Context, r AuthorizeRequest) (Client, error) {
	c, err := s.ResolveClient(ctx, r.ClientID)
	if err != nil {
		return Client{}, err
	}
	if r.RedirectURI == "" {
		return Client{}, pageError("invalid_request", "The request has no redirect_uri.")
	}
	if !matchRedirect(c.RedirectURIs, r.RedirectURI) {
		return Client{}, pageError("invalid_request", "The redirect_uri isn't one the client registered.")
	}
	if len(r.State) > maxStateLen {
		return Client{}, pageError("invalid_request", "The state parameter is too long.")
	}
	switch {
	case r.ResponseType != "code":
		return c, oauthError("unsupported_response_type", "Only response_type=code is supported.")
	case r.CodeChallenge == "":
		return c, oauthError("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.")
	case r.CodeChallengeMethod != "S256":
		return c, oauthError("invalid_request", "Only the S256 code_challenge_method is supported.")
	case !pkceChallenge.MatchString(r.CodeChallenge):
		return c, oauthError("invalid_request", "The code_challenge isn't an S256 challenge.")
	case r.Resource == "":
		return c, oauthError("invalid_target", "The resource parameter is required: "+s.resource)
	case r.Resource != s.resource:
		return c, oauthError("invalid_target", "The only resource is "+s.resource)
	}
	return c, nil
}

// redirect is the redirect URI with params, the state and the issuer (RFC
// 9207). Call it only for a request that passed the page checks.
func (s *Service) redirect(r AuthorizeRequest, params url.Values) string {
	u, err := url.Parse(r.RedirectURI)
	if err != nil {
		return ""
	}
	q := u.Query()
	for k, v := range params {
		q[k] = v
	}
	if r.State != "" {
		q.Set("state", r.State)
	}
	q.Set("iss", s.issuer)
	u.RawQuery = q.Encode()
	return u.String()
}

// ErrorRedirect is where to send an error that isn't shown as a page.
func (s *Service) ErrorRedirect(r AuthorizeRequest, e *Error) string {
	return s.redirect(r, url.Values{"error": {e.Code}, "error_description": {e.Description}})
}

// DenyRedirect is where to send the person who said no.
func (s *Service) DenyRedirect(r AuthorizeRequest) string {
	return s.ErrorRedirect(r, oauthError("access_denied", "The person declined."))
}

// Remembered reports whether the person has already allowed the client
// (an active grant), so the consent page can be skipped.
func (s *Service) Remembered(ctx context.Context, userID uuid.UUID, clientID string) (bool, error) {
	_, err := s.q.GetActiveOAuthGrant(ctx, dbgen.GetActiveOAuthGrantParams{UserID: userID, ClientID: clientID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return false, nil
	}
	return err == nil, err
}

// Approve records the person's consent for a checked request's client (a
// grant, audited as oauth.consent the first time) and returns the redirect
// with a new authorization code: single use, CodeTTL, bound to the grant,
// client, redirect URI, PKCE challenge and resource.
func (s *Service) Approve(ctx context.Context, a authz.Actor, c Client, r AuthorizeRequest) (string, error) {
	code := newToken(codePrefix)
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		g, err := s.grantFor(ctx, q, a, c)
		if err != nil {
			return err
		}
		if err := q.DeleteExpiredOAuthCodes(ctx); err != nil {
			return err
		}
		if c.Kind == KindRegistered {
			if err := q.TouchOAuthClient(ctx, c.ID); err != nil {
				return err
			}
		}
		return q.InsertOAuthCode(ctx, dbgen.InsertOAuthCodeParams{
			CodeHash: digest(code, s.peppers.Current), GrantID: g.ID, ClientID: c.ID, RedirectUri: r.RedirectURI,
			CodeChallenge: r.CodeChallenge, Resource: r.Resource, ExpiresAt: s.now().Add(CodeTTL),
		})
	})
	if err != nil {
		return "", err
	}
	return s.redirect(r, url.Values{"code": {code}}), nil
}

// grantFor returns the person's active grant for the client, creating it
// (and auditing the consent) when there is none.
func (s *Service) grantFor(ctx context.Context, q *dbgen.Queries, a authz.Actor, c Client) (dbgen.OauthGrant, error) {
	g, err := q.GetActiveOAuthGrant(ctx, dbgen.GetActiveOAuthGrantParams{UserID: a.UserID, ClientID: c.ID})
	if err == nil || !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return g, err
	}
	g, err = q.InsertOAuthGrant(ctx, dbgen.InsertOAuthGrantParams{
		UserID: a.UserID, ClientID: c.ID, ClientKind: c.Kind, ClientName: c.Name, ClientUri: ptr(clientPage(c)), Resource: s.resource,
	})
	if err != nil {
		return g, err
	}
	e := a.Audit("oauth.consent", "oauth_grant", g.ID.String())
	e.After = grantSnapshot(g)
	return g, audit.Record(ctx, q, e)
}

// clientPage is the address kept with a grant: the metadata document's URL,
// or a registered client's home page.
func clientPage(c Client) string {
	if c.Kind == KindMetadata {
		return c.ID
	}
	return c.URI
}

func grantSnapshot(g dbgen.OauthGrant) map[string]any {
	return map[string]any{"clientId": g.ClientID, "clientKind": g.ClientKind, "clientName": g.ClientName, "clientUri": g.ClientUri,
		"resource": g.Resource, "scopes": g.Scopes, "userId": g.UserID}
}
