package web

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Withdraw removes a team's pending domain request (roadmap J4): the person
// who asked, or a team admin or owner, may withdraw it until a platform
// admin reviews it. The request is deleted, so platform admins no longer
// see it and the team can ask again; the audit entry keeps what it was.
// There is no "withdrawn" status: the table allows pending, approved,
// denied and revoked only, and a withdrawn request needs no review.
func (s *Service) Withdraw(ctx context.Context, a authz.Actor, teamRef string, id uuid.UUID) error {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleMember, true)
	if err != nil {
		return err
	}
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockDomainRequest(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && cur.TeamID != acc.Team.ID) {
			return apperr.NotFound("request_not_found", "Domain request not found")
		} else if err != nil {
			return err
		}
		mine := cur.RequestedBy.Valid && cur.RequestedBy.UUID == a.UserID
		if !mine && !authz.RoleAtLeast(acc.Role, authz.RoleAdmin) {
			return apperr.Forbidden("Only the person who asked and team admins and owners can withdraw a domain request")
		}
		if cur.Status != "pending" {
			return apperr.Conflict("request_not_pending", "Only a pending request can be withdrawn; this one is "+cur.Status)
		}
		if err := q.DeleteDomainRequest(ctx, id); err != nil {
			return err
		}
		// The platform admins' "New domain request" items are dealt with.
		if err := q.MarkNotificationsReadFor(ctx, dbgen.MarkNotificationsReadForParams{
			Type: string(notify.DomainRequestNew), DataKey: "requestId", DataValue: id.String(),
		}); err != nil {
			return err
		}
		e := a.Audit("crawl.domain_withdraw", "crawl_domain_request", id.String())
		e.TeamID, e.Before = cur.TeamID, requestSnapshot(cur)
		return audit.Record(ctx, q, e)
	})
}
