package httpapi_test

import (
	"encoding/json"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// An anonymous conversation on the public page ends when someone signs in or
// out on the same browser (v0.4.2 US-06): shared and kiosk computers.
func TestAnonymousConversationEndsAtSignInAndOut(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	current := "/v1/public/sessions/current?agentId=" + pub.Id.String()
	v := newVisitor(t, env.app.URL)

	chatOnce := func(step string) {
		t.Helper()
		if code, e := v.start(pub.Id, "", ""); code != 201 {
			t.Fatalf("%s: start = %d %s", step, code, e)
		}
		if code, _, e := v.ask(pub.Id, "Where do students buy a parking permit?"); code != 200 {
			t.Fatalf("%s: chat = %d %s", step, code, e)
		}
		var st apitypes.PublicSessionState
		if code, e := v.call("GET", current, nil, &st); code != 200 || st.Conversation == nil {
			t.Fatalf("%s: current = %d %s", step, code, e)
		}
	}
	gone := func(step string) {
		t.Helper()
		if code, e := v.call("GET", current, nil, nil); code != 401 || e != "session_required" {
			t.Fatalf("%s: the earlier conversation is still there: %d %s", step, code, e)
		}
	}

	chatOnce("before sign-in")
	if code, e := v.call("POST", "/auth/dev", map[string]string{"account": "user"}, nil); code != 200 {
		t.Fatalf("sign in = %d %s", code, e)
	}
	gone("after sign-in")

	chatOnce("signed in")
	res, raw := v.do("GET", "/v1/me", nil, nil)
	var me struct{ Data apitypes.Me }
	if err := json.Unmarshal(raw, &me); err != nil || res.StatusCode != 200 {
		t.Fatalf("me = %d %s", res.StatusCode, raw)
	}
	if res, raw := v.do("POST", "/auth/logout", nil, map[string]string{"X-CSRF-Token": me.Data.CsrfToken}); res.StatusCode != 200 {
		t.Fatalf("sign out = %d %s", res.StatusCode, raw)
	}
	gone("after sign-out")

	// Without signing in or out, the conversation stays (a reload restores it).
	chatOnce("signed out")
	var st apitypes.PublicSessionState
	if code, e := v.call("GET", current, nil, &st); code != 200 || st.Conversation == nil || len(st.Conversation.Messages) != 2 {
		t.Fatalf("reload = %d %s", code, e)
	}
}
