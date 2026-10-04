package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/ssogroups"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// DevIssuer is the issuer recorded for development-login identities.
const DevIssuer = "grounded:development"

type devAccount struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	PlatformRole string `json:"platformRole"`
}

// devAccounts are fixed local personas. Roles are granted once on first use,
// like production bootstrap, so demotions made while testing persist.
var devAccounts = []devAccount{
	{ID: "admin", Name: "Dev Platform Admin", Email: "admin@localhost", PlatformRole: RolePlatformAdmin},
	{ID: "auditor", Name: "Dev Platform Auditor", Email: "auditor@localhost", PlatformRole: RolePlatformAuditor},
	{ID: "user", Name: "Dev User", Email: "user@localhost", PlatformRole: RoleNone},
	// Extra people for trying team roles. No team membership is granted
	// automatically; add them to teams through the UI or API.
	{ID: "alex", Name: "Alex Dev", Email: "alex@localhost", PlatformRole: RoleNone},
	{ID: "blair", Name: "Blair Dev", Email: "blair@localhost", PlatformRole: RoleNone},
	{ID: "casey", Name: "Casey Dev", Email: "casey@localhost", PlatformRole: RoleNone},
}

// devPersonas are the development accounts as the dev data has them: an
// account that exists keeps its current name and email (the dev data may
// rename the personas), so the sign-in list and the signed-in person agree
// (VI-37), and signing in doesn't reset them. Without the database, the
// fixed list.
func (s *Service) devPersonas(ctx context.Context) []devAccount {
	out := append([]devAccount(nil), devAccounts...)
	if s.pool == nil {
		return out
	}
	rows, err := dbgen.New(s.pool).ListIssuerUsers(ctx, DevIssuer)
	if err != nil {
		s.log.WarnContext(ctx, "could not read the development personas", "err", err)
		return out
	}
	for i := range out {
		for _, row := range rows {
			if row.OIDCSubject == out[i].ID {
				out[i].Name, out[i].Email = row.DisplayName, row.Email
			}
		}
	}
	return out
}

// DevPersona returns the subject and name of the development persona with
// this email (case-insensitive). `grounded demo` creates the persona's
// account before its first sign-in, so it can own the Demo team; signing in
// later finds the same account and still applies the one-time role.
func DevPersona(email string) (subject, name string, ok bool) {
	for _, a := range devAccounts {
		if strings.EqualFold(a.Email, strings.TrimSpace(email)) {
			return a.ID, a.Name, true
		}
	}
	return "", "", false
}

// DevLogin signs in as a local persona. It only exists when DEV_AUTH=true,
// which configuration refuses unless APP_URL is a loopback address.
func (s *Service) DevLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.DevAuth {
		httpx.Error(w, http.StatusNotFound, "not_found", "Not found")
		return
	}
	app, _ := url.Parse(s.cfg.AppURL)
	if r.Host != app.Host || !s.originAllowed(r) {
		httpx.Error(w, http.StatusForbidden, "origin_denied", "Development login is local-only")
		return
	}
	if !s.admitLogin(w, r) {
		return
	}
	var in struct {
		Account string `json:"account"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	var acct *devAccount
	personas := s.devPersonas(r.Context())
	for i := range personas {
		if personas[i].ID == in.Account {
			acct = &personas[i]
		}
	}
	if acct == nil {
		httpx.Error(w, http.StatusBadRequest, "unknown_account", "Unknown development account")
		return
	}
	// DEV_AUTH_GROUPS gives personas fake IdP groups for trying group mapping.
	groups, hasGroups := s.cfg.DevAuthGroups[acct.ID]
	fields := map[string]any{"sub": acct.ID, "email": acct.Email, "name": acct.Name, "email_verified": true}
	if hasGroups {
		fields[s.cfg.OIDC.GroupsClaim] = groups
	}
	claims, _ := json.Marshal(fields)
	li := loginIdentity{Issuer: DevIssuer, Subject: acct.ID, Email: acct.Email, Name: acct.Name, Claims: claims, Method: "dev", EmailVerified: true}
	li.Groups = ssogroups.Seen{Groups: ssogroups.NormalizeGroups(groups), ClaimPresent: hasGroups}
	if acct.PlatformRole != RoleNone {
		li.BootstrapRole = acct.PlatformRole
	}
	if _, err := s.completeLogin(r.Context(), w, r, li); err != nil {
		if errors.Is(err, errSuspended) {
			httpx.Error(w, http.StatusForbidden, "user_suspended", "This account is suspended")
			return
		}
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}
