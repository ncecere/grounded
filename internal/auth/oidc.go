package auth

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/ncecere/grounded/internal/httpx"
)

const (
	stateCookie   = "grounded_oidc_state"
	loginStateTTL = 10 * time.Minute
	maxClaimsSize = 32 << 10
)

type oidcClient struct {
	oauth    *oauth2.Config
	verifier *oidc.IDTokenVerifier
}

type loginState struct {
	Verifier string `json:"verifier"`
	Nonce    string `json:"nonce"`
	Next     string `json:"next"`
}

// client performs OIDC discovery on first use and caches the result. Failed
// discovery is retried on the next sign-in rather than blocking startup.
func (s *Service) client(ctx context.Context) (*oidcClient, error) {
	s.oidcMu.Lock()
	defer s.oidcMu.Unlock()
	if s.oidc != nil {
		return s.oidc, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	provider, err := oidc.NewProvider(ctx, s.cfg.OIDC.Issuer)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery: %w", err)
	}
	s.oidc = &oidcClient{
		verifier: provider.Verifier(&oidc.Config{ClientID: s.cfg.OIDC.ClientID}),
		oauth: &oauth2.Config{
			ClientID:     s.cfg.OIDC.ClientID,
			ClientSecret: s.cfg.OIDC.ClientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  s.cfg.AppURL + "/auth/callback",
			Scopes:       s.cfg.OIDC.Scopes,
		},
	}
	return s.oidc, nil
}

// Login starts the authorization-code flow with PKCE, state and nonce.
func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.OIDC.Enabled() {
		httpx.Error(w, http.StatusNotFound, "oidc_disabled", "Single sign-on is not configured")
		return
	}
	if !s.admitLogin(w, r) {
		return
	}
	c, err := s.client(r.Context())
	if err != nil {
		s.log.ErrorContext(r.Context(), "oidc discovery failed", "err", err)
		httpx.Error(w, http.StatusServiceUnavailable, "idp_unavailable", "The sign-in provider is unavailable. Try again shortly.")
		return
	}
	state, nonce, verifier := httpx.NewID(32), httpx.NewID(32), oauth2.GenerateVerifier()
	saved, _ := json.Marshal(loginState{Verifier: verifier, Nonce: nonce, Next: safeNext(r.URL.Query().Get("next"))})
	if err := s.kv.Client.Set(r.Context(), s.kv.Key("login", digest(state)), saved, loginStateTTL).Err(); err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, "login_unavailable", "Sign-in is temporarily unavailable")
		return
	}
	s.setCookie(w, stateCookie, state, int(loginStateTTL.Seconds()))
	http.Redirect(w, r, c.oauth.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier), oidc.Nonce(nonce)), http.StatusFound)
}

// Callback completes the authorization-code flow.
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.OIDC.Enabled() {
		httpx.Error(w, http.StatusNotFound, "oidc_disabled", "Single sign-on is not configured")
		return
	}
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie(stateCookie)
	if err != nil || len(state) < 32 || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
		httpx.Error(w, http.StatusBadRequest, "invalid_state", "Sign-in expired or was started in another browser. Try again.")
		return
	}
	s.setCookie(w, stateCookie, "", -1)
	raw, err := s.kv.Client.GetDel(r.Context(), s.kv.Key("login", digest(state))).Bytes()
	var saved loginState
	if err != nil || json.Unmarshal(raw, &saved) != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_state", "Sign-in expired. Try again.")
		return
	}
	if r.URL.Query().Get("error") != "" {
		httpx.Error(w, http.StatusUnauthorized, "login_declined", "The sign-in provider declined the request")
		return
	}
	c, err := s.client(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusServiceUnavailable, "idp_unavailable", "The sign-in provider is unavailable. Try again shortly.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	token, err := c.oauth.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(saved.Verifier))
	if err != nil {
		s.log.WarnContext(ctx, "oidc code exchange failed", "err", err)
		httpx.Error(w, http.StatusUnauthorized, "login_failed", "Could not complete sign-in")
		return
	}
	rawID, ok := token.Extra("id_token").(string)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "login_failed", "The sign-in provider did not return an ID token")
		return
	}
	idToken, err := c.verifier.Verify(ctx, rawID)
	if err != nil || subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(saved.Nonce)) != 1 {
		httpx.Error(w, http.StatusUnauthorized, "login_failed", "Invalid identity token")
		return
	}
	var claims map[string]any
	if err := idToken.Claims(&claims); err != nil {
		httpx.Error(w, http.StatusUnauthorized, "login_failed", "Invalid identity token claims")
		return
	}
	email, name, problem := s.extractProfile(claims)
	if problem != "" {
		httpx.Error(w, http.StatusForbidden, "email_required", problem)
		return
	}
	if !s.emailDomainAllowed(email) {
		httpx.Error(w, http.StatusForbidden, "domain_denied", "This account's email domain is not permitted")
		return
	}
	li := loginIdentity{
		Issuer: idToken.Issuer, Subject: idToken.Subject, Email: email, Name: name,
		Claims: boundedClaims(claims), Method: "oidc", EmailVerified: truthy(claims["email_verified"]),
	}
	if s.cfg.OIDC.BootstrapAdminSubject != "" && idToken.Subject == s.cfg.OIDC.BootstrapAdminSubject {
		li.BootstrapRole = RolePlatformAdmin
	}
	if _, err := s.completeLogin(ctx, w, r, li); err != nil {
		if errors.Is(err, errSuspended) {
			httpx.Error(w, http.StatusForbidden, "user_suspended", "This account is suspended")
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	http.Redirect(w, r, saved.Next, http.StatusSeeOther)
}

// extractProfile returns the email and display name, or a user-facing
// problem message when the claims are unacceptable.
func (s *Service) extractProfile(claims map[string]any) (email, name, problem string) {
	email, _ = claims[s.cfg.OIDC.EmailClaim].(string)
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !strings.Contains(email, "@") {
		return "", "", "Your sign-in provider did not supply an email address"
	}
	if s.cfg.OIDC.RequireVerifiedEmail && !truthy(claims["email_verified"]) {
		return "", "", "A verified email address is required"
	}
	name, _ = claims["name"].(string)
	if name == "" {
		given, _ := claims["given_name"].(string)
		family, _ := claims["family_name"].(string)
		name = strings.TrimSpace(given + " " + family)
	}
	if name == "" {
		name = email
	}
	return email, name, ""
}

func (s *Service) emailDomainAllowed(email string) bool {
	if len(s.cfg.OIDC.AllowedEmailDomains) == 0 {
		return true
	}
	domain := email[strings.LastIndex(email, "@")+1:]
	for _, d := range s.cfg.OIDC.AllowedEmailDomains {
		if domain == d {
			return true
		}
	}
	return false
}

// truthy accepts the boolean or string forms providers use for email_verified.
func truthy(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(t, "true")
	}
	return false
}

// boundedClaims stores all claims unless they are unusually large, in which
// case oversized values are dropped rather than failing the sign-in.
func boundedClaims(claims map[string]any) json.RawMessage {
	b, err := json.Marshal(claims)
	if err == nil && len(b) <= maxClaimsSize {
		return b
	}
	kept := map[string]any{"_truncated": true}
	for k, v := range claims {
		if vb, err := json.Marshal(v); err == nil && len(vb) <= 1024 {
			kept[k] = v
		}
	}
	b, _ = json.Marshal(kept)
	return b
}

// safeNext only allows same-origin relative paths as post-login redirects.
func safeNext(next string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") ||
		strings.HasPrefix(next, "/\\") || strings.ContainsAny(next, "\r\n") || len(next) > 2048 {
		return "/"
	}
	return next
}
