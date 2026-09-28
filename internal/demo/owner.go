package demo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/teams"
)

// Owner is who owns the Demo team. The demo acts as this user: the objects
// it creates are theirs, and the audit log names them.
type Owner struct {
	// Email picks the owner ("" = the default, see defaultOwnerEmail).
	Email string
	// DevAuth: development sign-in is on, so a development persona that
	// has not signed in yet is created (see auth.DevPersona).
	DevAuth bool
	// Issuer and BootstrapSubject identify the configured bootstrap admin
	// (OIDC_ISSUER, BOOTSTRAP_ADMIN_SUBJECT).
	Issuer, BootstrapSubject string
}

// devAdminEmail is the development platform admin persona.
const devAdminEmail = "admin@localhost"

var errNoOwner = errors.New("can't tell who should own the Demo team: pass --owner-email " +
	"(someone who has signed in to Grounded at least once)")

// resolveOwner finds the owner's account, creating a development persona's
// account when DEV_AUTH is on and it has not signed in yet.
func (s *seeder) resolveOwner(ctx context.Context) (dbgen.User, error) {
	email := strings.TrimSpace(s.opts.Owner.Email)
	if email == "" {
		var err error
		if email, err = s.defaultOwnerEmail(ctx); err != nil {
			return dbgen.User{}, err
		}
	}
	email, err := teams.NormalizeEmail(email)
	if err != nil {
		return dbgen.User{}, fmt.Errorf("owner email %q is not valid", s.opts.Owner.Email)
	}
	users, err := s.q.ListUsersByEmail(ctx, email)
	if err != nil {
		return dbgen.User{}, err
	}
	switch {
	case len(users) > 1:
		return dbgen.User{}, fmt.Errorf("more than one account uses %s: pass the email of a single account with --owner-email", email)
	case len(users) == 1 && users[0].Status != "active":
		return dbgen.User{}, fmt.Errorf("the account %s is suspended", email)
	case len(users) == 1:
		return users[0], nil
	}
	if subject, name, ok := auth.DevPersona(email); ok && s.opts.Owner.DevAuth {
		return s.provisionPersona(ctx, subject, email, name)
	}
	return dbgen.User{}, fmt.Errorf("%s has not signed in to Grounded yet: sign in once, then run grounded demo again", email)
}

// defaultOwnerEmail is the bootstrap admin if they have signed in, else the
// development admin persona when DEV_AUTH is on, else the only active
// platform admin.
func (s *seeder) defaultOwnerEmail(ctx context.Context) (string, error) {
	o := s.opts.Owner
	if o.BootstrapSubject != "" && o.Issuer != "" {
		var email string
		err := s.pool.QueryRow(ctx, "SELECT email FROM users WHERE oidc_issuer = $1 AND oidc_subject = $2 AND status = 'active'",
			o.Issuer, o.BootstrapSubject).Scan(&email)
		if err == nil {
			return email, nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	if o.DevAuth {
		return devAdminEmail, nil
	}
	ids, err := s.q.ActivePlatformAdminIDs(ctx)
	if err != nil {
		return "", err
	}
	if len(ids) != 1 {
		return "", errNoOwner
	}
	u, err := s.q.GetUser(ctx, ids[0])
	return u.Email, err
}

// provisionPersona creates a development persona's account as its first
// sign-in would (the same issuer and subject), without a session and
// without its platform role: that is still granted once, on the first
// sign-in. Audited as a system action.
func (s *seeder) provisionPersona(ctx context.Context, subject, email, name string) (dbgen.User, error) {
	var u dbgen.User
	claims, _ := json.Marshal(map[string]any{"sub": subject, "email": email, "name": name, "email_verified": true})
	err := store.InTx(ctx, s.pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		var id uuid.UUID
		err := tx.QueryRow(ctx, `INSERT INTO users (oidc_issuer, oidc_subject, email, display_name, claims)
			VALUES ($1, $2, $3, $4, $5) ON CONFLICT (oidc_issuer, oidc_subject) DO NOTHING RETURNING id`,
			auth.DevIssuer, subject, email, name, claims).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("the development account %s exists with another email: sign in as it once, then run grounded demo again", subject)
		} else if err != nil {
			return err
		}
		if u, err = q.GetUser(ctx, id); err != nil {
			return err
		}
		return audit.Record(ctx, q, audit.Entry{
			ActorKind: audit.ActorSystem, Action: "demo.owner_provision", TargetType: "user", TargetID: u.ID.String(),
			After: map[string]any{"email": email, "displayName": name}, Metadata: map[string]any{"source": "grounded demo"},
		})
	})
	if err == nil {
		s.created("account %s (development sign-in; signing in uses it)", email)
	}
	return u, err
}
