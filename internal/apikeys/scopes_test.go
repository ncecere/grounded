package apikeys

import (
	"testing"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
)

func TestValidateScopesSeparatesVocabularyFromRoleGrants(t *testing.T) {
	for _, tc := range []struct {
		name, role string
		scopes     []string
		status     int
		code       string
	}{
		{"null", authz.RoleMember, nil, 400, "invalid_scopes"},
		{"empty", authz.RoleOwner, []string{}, 400, "invalid_scopes"},
		{"unknown", authz.RoleOwner, []string{"admin"}, 400, "invalid_scopes"},
		{"case matters", authz.RoleMember, []string{"QUERY"}, 400, "invalid_scopes"},
		{"blank", authz.RoleOwner, []string{""}, 400, "invalid_scopes"},
		{"space", authz.RoleOwner, []string{" query"}, 400, "invalid_scopes"},
		{"invalid after forbidden", authz.RoleMember, []string{"manage", "unknown"}, 400, "invalid_scopes"},
		{"invalid before forbidden", authz.RoleMember, []string{"unknown", "manage"}, 400, "invalid_scopes"},
		{"member ingest", authz.RoleMember, []string{"ingest"}, 403, "forbidden"},
		{"editor manage", authz.RoleEditor, []string{"query", "manage"}, 403, "forbidden"},
		{"member query and MCP", authz.RoleMember, []string{"query", "mcp"}, 0, ""},
		{"editor ingest", authz.RoleEditor, []string{"ingest"}, 0, ""},
		{"owner all", authz.RoleOwner, []string{"query", "ingest", "manage", "mcp"}, 0, ""},
		{"duplicates compact later", authz.RoleMember, []string{"query", "query"}, 0, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateScopes(tc.scopes, authz.MaxScopesForRole(tc.role))
			if tc.status == 0 {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			e, ok := apperr.As(err)
			if !ok || e.Status != tc.status || e.Code != tc.code {
				t.Fatalf("got %v, want %d %s", err, tc.status, tc.code)
			}
		})
	}
}
