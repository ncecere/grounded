package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/ssogroups"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

var errSuspended = errors.New("user suspended")

// loginIdentity is a verified identity from OIDC or the development login.
type loginIdentity struct {
	Issuer, Subject, Email, Name string
	Claims                       json.RawMessage
	Method                       string // "oidc" or "dev"
	// EmailVerified gates invite acceptance: an unverified address must
	// never claim a team membership.
	EmailVerified bool
	// BootstrapRole, when set, is granted once per (issuer, subject). A later
	// demotion is never undone by signing in again.
	BootstrapRole string
	// Groups are the IdP groups for SSO group mapping (internal/ssogroups).
	Groups ssogroups.Seen
}

// completeLogin provisions the user, applies one-time bootstrap roles, creates
// a session and audits the sign-in, all in one transaction.
func (s *Service) completeLogin(ctx context.Context, w http.ResponseWriter, r *http.Request, li loginIdentity) (dbgen.User, error) {
	var (
		user      dbgen.User
		secret    string
		suspended bool
	)
	reqID, ip := httpx.RequestID(ctx), s.clientIP(r)
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		var err error
		user, err = q.UpsertLoginUser(ctx, dbgen.UpsertLoginUserParams{
			OIDCIssuer:  li.Issuer,
			OIDCSubject: li.Subject,
			Email:       li.Email,
			DisplayName: li.Name,
			Claims:      li.Claims,
		})
		if err != nil {
			return err
		}
		if user.Status != StatusActive {
			suspended = true
			return audit.Record(ctx, q, audit.Entry{
				ActorUserID: user.ID, Action: "auth.login_denied", TargetType: "user", TargetID: user.ID.String(),
				Metadata: map[string]any{"method": li.Method, "reason": "suspended"}, RequestID: reqID, ClientIP: ip,
			})
		}
		if li.BootstrapRole != "" {
			n, err := q.InsertBootstrapMarker(ctx, dbgen.InsertBootstrapMarkerParams{OIDCIssuer: li.Issuer, OIDCSubject: li.Subject})
			if err != nil {
				return err
			}
			if n == 1 {
				before := user.PlatformRole
				if user, err = q.SetPlatformRole(ctx, dbgen.SetPlatformRoleParams{ID: user.ID, PlatformRole: li.BootstrapRole}); err != nil {
					return err
				}
				if err := audit.Record(ctx, q, audit.Entry{
					ActorKind: audit.ActorSystem, Action: "platform.bootstrap_role", TargetType: "user", TargetID: user.ID.String(),
					Before: map[string]string{"platformRole": before}, After: map[string]string{"platformRole": user.PlatformRole},
					RequestID: reqID, ClientIP: ip,
				}); err != nil {
					return err
				}
			}
		}
		if li.EmailVerified {
			if err := teams.AcceptInvites(ctx, q, user, reqID, ip); err != nil {
				return err
			}
			// Invites and other items sent to this address before the first sign-in.
			if err := notify.ClaimForEmail(ctx, q, user.ID, user.Email); err != nil {
				return err
			}
		}
		// After invites: an invite is a hand-made membership, which a rule never changes.
		if err := ssogroups.Sync(ctx, q, user.ID, li.Groups, ssogroups.Origin{
			Trigger: ssogroups.TriggerSignIn, RequestID: reqID, ClientIP: ip,
		}); err != nil {
			return err
		}
		if secret, err = s.createSession(ctx, r, q, user); err != nil {
			return err
		}
		return audit.Record(ctx, q, audit.Entry{
			ActorUserID: user.ID, Action: "auth.login", TargetType: "user", TargetID: user.ID.String(),
			Metadata: map[string]any{"method": li.Method}, RequestID: reqID, ClientIP: ip,
		})
	})
	if err != nil {
		return dbgen.User{}, err
	}
	if suspended {
		return user, errSuspended
	}
	s.setSessionCookie(w, secret)
	return user, nil
}

// Logout ends the current session. It must be wrapped by RequireSession so the
// CSRF token and Origin are checked.
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	id, _ := FromContext(r.Context())
	if c, err := r.Cookie(s.sessionCookieName()); err == nil {
		err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
			q := dbgen.New(tx)
			if err := q.DeleteSessionByDigest(r.Context(), digest(c.Value)); err != nil {
				return err
			}
			return audit.Record(r.Context(), q, audit.Entry{
				ActorUserID: id.User.ID, Action: "auth.logout", TargetType: "user", TargetID: id.User.ID.String(),
				RequestID: httpx.RequestID(r.Context()), ClientIP: s.clientIP(r),
			})
		})
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}
	s.setCookie(w, s.sessionCookieName(), "", -1)
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// AuthConfig tells the SPA which sign-in methods are available and how this
// instance presents itself (names, theme, links). It is public.
func (s *Service) AuthConfig(w http.ResponseWriter, r *http.Request) {
	in := s.cfg.Instance
	out := map[string]any{
		"instance": map[string]any{
			"name":       in.Name,
			"orgName":    in.OrgName,
			"theme":      in.Theme,
			"logoUrl":    nullIfEmpty(in.LogoURL),
			"supportUrl": nullIfEmpty(in.SupportURL),
		},
		"oidcEnabled":    s.cfg.OIDC.Enabled(),
		"devAuthEnabled": s.cfg.DevAuth,
		"loginUrl":       "/auth/login",
		"devAccounts":    []devAccount{},
		"teamRequestUrl": nil,
	}
	if s.cfg.DevAuth {
		out["devAccounts"] = s.devPersonas(r.Context())
	}
	if s.cfg.TeamRequestURL != "" {
		out["teamRequestUrl"] = s.cfg.TeamRequestURL
	}
	httpx.JSON(w, http.StatusOK, out)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
