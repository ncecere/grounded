package teams

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// openInvite is the team's open invite for email, if any. Inviting an address
// again renews that invite instead of creating another (#146).
func openInvite(ctx context.Context, q *dbgen.Queries, teamID uuid.UUID, email string) (*dbgen.TeamInvite, error) {
	invites, err := q.ListOpenInvites(ctx, teamID)
	if err != nil {
		return nil, err
	}
	for i := range invites {
		if invites[i].Email == email {
			return &invites[i], nil
		}
	}
	return nil, nil
}

// inviteAudit records a new invite as team.invite_create, and a renewal of an
// open one (same invite, new expiry and possibly role; the email is sent again)
// as team.invite_renew with what it was before.
func inviteAudit(a authz.Actor, teamID uuid.UUID, open *dbgen.TeamInvite, inv dbgen.TeamInvite) audit.Entry {
	state := func(i dbgen.TeamInvite) map[string]any {
		return map[string]any{"email": i.Email, "role": i.Role, "expiresAt": i.ExpiresAt}
	}
	if open == nil {
		e := a.Audit("team.invite_create", "team_invite", inv.ID.String())
		e.TeamID, e.After = teamID, state(inv)
		return e
	}
	e := a.Audit("team.invite_renew", "team_invite", inv.ID.String())
	e.TeamID, e.Before, e.After = teamID, state(*open), state(inv)
	return e
}
