package sources

import (
	"context"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/teams"
)

// Who may read or change a source: its owner (a team or the platform), the actor's role, an API key's scopes and break-glass reads.

// readAccess is access for a read that a platform admin who isn't a member
// may make under a break-glass session with the documents scope (ADR-0024).
// The read is recorded in the audit log when it is authorized, before the
// content is fetched. A read of the team itself (the source list) passes
// an empty TargetID.
func (s *Service) readAccess(ctx context.Context, a authz.Actor, o Owner, r breakglass.Read) (scope, error) {
	return s.accessFor(ctx, a, o, false, &r)
}

func (s *Service) accessFor(ctx context.Context, a authz.Actor, o Owner, write bool, read *breakglass.Read) (scope, error) {
	if o.platform {
		if a.Key != nil || !a.CanReadPlatform() {
			return scope{}, apperr.Forbidden("Shared sources are managed by platform admins")
		}
		if write && !a.IsPlatformAdmin() {
			return scope{}, apperr.Forbidden("Only platform admins can change shared sources")
		}
		return scope{}, nil
	}
	acc, err := s.Teams.Get(ctx, a, o.teamRef)
	if err != nil {
		return scope{}, err
	}
	if acc.Role == "" {
		return s.breakGlassScope(ctx, a, acc, read)
	}
	if write {
		if !authz.RoleAtLeast(acc.Role, authz.RoleEditor) {
			return scope{}, writeDenied(a)
		}
		if acc.Team.Status != teams.StatusActive {
			return scope{}, apperr.Conflict("team_archived", "This team is archived and read-only")
		}
	}
	return scope{team: &acc.Team, role: acc.Role, key: a.Key}, nil
}

// writeDenied is the refusal of a change to data sources. A key with only the query scope acts as a member, and
// "only team editors" tells it nothing it can act on: it needs the ingest scope (#132). Anyone else, including a key
// whose scopes are enough but whose owner is not an editor now, is told who may.
func writeDenied(a authz.Actor) error {
	if k := a.Key; k != nil && !k.HasScope(authz.ScopeIngest) && !k.HasScope(authz.ScopeManage) {
		return apperr.Forbidden("This API key needs the ingest scope to change data sources. Create a key with the ingest scope.")
	}
	return apperr.Forbidden("Only team editors, admins and owners can change data sources")
}

// breakGlassScope answers a non-member: a read under the actor's break-glass
// session, or 404 as for anyone outside the team.
func (s *Service) breakGlassScope(ctx context.Context, a authz.Actor, acc teams.Access, read *breakglass.Read) (scope, error) {
	errTeam := apperr.NotFound("team_not_found", "Team not found")
	if read == nil {
		return scope{}, errTeam
	}
	r := *read
	if r.TargetID == "" {
		r.TargetType, r.TargetID = "team", acc.Team.ID.String()
	}
	g, err := s.BreakGlass.Authorize(ctx, a, acc.Team.ID, r)
	if err != nil {
		return scope{}, err
	}
	if g == nil {
		return scope{}, errTeam
	}
	return scope{team: &acc.Team}, nil
}
