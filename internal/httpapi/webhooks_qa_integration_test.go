package httpapi_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Fixes from the v0.6.0 QA pass (#134, #135, #138, #139).
func TestWebhookQAFixes(t *testing.T) {
	env := newHookEnv(t)
	// In order: the last one archives the team.
	for _, tc := range []struct {
		name string
		fn   func(*testing.T, *hookEnv)
	}{
		{"an update must say enabled, and keeps a description it does not mention (#134)", webhookUpdateRequiresEnabled},
		{"destination notes are for platform staff (#138)", webhookDestinationNotesAreForStaff},
		{"a rating sent again is not a new rating (#139)", webhookSameRatingIsOneEvent},
		{"an archived team's webhooks are read-only (#135)", webhookArchivedTeamIsReadOnly},
	} {
		t.Run(tc.name, func(t *testing.T) { env.reset(t); tc.fn(t, env) })
	}
}

func webhookUpdateRequiresEnabled(t *testing.T, env *hookEnv) {
	var c apitypes.WebhookCreated
	code, e := env.tadmin.call("POST", env.base+"/webhooks", map[string]any{
		"url": "https://hooks.example.com/upd", "description": "the registrar's receiver", "events": []string{"agent.published"}, "enabled": true,
	}, &c, nil)
	mustCode(t, "create", code, e, 201, "")
	path := env.base + "/webhooks/" + c.Webhook.Id.String()
	rev := c.Webhook.Revision

	// Missing a required field: refused by name, nothing changed (it used to switch the webhook off and clear its description).
	for _, tc := range []struct {
		body map[string]any
		code string
	}{
		{map[string]any{"url": "https://hooks.example.com/upd2", "events": []string{"agent.published"}}, "invalid_webhook"},
		{map[string]any{"events": []string{"agent.published"}, "enabled": true}, "invalid_webhook"},
		{map[string]any{"url": "https://hooks.example.com/upd2", "enabled": true}, "no_events"}, // the service's own answer for no events
	} {
		code, e := env.tadmin.call("PATCH", path, tc.body, nil, ifMatch(rev))
		mustCode(t, fmt.Sprintf("update with %v", keysOf(tc.body)), code, e, 400, tc.code)
	}
	if w := env.get(t, env.tadmin, path); !w.Enabled || w.Description != "the registrar's receiver" || w.Revision != rev {
		t.Fatalf("a refused update changed the webhook: %+v", w)
	}

	// All three, no description: the description stays. An empty one clears it.
	var w apitypes.Webhook
	code, e = env.tadmin.call("PATCH", path, map[string]any{"url": "https://hooks.example.com/upd3", "events": []string{"agent.published"}, "enabled": true}, &w, ifMatch(rev))
	mustCode(t, "update without a description", code, e, 200, "")
	if w.Description != "the registrar's receiver" || !w.Enabled || !strings.HasSuffix(w.Url, "/upd3") {
		t.Errorf("after an update without a description: %+v", w)
	}
	code, e = env.tadmin.call("PATCH", path, map[string]any{"url": w.Url, "description": "", "events": []string{"agent.published"}, "enabled": true}, &w, ifMatch(w.Revision))
	mustCode(t, "update with an empty description", code, e, 200, "")
	if w.Description != "" {
		t.Errorf("an empty description did not clear it: %+v", w)
	}
}

func webhookDestinationNotesAreForStaff(t *testing.T, env *hookEnv) {
	notes := func(s *session) []string {
		var list []apitypes.WebhookDestination
		if code := s.get("/v1/webhook-destinations", &list); code != 200 {
			t.Fatalf("list destinations = %d", code)
		}
		var out []string
		for _, d := range list {
			out = append(out, d.Note)
		}
		return out
	}
	for name, s := range map[string]*session{"platform admin": env.admin, "auditor": env.auditor} {
		if got := notes(s); len(got) != 1 || got[0] != "test receiver" {
			t.Errorf("%s sees the notes %q, want the admin's note", name, got)
		}
	}
	for name, s := range map[string]*session{"team admin": env.tadmin, "editor": env.editor, "member": env.member} {
		got := notes(s)
		if len(got) != 1 {
			t.Fatalf("%s sees %d destinations, want the one pattern", name, len(got))
		}
		if got[0] != "" {
			t.Errorf("%s sees the admin-only note %q", name, got[0])
		}
	}
	// The pattern itself is what a team admin needs to choose an address.
	var list []apitypes.WebhookDestination
	env.tadmin.get("/v1/webhook-destinations", &list)
	if len(list) != 1 || list[0].Pattern != "*.example.com" {
		t.Errorf("a team admin's destinations = %+v", list)
	}
}

func webhookSameRatingIsOneEvent(t *testing.T, env *hookEnv) {
	env.make(t, env.tadmin, env.base, "ratings", "feedback.submitted")
	ag := env.publishAgent(t, "Rated agent", env.agentConfig(env.kb.Id.String()))
	code, evs, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Where do students buy a parking permit?"})
	mustCode(t, "chat", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	rate := func(body map[string]any) {
		t.Helper()
		code, e := env.member.call("POST", "/v1/messages/"+end.MessageId.String()+"/feedback", body, nil, nil)
		mustCode(t, fmt.Sprintf("rate %v", body), code, e, 200, "")
	}
	settle := func(want int) {
		t.Helper()
		time.Sleep(600 * time.Millisecond)
		if n := len(env.rx.calls()); n != want {
			t.Fatalf("the receiver got %d events, want %d", n, want)
		}
	}
	rate(map[string]any{"rating": "down", "reason": "outdated"})
	env.rx.waitCalls(t, 1)
	rate(map[string]any{"rating": "down", "reason": "outdated"}) // the same again: not a new rating
	settle(1)
	rate(map[string]any{"rating": "down", "reason": "incorrect"}) // a different reason is a change
	env.rx.waitCalls(t, 2)
	rate(map[string]any{"rating": "up"}) // a different rating is a change
	env.rx.waitCalls(t, 3)
	rate(map[string]any{"rating": "up"})
	settle(3)
	rate(map[string]any{"rating": "none"}) // taking it back says nothing
	rate(map[string]any{"rating": "up"})   // rating again after taking back is a new rating
	env.rx.waitCalls(t, 4)
}

func webhookArchivedTeamIsReadOnly(t *testing.T, env *hookEnv) {
	c := env.make(t, env.tadmin, env.base, "before-archive", "agent.published")
	path := env.base + "/webhooks/" + c.Webhook.Id.String()
	slug := strings.TrimPrefix(env.base, "/v1/teams/")
	var sum apitypes.TeamSummary
	if code := env.admin.get("/v1/admin/teams/"+slug, &sum); code != 200 {
		t.Fatalf("get team = %d", code)
	}
	code, e := env.admin.call("PATCH", "/v1/admin/teams/"+slug, map[string]string{"status": "archived"}, &sum, ifMatch(sum.Team.Revision))
	mustCode(t, "archive", code, e, 200, "")

	// Reading still works.
	if code := env.tadmin.get(env.base+"/webhooks", nil); code != 200 {
		t.Errorf("an archived team's webhook list = %d", code)
	}
	if code := env.tadmin.get(path, nil); code != 200 {
		t.Errorf("an archived team's webhook = %d", code)
	}
	if code := env.tadmin.get(path+"/deliveries", nil); code != 200 {
		t.Errorf("an archived team's deliveries = %d", code)
	}
	// Every change is refused the way the team's other changes are.
	body := map[string]any{"url": "https://hooks.example.com/x", "events": []string{"agent.published"}, "enabled": true}
	for name, call := range map[string]func() (int, string){
		"create":        func() (int, string) { return env.tadmin.call("POST", env.base+"/webhooks", body, nil, nil) },
		"update":        func() (int, string) { return env.tadmin.call("PATCH", path, body, nil, ifMatch(c.Webhook.Revision)) },
		"rotate secret": func() (int, string) { return env.tadmin.call("POST", path+"/rotate-secret", nil, nil, nil) },
		"test event":    func() (int, string) { return env.tadmin.call("POST", path+"/test", nil, nil, nil) },
		"delete":        func() (int, string) { return env.tadmin.call("DELETE", path, nil, nil, nil) },
	} {
		if code, e := call(); code != 409 || e != "team_archived" {
			t.Errorf("%s on an archived team = %d %s, want 409 team_archived", name, code, e)
		}
	}
	if n := len(env.rx.calls()); n != 0 {
		t.Errorf("a test event reached the receiver from an archived team (%d requests)", n)
	}
}
