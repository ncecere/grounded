package authz

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/apperr"
)

func TestCheckMemberChange(t *testing.T) {
	roles := []string{"", RoleMember, RoleEditor, RoleAdmin, RoleOwner}
	for _, actor := range roles {
		for _, from := range roles {
			for _, to := range roles {
				err := CheckMemberChange(actor, from, to)
				allowed := err == nil
				want := false
				switch actor {
				case RoleOwner:
					want = true
				case RoleAdmin:
					want = from != RoleOwner && to != RoleOwner
				}
				if allowed != want {
					t.Errorf("actor=%q from=%q to=%q: allowed=%v want %v (%v)", actor, from, to, allowed, want, err)
				}
			}
		}
	}
	if err := CheckMemberChange(RoleOwner, "", "superuser"); err == nil {
		t.Error("invalid role accepted")
	} else if e, _ := apperr.As(err); e.Status != http.StatusBadRequest {
		t.Errorf("invalid role status = %d", e.Status)
	}
}

func TestRoleAtLeast(t *testing.T) {
	if RoleAtLeast("", RoleMember) || RoleAtLeast("bogus", RoleMember) {
		t.Error("non-member treated as member")
	}
	if !RoleAtLeast(RoleOwner, RoleAdmin) || RoleAtLeast(RoleEditor, RoleAdmin) || !RoleAtLeast(RoleEditor, RoleEditor) {
		t.Error("role ordering wrong")
	}
}

func TestAudienceAllowed(t *testing.T) {
	if !AudienceAllowed(AudienceTeam, AudiencePublic) || AudienceAllowed(AudiencePublic, AudienceAllAuthenticated) ||
		!AudienceAllowed(AudienceAllAuthenticated, AudienceAllAuthenticated) || AudienceAllowed("x", AudiencePublic) {
		t.Error("audience ordering wrong")
	}
}

func TestCheckLevelOrdering(t *testing.T) {
	ok := []Level{{"open", 0, AudiencePublic, ""}, {"sensitive", 1, AudienceAllAuthenticated, ""}, {"restricted", 2, AudienceTeam, ""}}
	if err := CheckLevelOrdering(ok); err != nil {
		t.Fatal(err)
	}
	bad := []Level{{"open", 0, AudienceTeam, "Open"}, {"sensitive", 1, AudiencePublic, ""}}
	err := CheckLevelOrdering(bad)
	if err == nil {
		t.Fatal("inverted ordering accepted")
	}
	// Names where known, not raw keys (AD-20).
	if !strings.Contains(err.Error(), "(sensitive) can't allow a wider audience than a less sensitive one (Open)") {
		t.Errorf("message = %v", err)
	}
}
