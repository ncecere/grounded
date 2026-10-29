package httpapi_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

func TestAPIKeyScopeVocabularyBeforeRoleGrants(t *testing.T) {
	env := newRAGEnv(t)
	base := "/v1/teams/" + env.team
	env.app.signIn("alex")
	code, e := env.owner.call("POST", base+"/members", map[string]string{"email": "alex@localhost", "role": "member"}, nil, nil)
	mustCode(t, "add member", code, e, 201, "")
	member := env.app.signIn("alex")
	for _, caller := range []*session{member, env.owner} {
		for _, scopes := range [][]string{nil, {}, {"admin"}, {"QUERY"}, {"query", "unknown"}, {"manage", "unknown"}} {
			code, e = caller.call("POST", base+"/api-keys", map[string]any{"name": "invalid scope", "scopes": scopes}, nil, nil)
			mustCode(t, "unknown scopes", code, e, 400, "invalid_scopes")
		}
	}
	code, e = member.call("POST", base+"/api-keys", map[string]any{"name": "not allowed", "scopes": []string{"manage"}}, nil, nil)
	mustCode(t, "known scope above role", code, e, 403, "forbidden")
	var keys []apitypes.APIKey
	if code := env.owner.get(base+"/api-keys", &keys); code != 200 || len(keys) != 0 {
		t.Fatalf("refused requests created keys: %d %+v", code, keys)
	}
	var created apitypes.APIKeyCreated
	code, e = member.call("POST", base+"/api-keys", map[string]any{"name": "valid", "scopes": []string{"query", "query", "mcp"}}, &created, nil)
	mustCode(t, "valid duplicate scopes", code, e, 201, "")
	if len(created.Key.Scopes) != 2 {
		t.Fatalf("duplicate scopes were not compacted: %+v", created.Key.Scopes)
	}
}

func TestAPIKeyBearerSchemeIsCaseInsensitive(t *testing.T) {
	env := newRAGEnv(t)
	base := "/v1/teams/" + env.team
	var key apitypes.APIKeyCreated
	code, e := env.owner.call("POST", base+"/api-keys", map[string]any{"name": "scheme test", "scopes": []string{"query"}}, &key, nil)
	mustCode(t, "create key", code, e, 201, "")
	for _, path := range []string{base + "/kbs", "/v1/models"} {
		for _, scheme := range []string{"Bearer", "bearer", "BEARER", "bEaReR", "Bearer  "} {
			req, _ := http.NewRequest("GET", env.app.URL+path, nil)
			req.Header.Set("Authorization", scheme+" "+key.Secret)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 200 {
				t.Errorf("%s %s = %d", scheme, path, res.StatusCode)
			}
		}
	}
	assertInvalid := func(header string) {
		t.Helper()
		req, _ := http.NewRequest("GET", env.app.URL+base+"/kbs", nil)
		req.Header.Set("Authorization", header)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var body struct{ Error struct{ Code string } }
		err = json.NewDecoder(res.Body).Decode(&body)
		res.Body.Close()
		if err != nil || res.StatusCode != 401 || body.Error.Code != "invalid_api_key" {
			t.Fatalf("invalid/revoked key = %d %s (%v)", res.StatusCode, body.Error.Code, err)
		}
	}
	// Check secret case and scheme rejection while the key is still active:
	// revoking first would mask a bug that accepted these credentials.
	assertInvalid("Bearer " + strings.ToUpper(key.Secret))
	assertInvalid("Basic " + key.Secret)
	code, e = env.owner.call("DELETE", base+"/api-keys/"+key.Key.Id.String(), nil, nil, nil)
	mustCode(t, "revoke key", code, e, 200, "")
	assertInvalid("bearer " + key.Secret)
}
