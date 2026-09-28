package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// A key is readable by ID after it is revoked (the audit log links to it),
// by the same people who see it in the list: team admins every key, others
// their own personal keys.
func TestGetAPIKeyIncludesRevoked(t *testing.T) {
	env := newRAGEnv(t)
	owner := env.owner
	base := "/v1/teams/" + env.team
	env.app.signIn("alex")
	env.app.signIn("blair")
	owner.call("POST", base+"/members", map[string]string{"email": "alex@localhost", "role": "member"}, nil, nil)
	owner.call("POST", base+"/members", map[string]string{"email": "blair@localhost", "role": "member"}, nil, nil)
	alex, blair := env.app.signIn("alex"), env.app.signIn("blair")

	var service, personal apitypes.APIKeyCreated
	code, e := owner.call("POST", base+"/api-keys", map[string]any{"name": "loader", "kind": "service", "scopes": []string{"ingest"}}, &service, nil)
	mustCode(t, "service key", code, e, 201, "")
	code, e = alex.call("POST", base+"/api-keys", map[string]any{"name": "mine", "scopes": []string{"query"}}, &personal, nil)
	mustCode(t, "personal key", code, e, 201, "")
	servicePath, personalPath := base+"/api-keys/"+service.Key.Id.String(), base+"/api-keys/"+personal.Key.Id.String()

	var k apitypes.APIKey
	if code := owner.get(servicePath, &k); code != 200 || k.Id != service.Key.Id || k.RevokedAt != nil || k.Contact == nil {
		t.Fatalf("active service key = %d %+v", code, k)
	}
	for _, path := range []string{servicePath, base + "/api-keys/00000000-0000-0000-0000-000000000001"} {
		code, e = alex.call("GET", path, nil, nil, nil)
		mustCode(t, "member reads a key not theirs", code, e, 404, "key_not_found")
	}

	// Revoked: gone from the list, still readable by ID.
	for _, p := range []struct {
		s    *session
		path string
	}{{owner, servicePath}, {alex, personalPath}} {
		code, e = p.s.call("DELETE", p.path, nil, nil, nil)
		mustCode(t, "revoke "+p.path, code, e, 200, "")
	}
	var list []apitypes.APIKey
	if owner.get(base+"/api-keys", &list); len(list) != 0 {
		t.Errorf("list after revoking = %+v", list)
	}
	if code := owner.get(servicePath, &k); code != 200 || k.RevokedAt == nil || k.Name != "loader" {
		t.Fatalf("revoked service key = %d %+v", code, k)
	}
	if code := alex.get(personalPath, &k); code != 200 || k.RevokedAt == nil || k.Contact == nil || k.Contact.Email != "alex@localhost" {
		t.Fatalf("own revoked key = %d %+v", code, k)
	}
	if code := owner.get(personalPath, &k); code != 200 || k.RevokedAt == nil {
		t.Fatalf("team owner reads a member's revoked key = %d %+v", code, k)
	}
	code, e = blair.call("GET", personalPath, nil, nil, nil)
	mustCode(t, "another member reads a revoked key", code, e, 404, "key_not_found")

	// Not through another team, even one the caller owns.
	createTeam(t, env.admin, "other", "user@localhost")
	code, e = owner.call("GET", "/v1/teams/other/api-keys/"+service.Key.Id.String(), nil, nil, nil)
	mustCode(t, "key through another team", code, e, 404, "key_not_found")
}
