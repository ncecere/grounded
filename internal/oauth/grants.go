package oauth

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Why a grant was revoked (oauth_grants.revoked_reason, audit metadata).
const (
	reasonUser   = "user"
	reasonAdmin  = "admin"
	reasonClient = "client"
	reasonReuse  = "refresh_reuse"
)

// Grant is a connected app: a person's consent for a client.
type Grant = dbgen.OauthGrant

var errNoGrant = apperr.NotFound("grant_not_found", "Connected app not found")

// mayRead: the person themselves, or a platform admin or auditor, in the
// app (never an API key or an OAuth client).
func mayRead(a authz.Actor, userID uuid.UUID) bool {
	return a.Key == nil && a.OAuth == nil && a.UserID != uuid.Nil && (a.UserID == userID || a.CanReadPlatform())
}

// ListGrants lists a person's connected apps, newest first.
func (s *Service) ListGrants(ctx context.Context, a authz.Actor, userID uuid.UUID) ([]Grant, error) {
	if !mayRead(a, userID) {
		return nil, errNoGrant
	}
	return s.q.ListUserOAuthGrants(ctx, userID)
}

// RevokeGrant disconnects an app: the person themselves, or a platform
// admin (an auditor may only look). Its tokens stop working at once and
// its consent is forgotten. Audited as oauth.revoke.
func (s *Service) RevokeGrant(ctx context.Context, a authz.Actor, userID, grantID uuid.UUID) error {
	if !mayRead(a, userID) {
		return errNoGrant
	}
	reason := reasonUser
	if a.UserID != userID {
		if !a.IsPlatformAdmin() {
			return apperr.Forbidden("Only platform admins can disconnect another person's apps")
		}
		reason = reasonAdmin
	}
	return store.InTx(ctx, s.pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		g, err := q.LockOAuthGrant(ctx, grantID)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && (g.UserID != userID || g.RevokedAt != nil)) {
			return errNoGrant
		} else if err != nil {
			return err
		}
		return s.revokeGrant(ctx, q, a, g.ID, reason)
	})
}

// revokeGrant revokes a grant and deletes its codes and tokens, auditing
// oauth.revoke with the reason. A grant already revoked is left alone.
func (s *Service) revokeGrant(ctx context.Context, q *dbgen.Queries, a authz.Actor, id uuid.UUID, reason string) error {
	g, err := q.LockOAuthGrant(ctx, id)
	if err != nil {
		return err
	}
	n, err := q.RevokeOAuthGrant(ctx, dbgen.RevokeOAuthGrantParams{ID: id, Reason: &reason})
	if err != nil || n == 0 {
		return err
	}
	if err := q.DeleteOAuthGrantTokens(ctx, id); err != nil {
		return err
	}
	e := a.Audit("oauth.revoke", "oauth_grant", id.String())
	if e.Metadata == nil {
		e.Metadata = map[string]any{}
	}
	e.Metadata["reason"] = reason
	e.Before = grantSnapshot(g)
	return audit.Record(ctx, q, e)
}
