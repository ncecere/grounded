package authz

import "testing"

func TestConfigurationExportScopeIsReadOnly(t *testing.T) {
	k := &KeyGrant{Scopes: []string{ScopeConfigurationExport}}
	if RoleForKey(k) != "" || k.HasRESTScope() {
		t.Fatal("export scope grants general REST role")
	}
	for _, role := range []string{RoleOwner, RoleAdmin, RoleEditor} {
		found := false
		for _, s := range MaxScopesForRole(role) {
			found = found || s == ScopeConfigurationExport
		}
		if !found {
			t.Fatalf("%s cannot grant export", role)
		}
	}
	for _, s := range MaxScopesForRole(RoleMember) {
		if s == ScopeConfigurationExport {
			t.Fatal("member may grant export")
		}
	}
}
