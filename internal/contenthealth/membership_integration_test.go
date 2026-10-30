package contenthealth

import (
	"testing"

	"github.com/ncecere/grounded/internal/authz"
)

// A platform role grants no report access. An independent, real team-content
// membership still does: staff are not silently disqualified from their own
// teams, nor does their platform privilege substitute for that membership.
func TestHealthPlatformRoleDoesNotReplaceTeamMembership(t *testing.T) {
	f := newFixture(t)
	rep := f.make(CreateInput{})
	for _, actor := range []authz.Actor{f.platformAdmin, f.auditor} {
		_, err := f.svc.Get(f.ctx, actor, f.slugA, rep.ID)
		wantStatus(t, "platform role without membership", err, 404, "not_found")
		f.exec(`INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'editor')`, f.teamA, actor.UserID)
		if got, err := f.svc.Get(f.ctx, actor, f.slugA, rep.ID); err != nil || got.ID != rep.ID {
			t.Fatalf("explicit editor membership with a platform role: %+v, %v", got, err)
		}
		f.exec(`DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, f.teamA, actor.UserID)
		_, err = f.svc.Get(f.ctx, actor, f.slugA, rep.ID)
		wantStatus(t, "revoked membership cannot fall back to platform privilege", err, 404, "not_found")
	}
}
