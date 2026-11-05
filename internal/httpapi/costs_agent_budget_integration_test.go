package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Per-agent budgets (docs/specs/agent-budgets/DESIGN.md): the team's owners and admins set them; in Track only they show
// progress and refuse nothing; in Enforce an agent over its own budget is refused in every channel while the team's other
// agents and retrieval go on; the owners are notified once per agent; raising the budget brings it back at once.
func TestAgentBudgets(t *testing.T) {
	env := newPublishEnv(t)
	admin, owner, member := env.admin, env.owner, env.member
	one := env.publishAgent(t, "Budget one", env.agentConfig(env.kb.Id.String()))
	two := env.publishAgent(t, "Budget two", env.agentConfig(env.kb.Id.String()))
	pub := env.publicAgent(t, "Open help")
	budget := func(id string) string { return env.base + "/agents/" + id + "/budget" }
	set := func(s *session, id string, amount any, rev int64) (int, string, apitypes.AgentBudget) {
		var out apitypes.AgentBudget
		code, e := s.call("PUT", budget(id), map[string]any{"amount": amount}, &out, ifMatch(rev))
		return code, e, out
	}

	// Off: nothing to see.
	if code, e := owner.call("GET", budget(one.Id.String()), nil, nil, nil); code != 404 || e != "costs_off" {
		t.Fatalf("agent budget while off = %d %s", code, e)
	}
	today := time.Now().UTC().Format(time.DateOnly)
	code, e := admin.call("POST", "/v1/admin/models/"+env.chat.Id.String()+"/prices", map[string]any{"effectiveFrom": today,
		"prices": []any{map[string]any{"unit": "chat_tokens_in", "price": "1000000"}, map[string]any{"unit": "chat_tokens_out", "price": "1000000"}}}, nil, nil)
	mustCode(t, "prices", code, e, 201, "")
	setCostSettings(t, admin, "track")
	if code, raw := chatOnce(t, member, env.chatPath(one.Slug)); code != 200 {
		t.Fatalf("first chat = %d %s", code, raw)
	}

	// Owners and admins set it; members can't see it; a stale revision is refused.
	if code, _ := member.call("GET", budget(one.Id.String()), nil, nil, nil); code != 403 {
		t.Fatalf("member read = %d", code)
	}
	if code, _, _ := set(member, one.Id.String(), "1.00", 1); code != 403 {
		t.Fatalf("member write = %d", code)
	}
	code, e, b := set(owner, one.Id.String(), "0.000001", 1)
	mustCode(t, "set", code, e, 200, "")
	if b.Revision != 2 || b.Enforced || b.State != "exhausted" || b.Amount == nil || *b.Amount != "0.000001" {
		t.Fatalf("tracked budget = %+v", b)
	}
	if code, _, _ := set(owner, one.Id.String(), "2.00", 1); code != 412 {
		t.Fatalf("stale revision = %d", code)
	}
	// Track only: progress, never a refusal.
	if code, raw := chatOnce(t, member, env.chatPath(one.Slug)); code != 200 {
		t.Fatalf("chat over a tracked agent budget = %d %s", code, raw)
	}

	// Enforce, with room in the team's budget: only the agent over its own stops.
	setCostSettings(t, admin, "enforce")
	setTeamBudget(t, admin, env.team, "inherit", "100000000")
	code, raw := chatOnce(t, member, env.chatPath(one.Slug))
	var be budgetError
	_ = json.Unmarshal(raw, &be)
	if code != 429 || be.Error.Code != "agent_budget_exhausted" || be.Error.Details.Budget != "0.000001" || strings.Contains(be.Error.Message, "0.000001") {
		t.Fatalf("chat over the agent budget = %d %s", code, raw)
	}
	if code, raw := chatOnce(t, member, env.chatPath(two.Slug)); code != 200 {
		t.Fatalf("another agent = %d %s", code, raw)
	}
	if code, raw := owner.raw("POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve", map[string]any{"query": "parking"}, nil); code != 200 {
		t.Fatalf("retrieval = %d %s", code, raw)
	}
	var sp apitypes.TeamSpend
	if code := owner.get(env.base+"/spend", &sp); code != 200 || len(sp.AgentBudgets) != 1 || !sp.AgentBudgets[0].Enforced || sp.AgentBudgets[0].State != "exhausted" {
		t.Fatalf("spend's agent budgets = %d %+v", code, sp.AgentBudgets)
	}

	// Anonymous visitors of a public agent over its budget see the generic notice.
	code, e, _ = set(owner, pub.Id.String(), "0", 1)
	mustCode(t, "public agent budget", code, e, 200, "")
	v := newVisitor(t, env.app.URL)
	if code, e := v.start(pub.Id, "", ""); code != 201 {
		t.Fatalf("public session = %d %s", code, e)
	}
	if code, _, e := v.ask(pub.Id, "Where do students buy a parking permit?"); code != 503 || e != "agent_unavailable" {
		t.Fatalf("anonymous chat over the agent budget = %d %s", code, e)
	}

	// Notified once per agent, month and level.
	chatOnce(t, member, env.chatPath(one.Slug))
	if n := env.scalar(t, `SELECT count(*) FROM notification_events WHERE type = 'team.budget_exhausted' AND data->>'agentId' = $1`, one.Id.String()); n != 1 {
		t.Fatalf("agent budget events = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM notification_events WHERE type = 'team.budget_exhausted' AND data->>'agentId' IS NULL`); n != 0 {
		t.Fatal("the team was told its own budget is used up")
	}

	// Raising it brings the agent back at once; removing it leaves the team's budget only.
	code, e, b = set(owner, one.Id.String(), "100000000", 2)
	mustCode(t, "raise", code, e, 200, "")
	if code, raw := chatOnce(t, member, env.chatPath(one.Slug)); code != 200 {
		t.Fatalf("chat after raising = %d %s", code, raw)
	}
	code, e, b = set(admin, one.Id.String(), nil, b.Revision)
	mustCode(t, "remove (platform admin)", code, e, 200, "")
	if b.Amount != nil || b.Revision != 1 || b.State != "none" {
		t.Fatalf("removed = %+v", b)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'costs.agent_budget_update'`); n != 4 {
		t.Fatalf("audit entries = %d", n)
	}
}
