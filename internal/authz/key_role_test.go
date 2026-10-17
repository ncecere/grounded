package authz

import "testing"

// A key acts with the role its scopes grant, never above its owner's current
// role (personal keys), and a key with only the mcp scope has no REST role
// (QA pass v0.6.0: #110, #112).
func TestKeyTeamRole(t *testing.T) {
	key := func(kind string, scopes ...string) *KeyGrant { return &KeyGrant{Kind: kind, Scopes: scopes} }
	cases := []struct {
		name      string
		k         *KeyGrant
		ownerRole string
		want      string
		rest      bool
	}{
		{"query is a member", key("service", ScopeQuery), "", RoleMember, true},
		{"ingest is an editor", key("service", ScopeIngest, ScopeQuery), "", RoleEditor, true},
		{"manage is an admin", key("service", ScopeManage), "", RoleAdmin, true},
		{"mcp alone is no one", key("service", ScopeMCP), "", "", false},
		{"mcp alone, personal, is no one", key("personal", ScopeMCP), RoleOwner, "", false},
		{"no scopes is no one", key("service"), "", "", false},
		{"personal manage key of an editor acts as an editor", key("personal", ScopeManage), RoleEditor, RoleEditor, true},
		{"personal ingest key of a member acts as a member", key("personal", ScopeIngest, ScopeQuery), RoleMember, RoleMember, true},
		{"personal manage key of an owner acts as an admin (its scopes)", key("personal", ScopeManage), RoleOwner, RoleAdmin, true},
		{"personal key of someone no longer on the team", key("personal", ScopeQuery), "", "", true},
		{"a service key ignores the empty owner role", key("service", ScopeManage), "", RoleAdmin, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := KeyTeamRole(tc.k, tc.ownerRole); got != tc.want {
				t.Errorf("KeyTeamRole = %q, want %q", got, tc.want)
			}
			if got := tc.k.HasRESTScope(); got != tc.rest {
				t.Errorf("HasRESTScope = %v, want %v", got, tc.rest)
			}
		})
	}
}
