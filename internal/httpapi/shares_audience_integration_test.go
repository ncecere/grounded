package httpapi_test

import (
	"net/url"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Who a shared conversation is for, and what closes it (v0.6.0, C12).

func TestSharedConversationAudiences(t *testing.T) {
	env := newShareEnv(t)
	pub := env.publicAgent(t, "Open help")
	conv := env.ask(t, env.member, pub.Slug, "", "Where do students buy a parking permit?")
	answer := env.detail(t, env.member, conv).Messages[1].Id.String()

	// For the agent's users: any signed-in person may chat with a public agent, so any may open it; with no session, no.
	forUsers := env.share(t, env.member, conv, "agent_users", false)
	code, v, e := env.view(env.auditor, forUsers.Token)
	mustCode(t, "signed in, public agent, agent_users", code, e, 200, "")
	if v.Audience != "agent_users" || v.Owner {
		t.Errorf("view = %+v", v)
	}
	code, _, e = env.viewAnon(forUsers.Token)
	mustCode(t, "no session, agent_users", code, e, 401, "sign_in_required")

	// Open to anyone: a public agent's link needs no session, and its sources open the same way. The cited sources are only what the answer cited.
	anyone := env.share(t, env.member, conv, "anyone", false)
	code, v, e = env.viewAnon(anyone.Token)
	mustCode(t, "no session, anyone", code, e, 200, "")
	if v.Audience != "anyone" || v.Owner || len(v.Messages) != 2 || v.SharedBy != "" {
		t.Errorf("anonymous view = %+v", v)
	}
	if code, e := env.anon.call("GET", "/v1/shared/"+anyone.Token+"/messages/"+answer+"/sources/1", nil, nil); code != 200 {
		t.Errorf("an anonymous source = %d %s", code, e)
	}
	if code, e := env.anon.call("GET", "/v1/shared/"+anyone.Token+"/messages/"+answer+"/sources/99", nil, nil); code != 404 || e != "source_not_found" {
		t.Errorf("an anonymous source it does not cite = %d %s", code, e)
	}

	// Public access off: nobody outside the team opens it (the link does not carry the switch), the team's own people still do; back on, it works.
	env.setPublic(t, false)
	code, _, e = env.viewAnon(anyone.Token)
	mustCode(t, "anonymous, public access off", code, e, 401, "sign_in_required")
	code, _, e = env.view(env.auditor, forUsers.Token)
	mustCode(t, "signed in outside the team, public access off", code, e, 404, "share_not_found")
	if code, _, _ := env.view(env.editor, forUsers.Token); code != 200 {
		t.Errorf("a team member with public access off = %d", code)
	}
	code, e = env.member.call("POST", "/v1/conversations/"+conv+"/shares", map[string]any{"audience": "anyone"}, nil, nil)
	mustCode(t, "a new anyone link, public access off", code, e, 409, "public_share_unavailable")
	env.setPublic(t, true)
	if code, _, _ := env.viewAnon(anyone.Token); code != 200 {
		t.Errorf("anonymous, public access back on = %d", code)
	}

	// The agent narrowed to its team: the link follows the agent's audience, as chatting does.
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["audience"] = "team"
	var cur apitypes.Agent
	env.tadmin.get(env.base+"/agents/"+pub.Id.String(), &cur)
	code, e = env.tadmin.call("PATCH", env.base+"/agents/"+pub.Id.String(), map[string]any{"config": cfg}, nil, ifMatch(int64(cur.Revision)))
	mustCode(t, "narrow the draft", code, e, 200, "")
	if code, raw := env.publish(env.tadmin, pub); code != 201 {
		t.Fatalf("publish for the team = %d %s", code, raw)
	}
	code, _, e = env.viewAnon(anyone.Token)
	mustCode(t, "anonymous, agent now for the team", code, e, 401, "sign_in_required")
	code, _, e = env.view(env.auditor, forUsers.Token)
	mustCode(t, "outside the team, agent now for the team", code, e, 404, "share_not_found")
	if code, _, _ := env.view(env.tadmin, anyone.Token); code != 200 {
		t.Errorf("a team member, agent now for the team = %d", code)
	}
}

func TestSharedConversationClosesWithItsAgent(t *testing.T) {
	env := newShareEnv(t)
	ag := env.publishAgent(t, "Parking help", env.agentConfig(env.kb.Id.String()))
	conv := env.ask(t, env.member, ag.Slug, "", "Where do students buy a parking permit?")
	made := env.share(t, env.member, conv, "agent_users", false)
	opens := func() int { c, _, _ := env.view(env.editor, made.Token); return c }
	if opens() != 200 {
		t.Fatal("the link does not open")
	}

	// Disabled by the team: closed, no new links; enabled again: open.
	code, e := env.tadmin.call("POST", env.base+"/agents/"+ag.Id.String()+"/status", map[string]any{"status": "disabled_by_team", "reason": "Under review"}, nil, nil)
	mustCode(t, "disable", code, e, 200, "")
	if c := opens(); c != 404 {
		t.Errorf("a disabled agent's link = %d, want 404", c)
	}
	code, e = env.member.call("POST", "/v1/conversations/"+conv+"/shares", map[string]any{"audience": "agent_users"}, nil, nil)
	mustCode(t, "a link to a disabled agent's conversation", code, e, 409, "agent_unavailable")
	code, e = env.tadmin.call("POST", env.base+"/agents/"+ag.Id.String()+"/status", map[string]any{"status": "active"}, nil, nil)
	mustCode(t, "enable", code, e, 200, "")
	if c := opens(); c != 200 {
		t.Errorf("an enabled agent's link = %d, want 200", c)
	}

	// Disabled by the platform, the same.
	code, e = env.admin.call("POST", "/v1/admin/agents/"+ag.Id.String()+"/status", map[string]any{"status": "disabled_by_platform", "reason": "Platform review"}, nil, nil)
	mustCode(t, "disable by the platform", code, e, 200, "")
	if c := opens(); c != 404 {
		t.Errorf("a link of an agent the platform disabled = %d, want 404", c)
	}
	code, e = env.admin.call("POST", "/v1/admin/agents/"+ag.Id.String()+"/status", map[string]any{"status": "active"}, nil, nil)
	mustCode(t, "enable by the platform", code, e, 200, "")

	// Deleted: closed for good.
	code, e = env.tadmin.call("DELETE", env.base+"/agents/"+ag.Id.String(), nil, nil, nil)
	mustCode(t, "delete the agent", code, e, 200, "")
	if c := opens(); c != 404 {
		t.Errorf("a deleted agent's link = %d, want 404", c)
	}
}

func TestSharedUseOfASensitiveAgentIsLogged(t *testing.T) {
	env := newShareEnv(t)
	kb := env.sensitiveKB(t)
	sens := env.publishAgent(t, "Advising", env.agentConfig(kb.Id.String()))
	open := env.publishAgent(t, "Parking help", env.agentConfig(env.kb.Id.String()))
	sc := env.ask(t, env.member, sens.Slug, "", "When are advisors in?")
	oc := env.ask(t, env.member, open.Slug, "", "Where do students buy a parking permit?")
	sTok := env.share(t, env.member, sc, "agent_users", false).Token
	oTok := env.share(t, env.member, oc, "agent_users", false).Token
	logged := func(agent string) int64 {
		return env.scalar(t, `SELECT count(*) FROM access_log WHERE agent_id = $1 AND channel = 'shared'`, agent)
	}

	// The owner's own reading was logged when the chat happened; reading someone's shared answer of a Sensitive agent is a use, as chatting is.
	env.view(env.member, sTok)
	if n := logged(sens.Id.String()); n != 0 {
		t.Errorf("the owner opening their own link logged %d entries", n)
	}
	env.view(env.editor, sTok)
	env.view(env.tadmin, sTok)
	if n := logged(sens.Id.String()); n != 2 {
		t.Errorf("access log entries for two readers = %d, want 2", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM access_log WHERE agent_id = $1 AND channel = 'shared' AND user_id = $2::uuid AND rank = 1`, sens.Id.String(), env.editor.me.User.Id.String()); n != 1 {
		t.Errorf("the entry does not name the reader and the agent's rank: %d", n)
	}
	// Opening a source is not another use; an Open agent leaves no entry; a refused reader is not logged.
	answer := env.detail(t, env.member, sc).Messages[1].Id.String()
	env.source(env.editor, sTok, answer, 1)
	env.view(env.editor, oTok)
	env.view(env.auditor, sTok)
	if n, o := logged(sens.Id.String()), logged(open.Id.String()); n != 2 || o != 0 {
		t.Errorf("entries: sensitive %d (want 2), open %d (want 0)", n, o)
	}
}

func TestShareAuditNamesNoTeamAgentOrConversation(t *testing.T) {
	env := newShareEnv(t)
	ag := env.publishAgent(t, "Parking help", env.agentConfig(env.kb.Id.String()))
	conv := env.ask(t, env.member, ag.Slug, "", "Where do students buy a parking permit?")
	a := env.share(t, env.member, conv, "agent_users", false)
	b := env.share(t, env.member, conv, "agent_users", true)
	code, e := env.member.call("DELETE", "/v1/conversations/"+conv+"/shares/"+a.Share.Id.String(), nil, nil, nil)
	mustCode(t, "revoke", code, e, 200, "")

	// Platform log: that a link was made or revoked, by whom, and its audience: no team, no agent, no conversation, no content.
	for action, want := range map[string]int64{"conversation_share.create": 2, "conversation_share.revoke": 1} {
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = $1 AND team_id IS NULL AND target_type = 'conversation_share'
			AND actor_user_id = $2::uuid AND (metadata - 'audience' - 'showName') = '{}'::jsonb AND before_state IS NULL AND after_state IS NULL`, action, env.member.me.User.Id.String()); n != want {
			t.Errorf("%s entries = %d, want %d", action, n, want)
		}
	}
	for _, secret := range []string{conv, ag.Id.String(), env.team, "parking", "Parking help", a.Token, b.Token} {
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action LIKE 'conversation_share.%' AND lower(row_to_json(audit_log)::text) LIKE '%' || lower($1) || '%'`, secret); n != 0 {
			t.Errorf("the audit log names %q", secret)
		}
	}
	// Teams see none of it: not in their own audit log.
	page := auditPage(t, env.owner, env.base+"/audit", url.Values{"limit": {"200"}})
	for _, it := range page.Items {
		if strings.HasPrefix(string(it.Action), "conversation_share.") {
			t.Errorf("the team's audit log shows %s", it.Action)
		}
	}
	// The platform's log shows the entries, labelled without naming what they are links to.
	all := auditPage(t, env.admin, "/v1/admin/audit", url.Values{"limit": {"200"}})
	e1 := findAudit(t, all, "conversation_share.create", b.Share.Id.String())
	if e1.TargetLabel == nil || *e1.TargetLabel != "Shared conversation" || !e1.TargetExists {
		t.Errorf("the platform log's label = %v exists=%v", e1.TargetLabel, e1.TargetExists)
	}
}
