package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Agent templates (v0.6.0, C4): starting points for a new agent.

func (env *agentEnv) templates(t *testing.T, s *session) []apitypes.AgentTemplate {
	t.Helper()
	var list []apitypes.AgentTemplate
	if code := s.get("/v1/agent-templates", &list); code != 200 {
		t.Fatalf("list templates = %d", code)
	}
	return list
}

// templateAuditLabel is how the platform audit log names a template now, and whether it still exists.
func templateAuditLabel(t *testing.T, admin *session, action, id string) (string, bool) {
	t.Helper()
	e := findAudit(t, auditPage(t, admin, "/v1/admin/audit", url.Values{"limit": {"200"}}), action, id)
	label := ""
	if e.TargetLabel != nil {
		label = *e.TargetLabel
	}
	return label, e.TargetExists
}

func findTemplate(list []apitypes.AgentTemplate, name string) *apitypes.AgentTemplate {
	for i := range list {
		if list[i].Name == name {
			return &list[i]
		}
	}
	return nil
}

func TestAgentTemplatesAccessAndCreate(t *testing.T) {
	env := newAgentEnv(t)

	// Who may list: anyone who can make an agent, and platform staff; a plain member cannot.
	for name, s := range map[string]*session{"editor": env.editor, "team admin": env.tadmin, "owner": env.owner, "platform admin": env.admin, "auditor": env.auditor} {
		list := env.templates(t, s)
		if len(list) < 5 || !list[0].BuiltIn || list[0].Id != "service-desk-faq" || list[0].Name != "Service desk FAQ" {
			t.Fatalf("%s sees %d templates, first %+v", name, len(list), list[0])
		}
		for _, tm := range list[:5] {
			if !tm.BuiltIn || len(tm.Config.Kbs) != 0 || tm.Config.Audience != "team" || tm.Config.ChatModelId != nil || tm.Config.Instructions == "" {
				t.Errorf("%s: built-in %s = %+v", name, tm.Id, tm)
			}
		}
	}
	if code, e := env.member.call("GET", "/v1/agent-templates", nil, nil, nil); code != 403 {
		t.Errorf("a plain member listing templates = %d %s, want 403", code, e)
	}
	anon := &session{t: t, app: env.app, client: &http.Client{}}
	if code, _ := anon.call("GET", "/v1/agent-templates", nil, nil, nil); code != 401 {
		t.Errorf("anonymous listing templates = %d, want 401", code)
	}

	// An API key never lists templates, even a personal one made by an editor: they are for people signing in.
	key := createKey(t, env.editor, env.base, map[string]any{"name": "templates", "scopes": []string{"query"}})
	req, _ := http.NewRequest("GET", env.app.URL+"/v1/agent-templates", nil)
	req.Header.Set("Authorization", "Bearer "+key.Secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	// 401: the route wants a session. The service refuses a delegated caller too (defense in depth), so either is a refusal.
	if res.StatusCode != 401 && res.StatusCode != 403 {
		t.Errorf("an API key listing templates = %d, want 401 or 403", res.StatusCode)
	}

	// Create from a built-in template: its settings and look are the start, the request's knowledge base and model are added.
	svc := findTemplate(env.templates(t, env.editor), "Service desk FAQ")
	var ag apitypes.Agent
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{
		"name": "Help desk", "templateId": "service-desk-faq",
		"config": map[string]any{"chatModelId": env.chat.Id, "kbs": []map[string]any{{"kbId": env.kb.Id}}},
	}, &ag, nil)
	mustCode(t, "create from template", code, e, 201, "")
	if ag.Draft.Instructions != svc.Config.Instructions || ag.Draft.RefusalMessage != svc.Config.RefusalMessage ||
		ag.WelcomeMessage != svc.WelcomeMessage || len(ag.StarterQuestions) != 3 || ag.Description != "" {
		t.Errorf("the agent did not start from the template: %+v", ag)
	}
	if len(ag.Draft.Kbs) != 1 || ag.Draft.Kbs[0].KbId != env.kb.Id || ag.Draft.ChatModelId == nil || *ag.Draft.ChatModelId != env.chat.Id || ag.Draft.Audience != "team" {
		t.Errorf("the request's knowledge base and model were lost: %+v", ag.Draft)
	}
	// It is a real agent: it publishes without further changes.
	var v apitypes.AgentVersion
	code, e = env.editor.call("POST", env.base+"/agents/"+ag.Id.String()+"/publish", map[string]any{"note": "from a template"}, &v, nil)
	mustCode(t, "publish an agent made from a template", code, e, 201, "")
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'agent.create' AND target_id = $1 AND metadata->>'templateId' = 'service-desk-faq'`, ag.Id.String()); n != 1 {
		t.Errorf("the audit entry does not name the template (%d)", n)
	}

	// What the request names replaces the template's, key by key.
	code, e = env.editor.call("POST", env.base+"/agents", map[string]any{
		"name": "Own words", "templateId": "policy-explainer", "welcomeMessage": "Hello from us.", "starterQuestions": []string{"One?"},
		"config": map[string]any{"instructions": "Only my instructions.", "strictlyGrounded": false},
	}, &ag, nil)
	mustCode(t, "create with overrides", code, e, 201, "")
	pol := findTemplate(env.templates(t, env.editor), "Policy explainer")
	if ag.WelcomeMessage != "Hello from us." || len(ag.StarterQuestions) != 1 || ag.Draft.Instructions != "Only my instructions." || ag.Draft.StrictlyGrounded {
		t.Errorf("overrides were not applied: %+v", ag)
	}
	if ag.Draft.RefusalMessage != pol.Config.RefusalMessage || ag.Draft.Temperature == nil || *ag.Draft.Temperature != 0.2 {
		t.Errorf("keys the request did not name must keep the template's: %+v", ag.Draft)
	}

	// An unknown template, and a request's own bad config, are refused with their own errors; a refused create leaves no agent.
	before := env.scalar(t, `SELECT count(*) FROM agents`)
	for _, id := range []string{"no-such-template", "3f0e1d2c-0000-4000-8000-000000000000", "../x"} {
		code, e = env.editor.call("POST", env.base+"/agents", map[string]any{"name": "X", "templateId": id}, nil, nil)
		mustCode(t, "unknown template "+id, code, e, 404, "template_not_found")
	}
	code, e = env.editor.call("POST", env.base+"/agents", map[string]any{"name": "X", "templateId": "course-helper", "config": map[string]any{"nope": 1}}, nil, nil)
	mustCode(t, "bad config over a template", code, e, 400, "invalid_config")
	if n := env.scalar(t, `SELECT count(*) FROM agents`); n != before {
		t.Errorf("refused creates left %d agents", n-before)
	}
	// A member cannot make agents at all, with or without a template.
	code, e = env.member.call("POST", env.base+"/agents", map[string]any{"name": "X", "templateId": "course-helper"}, nil, nil)
	mustCode(t, "member creates from a template", code, e, 403, "forbidden")
}

func TestSaveAsTemplateAndManage(t *testing.T) {
	env := newAgentEnv(t)
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["instructions"], cfg["temperature"], cfg["audience"] = "Always answer in two sentences.", 0.3, "all_authenticated"
	var src apitypes.Agent
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{
		"name": "Registrar", "description": "Answers registration questions.", "accentColor": "#1a56db", "welcomeMessage": "Ask the registrar.",
		"starterQuestions": []string{"When does registration open?"}, "config": cfg,
	}, &src, nil)
	mustCode(t, "source agent", code, e, 201, "")
	save := env.base + "/agents/" + src.Id.String() + "/save-as-template"

	// Reading a team's agent configuration needs ordinary access to it (ADR-0011): a platform admin who is not on the team gets a 404, and
	// only platform admins save templates at all.
	code, e = env.admin.call("POST", save, map[string]any{"name": "Registrar"}, nil, nil)
	mustCode(t, "platform admin outside the team", code, e, 404, "team_not_found")
	for name, s := range map[string]*session{"owner": env.owner, "team admin": env.tadmin, "editor": env.editor, "member": env.member, "auditor": env.auditor} {
		code, e = s.call("POST", save, map[string]any{"name": "Registrar"}, nil, nil)
		if code != 403 && code != 404 {
			t.Errorf("%s saving a template = %d %s", name, code, e)
		}
	}
	if n := env.scalar(t, `SELECT count(*) FROM agent_templates`); n != 0 {
		t.Fatalf("a refused save left %d templates", n)
	}

	// On the team as a plain member, an admin may read the agent but not change it: still no.
	code, e = env.owner.call("POST", env.base+"/members", map[string]string{"email": "admin@localhost", "role": "member"}, nil, nil)
	mustCode(t, "add the platform admin as a member", code, e, 201, "")
	env.admin.refresh()
	code, e = env.admin.call("POST", save, map[string]any{"name": "Registrar"}, nil, nil)
	mustCode(t, "platform admin who is only a member", code, e, 403, "forbidden")
	code, e = env.owner.call("DELETE", env.base+"/members/"+env.admin.me.User.Id.String(), nil, nil, nil)
	mustCode(t, "remove the platform admin again", code, e, 200, "")

	// Once the platform admin is an editor of the team, saving works.
	code, e = env.owner.call("POST", env.base+"/members", map[string]string{"email": "admin@localhost", "role": "editor"}, nil, nil)
	mustCode(t, "add the platform admin to the team", code, e, 201, "")
	env.admin.refresh()
	var tm apitypes.AgentTemplate
	code, e = env.admin.call("POST", save, map[string]any{"name": "Registrar helper"}, &tm, nil)
	mustCode(t, "save as template", code, e, 201, "")
	if tm.BuiltIn || tm.Name != "Registrar helper" || tm.Description != "Answers registration questions." || tm.AccentColor != "#1a56db" ||
		tm.WelcomeMessage != "Ask the registrar." || len(tm.StarterQuestions) != 1 || tm.CreatedAt == nil {
		t.Errorf("template = %+v", tm)
	}
	if tm.Config.Instructions != "Always answer in two sentences." || tm.Config.Temperature == nil || *tm.Config.Temperature != 0.3 ||
		tm.Config.ChatModelId == nil || *tm.Config.ChatModelId != env.chat.Id {
		t.Errorf("the settings were not carried: %+v", tm.Config)
	}
	// Never what it answers from, the tools, or who may use it: not in the API's answer, and not in the stored row.
	raw, _ := json.Marshal(env.templates(t, env.owner))
	tools := 0
	if tm.Config.Tools != nil {
		tools = len(*tm.Config.Tools)
	}
	if len(tm.Config.Kbs) != 0 || tools != 0 || tm.Config.Audience != "team" || strings.Contains(string(raw), env.kb.Id.String()) {
		t.Errorf("a template carries what it must not: kbs %d, tools %d, audience %s", len(tm.Config.Kbs), tools, tm.Config.Audience)
	}
	if n := env.scalar(t, `SELECT count(*) FROM agent_templates WHERE config::text LIKE '%' || $1 || '%' OR config->>'audience' <> 'team'`, env.kb.Id.String()); n != 0 {
		t.Errorf("the stored template carries a knowledge base or an audience (%d)", n)
	}
	// The team's own audit log shows its agent was copied; the template keeps no link to the agent.
	if n := env.scalar(t, `SELECT count(*) FROM audit_log a JOIN teams t ON t.id = a.team_id WHERE a.action = 'agent_template.create' AND t.slug = $1
		AND a.metadata->>'sourceAgentId' = $2`, env.team, src.Id.String()); n != 1 {
		t.Errorf("the team's audit log has %d entries for the copy", n)
	}

	// The audit log names the template as it is now (the target types are checked against ListAudit's labels by internal/audit).
	if label, exists := templateAuditLabel(t, env.admin, "agent_template.create", tm.Id); label != "Registrar helper" || !exists {
		t.Errorf("audit label after saving = %q exists=%v", label, exists)
	}

	// Names are unique, ignoring case, and the built-in names are taken.
	for _, name := range []string{"registrar HELPER", "service desk faq", ""} {
		code, e = env.admin.call("POST", save, map[string]any{"name": name}, nil, nil)
		if name == "" {
			mustCode(t, "empty name", code, e, 400, "invalid_name")
		} else {
			mustCode(t, "duplicate name "+name, code, e, 409, "template_name_taken")
		}
	}

	// Everyone who can make an agent now sees it, and can start an agent from it.
	if got := findTemplate(env.templates(t, env.editor), "Registrar helper"); got == nil || got.Id != tm.Id {
		t.Fatalf("the editor does not see the saved template: %+v", got)
	}
	var made apitypes.Agent
	code, e = env.editor.call("POST", env.base+"/agents", map[string]any{"name": "Records", "templateId": tm.Id}, &made, nil)
	mustCode(t, "create from the saved template", code, e, 201, "")
	if made.Draft.Instructions != tm.Config.Instructions || made.WelcomeMessage != tm.WelcomeMessage || len(made.Draft.Kbs) != 0 || made.Draft.Audience != "team" {
		t.Errorf("agent from the saved template = %+v", made)
	}

	// Management: only platform admins; a built-in cannot change; a saved one renames and describes.
	path := "/v1/admin/agent-templates/" + tm.Id
	for name, s := range map[string]*session{"owner": env.owner, "auditor": env.auditor, "editor": env.editor} {
		if code, _ := s.call("PATCH", path, map[string]any{"name": "Hijacked"}, nil, nil); code != 403 {
			t.Errorf("%s renaming = %d, want 403", name, code)
		}
		if code, _ := s.call("DELETE", path, nil, nil, nil); code != 403 {
			t.Errorf("%s deleting = %d, want 403", name, code)
		}
	}
	for _, m := range []struct{ method, body string }{{"PATCH", "x"}, {"DELETE", ""}} {
		var b any
		if m.body != "" {
			b = map[string]any{"name": "Renamed built-in"}
		}
		code, e = env.admin.call(m.method, "/v1/admin/agent-templates/service-desk-faq", b, nil, nil)
		mustCode(t, m.method+" a built-in", code, e, 409, "template_builtin")
	}
	var renamed apitypes.AgentTemplate
	code, e = env.admin.call("PATCH", path, map[string]any{"name": "Registrar v2", "description": "Short answers."}, &renamed, nil)
	mustCode(t, "rename", code, e, 200, "")
	if renamed.Name != "Registrar v2" || renamed.Description != "Short answers." || renamed.Config.Instructions != tm.Config.Instructions {
		t.Errorf("renamed = %+v", renamed)
	}
	if label, exists := templateAuditLabel(t, env.admin, "agent_template.update", tm.Id); label != "Registrar v2" || !exists {
		t.Errorf("audit label after renaming = %q exists=%v, want the new name", label, exists)
	}
	code, e = env.admin.call("PATCH", path, map[string]any{"name": "Service Desk FAQ"}, nil, nil)
	mustCode(t, "rename onto a built-in name", code, e, 409, "template_name_taken")
	code, e = env.admin.call("PATCH", "/v1/admin/agent-templates/"+"3f0e1d2c-0000-4000-8000-000000000000", map[string]any{"name": "X"}, nil, nil)
	mustCode(t, "rename an unknown template", code, e, 404, "template_not_found")

	// Delete: the agents made from it keep their own copy.
	code, e = env.admin.call("DELETE", path, nil, nil, nil)
	mustCode(t, "delete", code, e, 200, "")
	if _, exists := templateAuditLabel(t, env.admin, "agent_template.delete", tm.Id); exists {
		t.Error("the audit log says a deleted template still exists")
	}
	if findTemplate(env.templates(t, env.editor), "Registrar v2") != nil {
		t.Error("a deleted template is still listed")
	}
	code, e = env.admin.call("DELETE", path, nil, nil, nil)
	mustCode(t, "delete twice", code, e, 404, "template_not_found")
	code, e = env.editor.call("POST", env.base+"/agents", map[string]any{"name": "Late", "templateId": tm.Id}, nil, nil)
	mustCode(t, "create from a deleted template", code, e, 404, "template_not_found")
	var kept apitypes.Agent
	if code := env.editor.get(env.base+"/agents/"+made.Id.String(), &kept); code != 200 || kept.Draft.Instructions != tm.Config.Instructions {
		t.Errorf("an agent made from the deleted template lost its instructions: %d %+v", code, kept.Draft)
	}
	for _, action := range []string{"agent_template.create", "agent_template.update", "agent_template.delete"} {
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = $1 AND target_id = $2`, action, tm.Id); n != 1 {
			t.Errorf("%s: %d audit entries", action, n)
		}
	}
}
