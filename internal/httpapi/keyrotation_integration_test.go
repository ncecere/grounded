package httpapi_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/keyrotation"
	"github.com/ncecere/grounded/internal/public"
	"github.com/ncecere/grounded/internal/secrets"
)

// testPepper is the pepper newTestApp configures.
const testPepper = "cGVwcGVycGVwcGVycGVwcGVycGVwcGVycGVwcGVyISE="

func keyStatus(t *testing.T, a *testApp, key, path string) int {
	t.Helper()
	req, _ := http.NewRequest("GET", a.URL+path, nil)
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

func widgetAllowed(t *testing.T, a *testApp, agentID uuid.UUID, key string) bool {
	t.Helper()
	res, raw := newVisitor(t, a.URL).do("GET", "/v1/public/agents/"+agentID.String()+"/widget-check?key="+url.QueryEscape(key), nil,
		map[string]string{"Origin": "https://www.example.edu"})
	return res.StatusCode == 200 && bytes.Contains(raw, []byte(`"allowed":true`))
}

func keyRotation(t *testing.T, s *session) apitypes.KeyRotationStatus {
	t.Helper()
	var st apitypes.KeyRotationStatus
	if code := s.get("/v1/admin/key-rotation", &st); code != 200 {
		t.Fatalf("key-rotation = %d", code)
	}
	return st
}

func pepperStates(st apitypes.KeyRotationStatus) map[uuid.UUID]string {
	out := map[uuid.UUID]string{}
	for _, k := range st.Keys {
		out[k.Id] = string(k.State)
	}
	return out
}

func storedDigest(t *testing.T, a *testApp, table string, id uuid.UUID) (hash, pepperID []byte) {
	t.Helper()
	if err := a.Pool.QueryRow(context.Background(), "SELECT secret_hash, pepper_id FROM "+table+" WHERE id = $1", id).Scan(&hash, &pepperID); err != nil {
		t.Fatal(err)
	}
	return hash, pepperID
}

func hmacKey(pepper []byte, key string) []byte {
	m := hmac.New(sha256.New, pepper)
	m.Write([]byte(key))
	return m.Sum(nil)
}

// API_KEY_PEPPER rotation (E10): during the grace period keys on the
// previous pepper keep working and are re-hashed on use; afterwards only
// re-hashed keys work, and the admin report names the rest.
func TestPepperRotation(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	var used, idle apitypes.APIKeyCreated
	for name, dst := range map[string]*apitypes.APIKeyCreated{"app": &used, "idle": &idle} {
		code, e := env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": name, "scopes": []string{"query"}}, dst, nil)
		mustCode(t, "key "+name, code, e, 201, "")
	}
	var widget apitypes.PublishableKeyCreated
	code, e := env.tadmin.call("POST", env.base+"/agents/"+pub.Id.String()+"/publishable-keys",
		map[string]any{"name": "Main site", "allowedOrigins": []string{"https://www.example.edu"}}, &widget, nil)
	mustCode(t, "widget key", code, e, 201, "")
	oldPepper, _ := secrets.ParseKey(testPepper)
	if _, id := storedDigest(t, env.app, "api_keys", used.Key.Id); !bytes.Equal(id, secrets.PepperID(oldPepper)) {
		t.Fatalf("new key's pepper id = %x", id)
	}
	// A digest from before pepper ids.
	if _, err := env.app.Pool.Exec(context.Background(), "UPDATE api_keys SET pepper_id = NULL WHERE id = $1", idle.Key.Id); err != nil {
		t.Fatal(err)
	}
	if st := keyRotation(t, env.admin); st.PreviousPepperConfigured || len(st.Keys) != 0 {
		t.Fatalf("before rotation = %+v", st)
	}

	// Rotate: a new pepper, the old one as previous.
	raw := make([]byte, 32)
	_, _ = rand.Read(raw)
	newPepper := base64.StdEncoding.EncodeToString(raw)
	rotating := newTestAppOn(t, env.app.Pool, func(c *config.Config) { c.APIKeyPepper, c.APIKeyPepperPrevious = newPepper, testPepper }, false)
	admin := rotating.signIn("admin")
	st := keyRotation(t, admin)
	want := map[uuid.UUID]string{used.Key.Id: "previous", idle.Key.Id: "previous", widget.Id: "previous"}
	if !st.PreviousPepperConfigured || len(st.Keys) != 3 || pepperStates(st)[widget.Id] != "previous" || pepperStates(st)[idle.Key.Id] != "previous" {
		t.Fatalf("during rotation = %+v, want %v", st, want)
	}

	kbs := env.base + "/kbs"
	if code := keyStatus(t, rotating, used.Secret, kbs); code != 200 {
		t.Fatalf("API key on the previous pepper = %d", code)
	}
	if !widgetAllowed(t, rotating, pub.Id, widget.Key) {
		t.Fatal("widget key on the previous pepper refused")
	}
	if h, id := storedDigest(t, env.app, "api_keys", used.Key.Id); !bytes.Equal(h, hmacKey(raw, used.Secret)) || !bytes.Equal(id, secrets.PepperID(raw)) {
		t.Fatal("API key not re-hashed with the new pepper on use")
	}
	if h, id := storedDigest(t, env.app, "publishable_keys", widget.Id); !bytes.Equal(h, public.HashKey(raw, widget.Key)) || !bytes.Equal(id, secrets.PepperID(raw)) {
		t.Fatal("widget key not re-hashed with the new pepper on use")
	}
	keyStatus(t, rotating, used.Secret, kbs) // a second use re-hashes nothing
	if st := pepperStates(keyRotation(t, admin)); len(st) != 1 || st[idle.Key.Id] != "previous" {
		t.Fatalf("after use = %v", st)
	}
	var fresh apitypes.APIKeyCreated
	code, e = rotating.signIn("user").call("POST", env.base+"/api-keys", map[string]any{"name": "fresh", "scopes": []string{"query"}}, &fresh, nil)
	mustCode(t, "fresh key", code, e, 201, "")
	if _, id := storedDigest(t, env.app, "api_keys", fresh.Key.Id); !bytes.Equal(id, secrets.PepperID(raw)) {
		t.Fatal("a key created during rotation is not on the new pepper")
	}

	// Audited once per key, as the system, with no digest or key.
	var rehashes int
	if err := env.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_log WHERE actor_kind = 'system'
		AND ((action = 'apikey.pepper_rehash' AND target_id = $1) OR (action = 'agent.publishable_key_pepper_rehash' AND target_id = $2))
		AND before_state IS NULL AND after_state IS NULL`, used.Key.Id.String(), widget.Id.String()).Scan(&rehashes); err != nil || rehashes != 2 {
		t.Fatalf("re-hash audit entries = %d, %v", rehashes, err)
	}

	// rotate-keys --pepper-only records the pepper of legacy digests.
	peppers, _ := secrets.ParsePeppers(newPepper, testPepper)
	sum, err := keyrotation.Run(context.Background(), env.app.Pool, nil, peppers, keyrotation.Options{PepperOnly: true})
	if err != nil || sum.LabelledAPIKeys != 1 || len(sum.PepperKeys) != 1 || sum.PepperKeys[0].ID != idle.Key.Id {
		t.Fatalf("pepper-only run = %+v, %v", sum, err)
	}

	// The grace period ends: only re-hashed keys still work.
	after := newTestAppOn(t, env.app.Pool, func(c *config.Config) { c.APIKeyPepper = newPepper }, false)
	if code := keyStatus(t, after, used.Secret, kbs); code != 200 {
		t.Fatalf("re-hashed key after rotation = %d", code)
	}
	if code := keyStatus(t, after, idle.Secret, kbs); code != 401 {
		t.Fatalf("unused key after rotation = %d, want 401", code)
	}
	if !widgetAllowed(t, after, pub.Id, widget.Key) {
		t.Fatal("re-hashed widget key refused after rotation")
	}
	st = keyRotation(t, after.signIn("admin"))
	if st.PreviousPepperConfigured || len(st.Keys) != 1 || st.Keys[0].Id != idle.Key.Id || st.Keys[0].State != "retired" || st.Keys[0].TeamSlug == "" {
		t.Fatalf("after rotation = %+v", st)
	}
}
