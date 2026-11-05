package scim

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// TokenPrefix starts every SCIM token, so a leaked one is recognisable (and never mistaken for an API key).
const TokenPrefix = "scim_"

// Service is SCIM provisioning: its tokens (platform admins) and the protocol's operations (the identity provider).
type Service struct {
	Pool *pgxpool.Pool
	// Issuer is the OIDC issuer SCIM users belong to; empty: SCIM is unavailable (404).
	Issuer string
	// MatchClaim is the sign-in claim equal to a SCIM user's externalId (SCIM_MATCH_CLAIM).
	MatchClaim string
}

// Available reports whether SCIM can be used: it needs a sign-in provider.
func (s *Service) Available() bool { return s != nil && s.Issuer != "" }

// Origin is the token and request a change comes from, for its audit entries.
type Origin struct {
	Token     dbgen.ScimToken
	RequestID string
	ClientIP  string
}

func (o Origin) entry(action, targetType, targetID string) audit.Entry {
	return audit.Entry{
		ActorKind: audit.ActorSystem, Action: action, TargetType: targetType, TargetID: targetID,
		Metadata:  map[string]any{"via": "scim", "scimTokenId": o.Token.ID.String(), "scimTokenName": o.Token.Name},
		RequestID: o.RequestID, ClientIP: o.ClientIP,
	}
}

func digest(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// ErrUnauthorized is a missing, unknown or revoked token.
var ErrUnauthorized = errors.New("scim: unauthorized")

// Authenticate finds the active token for a bearer secret.
func (s *Service) Authenticate(ctx context.Context, secret string) (dbgen.ScimToken, error) {
	if !strings.HasPrefix(secret, TokenPrefix) || len(secret) > 200 {
		return dbgen.ScimToken{}, ErrUnauthorized
	}
	q := dbgen.New(s.Pool)
	tok, err := q.GetSCIMTokenByDigest(ctx, digest(secret))
	if errors.Is(err, pgx.ErrNoRows) {
		return dbgen.ScimToken{}, ErrUnauthorized
	} else if err != nil {
		return dbgen.ScimToken{}, err
	}
	if err := q.TouchSCIMToken(ctx, tok.ID); err != nil {
		return dbgen.ScimToken{}, err
	}
	return tok, nil
}

// Summary is Admin → SCIM provisioning: the tokens (never their secrets) and how many users and groups SCIM manages.
type Summary struct {
	Tokens  []dbgen.ListSCIMTokensRow
	Counts  dbgen.SCIMSummaryRow
	Enabled bool
}

func readable(a authz.Actor) error {
	if !a.CanReadPlatform() || a.Delegated() {
		return apperr.Forbidden("Only platform admins and auditors can see SCIM provisioning")
	}
	return nil
}

func writable(a authz.Actor) error {
	if !a.IsPlatformAdmin() || a.Delegated() {
		return apperr.Forbidden("Only a signed-in platform admin can manage SCIM tokens")
	}
	return nil
}

// Get is the summary (platform admins and auditors, signed in).
func (s *Service) Get(ctx context.Context, a authz.Actor) (Summary, error) {
	if err := readable(a); err != nil {
		return Summary{}, err
	}
	q := dbgen.New(s.Pool)
	toks, err := q.ListSCIMTokens(ctx)
	if err != nil {
		return Summary{}, err
	}
	counts, err := q.SCIMSummary(ctx)
	return Summary{Tokens: toks, Counts: counts, Enabled: s.Available()}, err
}

// CreateToken makes a token and returns its secret, which is never shown again (a signed-in platform admin; audited).
func (s *Service) CreateToken(ctx context.Context, a authz.Actor, name string) (dbgen.ScimToken, string, error) {
	if err := writable(a); err != nil {
		return dbgen.ScimToken{}, "", err
	}
	if !s.Available() {
		return dbgen.ScimToken{}, "", apperr.Conflict("scim_unavailable", "SCIM needs a sign-in provider: set OIDC_ISSUER first")
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return dbgen.ScimToken{}, "", apperr.Invalid("invalid_name", "Name the token (1-100 characters), for example after the identity provider")
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return dbgen.ScimToken{}, "", err
	}
	secret := TokenPrefix + base64.RawURLEncoding.EncodeToString(raw)
	var tok dbgen.ScimToken
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "LOCK TABLE scim_tokens IN SHARE ROW EXCLUSIVE MODE"); err != nil {
			return err
		}
		n, err := q.CountActiveSCIMTokens(ctx)
		if err != nil {
			return err
		}
		if n >= MaxTokens {
			return apperr.Conflict("too_many_tokens", "At most 10 SCIM tokens can be active. Revoke one first.")
		}
		if tok, err = q.InsertSCIMToken(ctx, dbgen.InsertSCIMTokenParams{Name: name, Digest: digest(secret), CreatedBy: uuid.NullUUID{UUID: a.UserID, Valid: true}}); err != nil {
			return err
		}
		e := a.Audit("platform.scim_token_create", "scim_token", tok.ID.String())
		e.After = map[string]any{"name": tok.Name}
		return audit.Record(ctx, q, e)
	})
	return tok, secret, err
}

// RevokeToken stops a token at once (a signed-in platform admin; audited).
func (s *Service) RevokeToken(ctx context.Context, a authz.Actor, id uuid.UUID) error {
	if err := writable(a); err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		tok, err := q.RevokeSCIMToken(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("not_found", "SCIM token not found")
		} else if err != nil {
			return err
		}
		e := a.Audit("platform.scim_token_revoke", "scim_token", tok.ID.String())
		e.Before = map[string]any{"name": tok.Name}
		return audit.Record(ctx, q, e)
	})
}
