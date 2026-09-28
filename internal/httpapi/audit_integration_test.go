package httpapi_test

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// auditPage reads one page of an audit log with the given filters.
func auditPage(t *testing.T, s *session, path string, filters url.Values) apitypes.AuditPage {
	t.Helper()
	var page apitypes.AuditPage
	if code, e := s.call("GET", path+"?"+filters.Encode(), nil, &page, nil); code != 200 {
		t.Fatalf("GET %s?%s = %d %s", path, filters.Encode(), code, e)
	}
	return page
}

func auditActions(p apitypes.AuditPage) []string {
	out := make([]string, len(p.Items))
	for i, e := range p.Items {
		out[i] = e.Action
	}
	return out
}

func findAudit(t *testing.T, p apitypes.AuditPage, action, targetID string) apitypes.AuditEntry {
	t.Helper()
	for _, e := range p.Items {
		if e.Action == action && (targetID == "" || e.TargetId == targetID) {
			return e
		}
	}
	t.Fatalf("no %s entry for %q in %v", action, targetID, auditActions(p))
	return apitypes.AuditEntry{}
}

// Actors and target names are resolved when the log is read: renamed targets
// show their current name, deleted ones the last name the log recorded.
func TestAuditActorsAndTargetLabels(t *testing.T) {
	env := newRAGEnv(t)
	owner := env.owner
	base := "/v1/teams/" + env.team

	var src apitypes.DataSource
	code, e := owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "open"}, &src, nil)
	mustCode(t, "source", code, e, 201, "")
	var kb, temp apitypes.KnowledgeBase
	owner.call("POST", base+"/kbs", map[string]any{"name": "Handbook"}, &kb, nil)
	owner.call("POST", base+"/kbs", map[string]any{"name": "Temp"}, &temp, nil)
	code, e = owner.call("PATCH", base+"/kbs/"+kb.Id.String(), map[string]any{"name": "Student handbook"}, nil, ifMatch(kb.Revision))
	mustCode(t, "rename kb", code, e, 200, "")
	code, e = owner.call("DELETE", base+"/kbs/"+temp.Id.String(), nil, nil, nil)
	mustCode(t, "delete kb", code, e, 200, "")
	var key apitypes.APIKeyCreated
	code, e = owner.call("POST", base+"/api-keys", map[string]any{"name": "loader", "kind": "service", "scopes": []string{"ingest"}}, &key, nil)
	mustCode(t, "key", code, e, 201, "")
	code, _, e = owner.uploadFiles(base+"/sources/"+src.Id.String()+"/documents", []upload{{"faq.md", []byte("# FAQ\n\nHello.")}}, key.Secret)
	mustCode(t, "key upload", code, e, 200, "")

	page := auditPage(t, owner, base+"/audit", nil)
	created := findAudit(t, page, "kb.create", kb.Id.String())
	if created.TargetLabel == nil || *created.TargetLabel != "Student handbook" || !created.TargetExists {
		t.Errorf("renamed kb label = %v exists=%v", created.TargetLabel, created.TargetExists)
	}
	for _, action := range []string{"kb.create", "kb.delete"} {
		gone := findAudit(t, page, action, temp.Id.String())
		if gone.TargetLabel == nil || *gone.TargetLabel != "Temp" || gone.TargetExists {
			t.Errorf("%s of a deleted kb: label = %v exists=%v", action, gone.TargetLabel, gone.TargetExists)
		}
	}
	human := findAudit(t, page, "source.create", src.Id.String())
	if human.Actor.Kind != "user" || human.Actor.Email == nil || *human.Actor.Email != "user@localhost" ||
		human.Actor.UserId == nil || *human.Actor.UserId != owner.me.User.Id || human.Actor.ApiKeyName != nil {
		t.Errorf("user actor = %+v", human.Actor)
	}
	if human.TargetLabel == nil || *human.TargetLabel != "Docs" {
		t.Errorf("source label = %v", human.TargetLabel)
	}
	byKey := findAudit(t, page, "document.upload", "")
	if byKey.Actor.Kind != "api_key" || byKey.Actor.ApiKeyName == nil || *byKey.Actor.ApiKeyName != "loader" {
		t.Errorf("api key actor = %+v", byKey.Actor)
	}
	keyEntry := findAudit(t, page, "apikey.create", key.Key.Id.String())
	if keyEntry.TargetLabel == nil || *keyEntry.TargetLabel != "loader" {
		t.Errorf("api key label = %v", keyEntry.TargetLabel)
	}

	// The platform log names teams, users and catalog objects too.
	all := auditPage(t, env.admin, "/v1/admin/audit", url.Values{"limit": {"200"}})
	team := findAudit(t, all, "team.create", "")
	if team.TargetLabel == nil || *team.TargetLabel != strings.ToUpper(env.team) {
		t.Errorf("team label = %v", team.TargetLabel)
	}
	for _, action := range []string{"platform.connection_create", "platform.model_create", "platform.embedding_profile_create"} {
		if e := findAudit(t, all, action, ""); e.TargetLabel == nil || !e.TargetExists {
			t.Errorf("%s label = %v", action, e.TargetLabel)
		}
	}
}

func TestAuditFilters(t *testing.T) {
	env := newRAGEnv(t)
	owner := env.owner
	base := "/v1/teams/" + env.team
	start := time.Now().UTC().Add(-time.Minute)

	var src apitypes.DataSource
	owner.call("POST", base+"/sources", map[string]any{"name": "Docs", "classification": "open"}, &src, nil)
	var kb apitypes.KnowledgeBase
	owner.call("POST", base+"/kbs", map[string]any{"name": "Handbook"}, &kb, nil)
	owner.call("PUT", base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, nil, nil)
	owner.call("POST", base+"/kbs", map[string]any{"name": "Second"}, nil, nil)

	only := func(p apitypes.AuditPage, check func(apitypes.AuditEntry) bool, want int, what string) {
		t.Helper()
		if want >= 0 && len(p.Items) != want {
			t.Fatalf("%s: %d entries %v, want %d", what, len(p.Items), auditActions(p), want)
		}
		for _, e := range p.Items {
			if !check(e) {
				t.Errorf("%s: unexpected %s on %s", what, e.Action, e.TargetType)
			}
		}
	}
	isAction := func(a string) func(apitypes.AuditEntry) bool {
		return func(e apitypes.AuditEntry) bool { return e.Action == a }
	}
	only(auditPage(t, owner, base+"/audit", url.Values{"action": {"kb.create"}}), isAction("kb.create"), 2, "exact action")
	only(auditPage(t, owner, base+"/audit", url.Values{"action": {"kb."}}),
		func(e apitypes.AuditEntry) bool { return strings.HasPrefix(e.Action, "kb.") }, 3, "action group")
	only(auditPage(t, owner, base+"/audit", url.Values{"targetType": {"data_source"}}), isAction("source.create"), 1, "target type")
	only(auditPage(t, owner, base+"/audit", url.Values{"action": {"kb."}, "targetType": {"knowledge_base"}, "actorUserId": {owner.me.User.Id.String()}}),
		func(e apitypes.AuditEntry) bool { return strings.HasPrefix(e.Action, "kb.") }, 3, "combined")
	// The team was created by the platform admin, not the owner.
	byAdmin := auditPage(t, owner, base+"/audit", url.Values{"actorUserId": {env.admin.me.User.Id.String()}})
	findAudit(t, byAdmin, "team.create", "")
	for _, e := range byAdmin.Items {
		if e.Actor.UserId == nil || *e.Actor.UserId != env.admin.me.User.Id {
			t.Errorf("actor filter returned %s by %+v", e.Action, e.Actor)
		}
	}
	only(auditPage(t, owner, base+"/audit", url.Values{"action": {"kb.create"}, "actorUserId": {env.admin.me.User.Id.String()}}), nil, 0, "no match")
	// "_" in a prefix is literal, not a LIKE wildcard.
	only(auditPage(t, owner, base+"/audit", url.Values{"action": {"k_."}}), nil, 0, "escaped prefix")

	// Time window: from is inclusive, to exclusive.
	future := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	only(auditPage(t, owner, base+"/audit", url.Values{"from": {future}}), nil, 0, "from future")
	only(auditPage(t, owner, base+"/audit", url.Values{"to": {start.Add(-time.Hour).Format(time.RFC3339)}}), nil, 0, "to past")
	only(auditPage(t, owner, base+"/audit", url.Values{"action": {"kb.create"}, "from": {start.Format(time.RFC3339Nano)}, "to": {future}}), isAction("kb.create"), 2, "window")

	// Paging keeps the filters.
	first := auditPage(t, owner, base+"/audit", url.Values{"action": {"kb."}, "limit": {"2"}})
	if len(first.Items) != 2 || first.NextCursor == nil {
		t.Fatalf("first page = %v %v", auditActions(first), first.NextCursor)
	}
	second := auditPage(t, owner, base+"/audit", url.Values{"action": {"kb."}, "limit": {"2"}, "cursor": {*first.NextCursor}})
	only(second, func(e apitypes.AuditEntry) bool { return strings.HasPrefix(e.Action, "kb.") }, 1, "second page")

	// excludeAction hides a group (the admin Logs hide sign-ins by default).
	only(auditPage(t, env.admin, "/v1/admin/audit", url.Values{"excludeAction": {"auth."}}),
		func(e apitypes.AuditEntry) bool { return !strings.HasPrefix(e.Action, "auth.") }, -1, "exclude sign-ins")
	if n := len(auditPage(t, env.admin, "/v1/admin/audit", url.Values{"action": {"auth."}}).Items); n == 0 {
		t.Error("expected sign-ins in the platform log")
	}

	// The platform log takes the same filters across teams.
	only(auditPage(t, env.admin, "/v1/admin/audit", url.Values{"action": {"platform."}, "targetType": {"model"}}), isAction("platform.model_create"), 1, "admin filters")

	for _, bad := range []struct{ query, code string }{
		{"action=kb", "invalid_action"},
		{"action=KB.create", "invalid_action"},
		{"excludeAction=auth.login", "invalid_action"},
		{"actorUserId=someone", "invalid_actor"},
		{"targetType=Knowledge-Base", "invalid_target_type"},
		{"from=yesterday", "invalid_range"},
		{"from=" + future + "&to=" + future, "invalid_range"},
	} {
		code, e := owner.call("GET", base+"/audit?"+strings.ReplaceAll(bad.query, "+", "%2B"), nil, nil, nil)
		mustCode(t, bad.query, code, e, 400, bad.code)
	}
}

// Widget keys, moderation policies and platform settings have live labels
// (not "(deleted)"), and a widget key names its agent for linking.
func TestAuditLabelsForPublishingTargets(t *testing.T) {
	env := newPublishEnv(t)
	pub := env.publicAgent(t, "Open help")
	var key apitypes.PublishableKeyCreated
	code, e := env.tadmin.call("POST", env.base+"/agents/"+pub.Id.String()+"/publishable-keys",
		map[string]any{"name": "Main site", "allowedOrigins": []string{"https://www.example.edu"}}, &key, nil)
	mustCode(t, "create key", code, e, 201, "")

	team := auditPage(t, env.owner, env.base+"/audit", nil)
	k := findAudit(t, team, "agent.publishable_key_create", key.Id.String())
	if k.TargetLabel == nil || *k.TargetLabel != "Main site" || !k.TargetExists {
		t.Errorf("key label = %v exists=%v", k.TargetLabel, k.TargetExists)
	}
	if k.Parent == nil || k.Parent.Type != "agent" || k.Parent.Id != pub.Id || !k.Parent.Exists ||
		k.Parent.Label == nil || *k.Parent.Label != "Open help" {
		t.Errorf("key parent = %+v", k.Parent)
	}

	all := auditPage(t, env.admin, "/v1/admin/audit", url.Values{"limit": {"200"}})
	for action, want := range map[string]string{
		"platform.moderation_policy_update": "Public moderation policy",
		"platform.public_access":            "Public access",
	} {
		if e := findAudit(t, all, action, ""); e.TargetLabel == nil || *e.TargetLabel != want || !e.TargetExists {
			t.Errorf("%s label = %v exists=%v, want %q", action, e.TargetLabel, e.TargetExists, want)
		}
	}
}
