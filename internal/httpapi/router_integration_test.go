package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Router agents (v0.6.0, C5; docs/specs/v0.6.0/DESIGN.md §4): a router sends each question to the best agent the asker may chat with.

type routerEnv struct {
	*shareEnv
	s1 *systemOneEnv
}

func newRouterEnv(t *testing.T) *routerEnv {
	t.Helper()
	sh := newShareEnv(t)
	s1 := &systemOneEnv{agentEnv: sh.agentEnv}
	code, e := s1.admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": s1.conn.Id, "key": "jev", "upstreamModel": "jev-latest", "displayName": "Judge", "kind": "systemone", "maxClassification": "sensitive",
	}, &s1.judge, nil)
	mustCode(t, "SystemOne model", code, e, 201, "")
	s1.putChecks(t, map[string]any{"enabled": false}, map[string]any{"enabled": true})
	return &routerEnv{shareEnv: sh, s1: s1}
}

// target publishes an agent routers may reach, with a description the routing question reads.
func (env *routerEnv) target(t *testing.T, name, description string, extra map[string]any) apitypes.Agent {
	t.Helper()
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["routable"] = true
	for k, v := range extra {
		cfg[k] = v
	}
	var ag apitypes.Agent
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": name, "description": description, "config": cfg}, &ag, nil)
	mustCode(t, "create "+name, code, e, 201, "")
	publisher := env.editor
	if cfg["audience"] != nil && cfg["audience"] != "team" {
		publisher = env.tadmin
	}
	if code, raw := env.publish(publisher, ag); code != 201 {
		t.Fatalf("publish %s = %d %s", name, code, raw)
	}
	return ag
}

// router publishes a router.
func (env *routerEnv) router(t *testing.T, name string, extra map[string]any) apitypes.Agent {
	t.Helper()
	cfg := env.agentConfig()
	cfg["router"] = true
	for k, v := range extra {
		cfg[k] = v
	}
	var ag apitypes.Agent
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": name, "description": "The front door", "config": cfg}, &ag, nil)
	mustCode(t, "create "+name, code, e, 201, "")
	publisher := env.editor
	if cfg["audience"] != nil && cfg["audience"] != "team" {
		publisher = env.tadmin
	}
	if code, raw := env.publish(publisher, ag); code != 201 {
		t.Fatalf("publish %s = %d %s", name, code, raw)
	}
	return ag
}

// routing is the last routing record of a router's answers.
func (env *routerEnv) routing(t *testing.T, router apitypes.Agent) agents.RoutingRecord {
	t.Helper()
	var raw []byte
	if err := env.app.Pool.QueryRow(t.Context(), `SELECT routing FROM message_events WHERE agent_id = $1 AND routing IS NOT NULL ORDER BY id DESC LIMIT 1`, router.Id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var rec agents.RoutingRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func (env *routerEnv) end(t *testing.T, s *session, slug, conv, question string) (apitypes.ChatEventMessageEnd, sseEvents, string) {
	t.Helper()
	body := map[string]any{"message": question}
	if conv != "" {
		body["conversationId"] = conv
	}
	code, evs, e := s.stream(env.chatPath(slug), body)
	mustCode(t, "ask "+slug, code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	var c struct{ ConversationId string }
	evs.one(t, "conversation", &c)
	return end, evs, c.ConversationId
}

func TestRouterSendsEachQuestionToTheRightAgent(t *testing.T) {
	env := newRouterEnv(t)
	parking := env.target(t, "Parking help", "Parking permits, decals and campus transportation.", nil)
	housing := env.target(t, "Housing help", "Residence halls, move-in dates and campus housing.", nil)
	front := env.router(t, "Front door", nil)

	// A parking question: the parking agent answers, in the asker's own conversation with it.
	end, evs, conv := env.end(t, env.member, front.Slug, "", "Where do students buy a parking permit?")
	if !strings.Contains(end.Text, "Parking") || len(end.Citations) == 0 || end.Refused {
		t.Fatalf("routed answer = %+v", end)
	}
	if len(evs.all("retrieval")) == 0 || len(evs.all("message_start")) != 1 {
		t.Errorf("events = %v, want the target's retrieval and one message_start", evs.names())
	}
	rec := env.routing(t, front)
	if rec.Decision != "routed" || rec.AgentID == nil || *rec.AgentID != parking.Id || rec.ConversationID == nil || rec.Candidates != 2 || rec.Confidence < 0.5 {
		t.Fatalf("routing = %+v", rec)
	}
	routed := env.detail(t, env.member, conv)
	if got := routed.Messages[1].RoutedTo; got == nil || got.Slug != parking.Slug || got.Name != "Parking help" || got.ConversationId == nil || *got.ConversationId != *rec.ConversationID {
		t.Fatalf("routedTo = %+v", got)
	}
	// The target's side is a real conversation of the asker, with the question and the same answer.
	theirs := env.detail(t, env.member, rec.ConversationID.String())
	if len(theirs.Messages) != 2 || theirs.Messages[1].Text != end.Text || theirs.Conversation.AgentSlug != parking.Slug {
		t.Errorf("the target's conversation = %d messages, %q", len(theirs.Messages), theirs.Conversation.AgentSlug)
	}
	// The router's copy opens its sources like any answer, though the passage is the target's.
	if code, e := env.member.call("GET", "/v1/messages/"+routed.Messages[1].Id.String()+"/sources/1", nil, nil, nil); code != 200 {
		t.Errorf("a routed answer's source = %d %s", code, e)
	}
	// What the router stored of the exchange holds no extra copy of the question in its analytics.
	if raw := lastRecord(t, env.agentEnv, "routing", front.Id.String()); strings.Contains(raw, "parking permit") {
		t.Errorf("routing record carries the question: %s", raw)
	}

	// A follow-up to the same agent continues that conversation; another subject starts one with the other agent.
	_, _, again := env.end(t, env.member, front.Slug, conv, "Which office sells a parking decal?")
	if again != conv {
		t.Fatalf("router conversation changed: %s -> %s", conv, again)
	}
	if rec2 := env.routing(t, front); rec2.ConversationID == nil || *rec2.ConversationID != *rec.ConversationID {
		t.Errorf("follow-up went to conversation %v, want %s", rec2.ConversationID, rec.ConversationID)
	}
	if n := len(env.detail(t, env.member, rec.ConversationID.String()).Messages); n != 4 {
		t.Errorf("the target's conversation has %d messages, want 4", n)
	}
	env.end(t, env.member, front.Slug, conv, "When can students move into residence halls?")
	if rec3 := env.routing(t, front); rec3.AgentID == nil || *rec3.AgentID != housing.Id {
		t.Errorf("housing question went to %v", rec3.AgentID)
	}
	// The asker deletes their conversation with the parking agent: the next parking question starts another, not an error.
	if code, e := env.member.call("DELETE", "/v1/conversations/"+rec.ConversationID.String(), nil, nil, nil); code != 200 && code != 204 {
		t.Fatalf("delete the target conversation = %d %s", code, e)
	}
	env.end(t, env.member, front.Slug, conv, "Which office sells a parking decal?")
	if rec4 := env.routing(t, front); rec4.Decision != "routed" || rec4.ConversationID == nil || *rec4.ConversationID == *rec.ConversationID {
		t.Errorf("after deleting the target conversation = %+v", rec4)
	}
	// The target's own analytics saw the questions; the router's record the decisions only.
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND routing IS NULL`, parking.Id); n != 3 {
		t.Errorf("the parking agent's answers = %d, want 3", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND input_tokens > 0`, front.Id); n != 0 {
		t.Errorf("the router billed %d answers' tokens as its own", n)
	}
}

func TestRouterWhenNothingFitsOrItIsOnlyHello(t *testing.T) {
	env := newRouterEnv(t)
	env.target(t, "Parking help", "Parking permits, decals and campus transportation.", nil)
	front := env.router(t, "Front door", nil)

	// Nothing fits: the router says so, no agent is asked, and the question is the router's gap.
	chats := len(env.proxy.ChatRequests())
	end, _, conv := env.end(t, env.member, front.Slug, "", "NOAGENT Who won the football game?")
	if end.Text != agents.DefaultNoAgent || !end.Refused || end.NoContextReason == nil || *end.NoContextReason != "no_agent" || len(env.proxy.ChatRequests()) != chats {
		t.Fatalf("no agent fits = %+v", end)
	}
	if rec := env.routing(t, front); rec.Decision != "none" || rec.AgentID != nil {
		t.Errorf("routing = %+v", rec)
	}
	if n := env.scalar(t, `SELECT count(*) FROM conversations WHERE agent_id <> $1`, front.Id); n != 0 {
		t.Errorf("a conversation was made with another agent: %d", n)
	}
	var signals []string
	if err := env.app.Pool.QueryRow(t.Context(), `SELECT signals FROM gap_questions WHERE agent_id = $1`, front.Id).Scan(&signals); err != nil || len(signals) != 1 || signals[0] != "no_agent" {
		t.Errorf("gap signals = %v, %v", signals, err)
	}
	if g := env.detail(t, env.member, conv).Messages[1]; g.RoutedTo != nil || g.Refused == nil || !*g.Refused {
		t.Errorf("a refusal = %+v", g)
	}

	// A router with its own wording says that instead.
	custom := env.router(t, "Custom door", map[string]any{"refusalMessage": "Nobody here handles that. Try the help desk."})
	end, _, _ = env.end(t, env.member, custom.Slug, "", "NOAGENT Who won the football game?")
	if end.Text != "Nobody here handles that. Try the help desk." {
		t.Errorf("custom wording = %q", end.Text)
	}

	// Only hello: the router's own model answers, briefly; no agent, and not a gap.
	chats = len(env.proxy.ChatRequests())
	end, _, _ = env.end(t, env.member, front.Slug, "", "Hello!")
	if rec := env.routing(t, front); rec.Decision != "small_talk" || rec.AgentID != nil || len(env.proxy.ChatRequests()) != chats+1 || end.Refused {
		t.Errorf("small talk = %+v %+v", rec, end)
	}
	if n := env.scalar(t, `SELECT count(*) FROM gap_questions WHERE agent_id = $1`, front.Id); n != 1 {
		t.Errorf("gap questions = %d, want only the one that fit nothing", n)
	}

	// A choice the model is not sure of counts as none.
	end, _, _ = env.end(t, env.member, front.Slug, "", "LOWROUTE Where do students buy a parking permit?")
	if !end.Refused || env.routing(t, front).Decision != "none" {
		t.Errorf("low confidence = %+v", end)
	}
}

func TestRouterWithoutRoutingAnswersThatItCannot(t *testing.T) {
	env := newRouterEnv(t)
	env.target(t, "Parking help", "Parking permits, decals and campus transportation.", nil)
	front := env.router(t, "Front door", nil)

	// The routing request fails: the router says it cannot, which is not a gap (nothing is known about the question).
	env.proxy.FailRouteWith(500)
	end, _, _ := env.end(t, env.member, front.Slug, "", "Where do students buy a parking permit?")
	if end.Text == agents.DefaultNoAgent || !strings.Contains(end.Text, "can't send your question") || env.routing(t, front).Decision != "unavailable" {
		t.Fatalf("failed routing = %+v", end)
	}
	env.proxy.FailRouteWith(0)

	// The scope check switched off afterwards: the same, without asking anything.
	env.s1.putChecks(t, map[string]any{"enabled": false}, map[string]any{"enabled": false})
	asked := env.proxy.RouteRequests()
	end, _, _ = env.end(t, env.member, front.Slug, "", "Where do students buy a parking permit?")
	if !strings.Contains(end.Text, "can't send your question") || env.proxy.RouteRequests() != asked {
		t.Errorf("scope check off = %+v", end)
	}
	if n := env.scalar(t, `SELECT count(*) FROM gap_questions WHERE agent_id = $1`, front.Id); n != 0 {
		t.Errorf("gap questions = %d, want none", n)
	}
}

func TestRouterNeverWidensWhoMayAsk(t *testing.T) {
	env := newRouterEnv(t)
	outsider := env.auditor // signed in, not in the team
	env.target(t, "Team parking", "Parking permits and decals for staff.", nil)
	notRoutable := env.target(t, "Quiet housing", "Residence halls and move-in dates.", map[string]any{"routable": false, "audience": "all_authenticated"})
	open := env.target(t, "Open library", "Library hours, study rooms and finals week.", map[string]any{"audience": "all_authenticated"})
	front := env.router(t, "Front door", map[string]any{"audience": "all_authenticated"})

	// An outsider reaches what they could chat with themselves and is routable: the library only. The team's parking agent and the
	// agent that did not opt in are out, though their subjects match.
	for _, q := range []string{"Where do staff buy a parking permit?", "When can students move into residence halls?"} {
		end, _, _ := env.end(t, outsider, front.Slug, "", q)
		if !end.Refused || env.routing(t, front).Decision != "none" {
			t.Fatalf("%q reached an agent it should not: %+v %+v", q, end, env.routing(t, front))
		}
	}
	end, _, _ := env.end(t, outsider, front.Slug, "", "How long is the library open during finals week?")
	if rec := env.routing(t, front); rec.Decision != "routed" || *rec.AgentID != open.Id || rec.Candidates != 1 || end.Refused {
		t.Fatalf("the library = %+v %+v", rec, end)
	}
	// A team member's router reaches the team's own agent too.
	env.end(t, env.member, front.Slug, "", "Where do staff buy a parking permit?")
	if rec := env.routing(t, front); rec.Decision != "routed" || rec.Candidates != 2 {
		t.Errorf("member = %+v", rec)
	}
	// The agent that did not opt in stays unreachable; opting in makes it reachable (a published change).
	env.end(t, env.member, front.Slug, "", "When can students move into residence halls?")
	if env.routing(t, front).Decision != "none" {
		t.Errorf("an agent that is not routable was reached")
	}
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["routable"], cfg["audience"] = true, "all_authenticated"
	var cur apitypes.Agent
	env.tadmin.get(env.base+"/agents/"+notRoutable.Id.String(), &cur)
	code, e := env.tadmin.call("PATCH", env.base+"/agents/"+notRoutable.Id.String(), map[string]any{"config": cfg}, nil, ifMatch(int64(cur.Revision)))
	mustCode(t, "opt in", code, e, 200, "")
	env.end(t, env.member, front.Slug, "", "When can students move into residence halls?")
	if env.routing(t, front).Decision != "none" {
		t.Errorf("a draft change took effect before it was published")
	}
	if code, raw := env.publish(env.tadmin, notRoutable); code != 201 {
		t.Fatalf("publish = %d %s", code, raw)
	}
	env.end(t, env.member, front.Slug, "", "When can students move into residence halls?")
	if rec := env.routing(t, front); rec.Decision != "routed" || *rec.AgentID != notRoutable.Id {
		t.Errorf("after opting in = %+v", rec)
	}
	// A disabled agent is not offered.
	code, e = env.tadmin.call("POST", env.base+"/agents/"+notRoutable.Id.String()+"/status", map[string]any{"status": "disabled_by_team", "reason": "Review"}, nil, nil)
	mustCode(t, "disable", code, e, 200, "")
	env.end(t, env.member, front.Slug, "", "When can students move into residence halls?")
	if env.routing(t, front).Decision != "none" {
		t.Errorf("a disabled agent was reached")
	}
}

func TestRouterPublishingRules(t *testing.T) {
	env := newRouterEnv(t)
	create := func(cfg map[string]any) (int, string) {
		var ag apitypes.Agent
		code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": "R" + itoa(int64(len(cfg))), "config": cfg}, &ag, nil)
		if code != 201 {
			return code, e
		}
		code, raw := env.publish(env.editor, ag)
		return code, string(raw)
	}
	// A router has no knowledge bases.
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["router"] = true
	if code, raw := create(cfg); code != 422 || !strings.Contains(raw, "A router doesn't search") {
		t.Errorf("router with a knowledge base = %d %s", code, raw)
	}
	// A router cannot also be reached through routers.
	cfg = env.agentConfig()
	cfg["router"], cfg["routable"] = true, true
	var ag apitypes.Agent
	if code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": "Both", "config": cfg}, &ag, nil); code != 422 && code != 400 {
		t.Errorf("router and routable = %d %s", code, e)
	}
	// A router needs the scope check.
	env.s1.putChecks(t, map[string]any{"enabled": false}, map[string]any{"enabled": false})
	cfg = env.agentConfig()
	cfg["router"] = true
	if code, raw := create(cfg); code != 422 || !strings.Contains(raw, "SystemOne scope check") {
		t.Errorf("router without the scope check = %d %s", code, raw)
	}
	// An ordinary agent still needs a knowledge base, and the draft of a router can be saved without the check (it is only checked on Publish).
	if code, raw := create(env.agentConfig()); code != 422 || !strings.Contains(raw, "at least one knowledge base") {
		t.Errorf("agent without a knowledge base = %d %s", code, raw)
	}
}

func TestRouterNeedsAConversation(t *testing.T) {
	env := newRouterEnv(t)
	env.target(t, "Parking help", "Parking permits, decals and campus transportation.", nil)
	front := env.router(t, "Front door", nil)

	// The editor's test chat, a service key and the OpenAI-compatible endpoint carry no conversation of a person.
	code, e := env.editor.call("POST", env.base+"/agents/"+front.Id.String()+"/test", map[string]any{"message": "Where do students buy a parking permit?"}, nil, nil)
	mustCode(t, "test chat of a router", code, e, 400, "router_needs_conversation")
}

func TestRoutedConversationsAreNotShared(t *testing.T) {
	env := newRouterEnv(t)
	env.target(t, "Parking help", "Parking permits, decals and campus transportation.", nil)
	front := env.router(t, "Front door", nil)

	// Small talk only: nothing of another agent in it, so it may be shared.
	_, _, hello := env.end(t, env.member, front.Slug, "", "Hello!")
	env.share(t, env.member, hello, "agent_users", false)

	// A routed answer is the target's, with the target's audience: the router's conversation can't be shared, and the
	// target's own can.
	_, _, conv := env.end(t, env.member, front.Slug, "", "Where do students buy a parking permit?")
	code, e := env.member.call("POST", "/v1/conversations/"+conv+"/shares", map[string]any{"audience": "agent_users"}, nil, nil)
	mustCode(t, "share a routed conversation", code, e, 409, "not_shareable")
	target := env.routing(t, front).ConversationID.String()
	env.share(t, env.member, target, "agent_users", false)
}

func TestPublicRouterReachesOnlyPublicAgents(t *testing.T) {
	env := newRouterEnv(t)
	env.setPublic(t, true)
	env.publicPolicy(t)
	env.target(t, "Team parking", "Parking permits and decals for staff.", nil)
	pub := env.target(t, "Public library", "Library hours, study rooms and finals week.", map[string]any{"audience": "public"})
	front := env.router(t, "Public door", map[string]any{"audience": "public"})

	v := newVisitor(t, env.app.URL)
	if code, e := v.start(front.Id, "", ""); code != 201 && code != 200 {
		t.Fatalf("start = %d %s", code, e)
	}
	// The team's agent matches the question but is not public: an anonymous visitor cannot be sent there.
	code, evs, e := v.ask(front.Id, "Where do staff buy a parking permit?")
	mustCode(t, "visitor, team agent's subject", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if !end.Refused || strings.Contains(end.Text, "permit") && len(end.Citations) > 0 {
		t.Fatalf("the visitor was answered by a team agent: %+v", end)
	}
	code, evs, e = v.ask(front.Id, "How long is the library open during finals week?")
	mustCode(t, "visitor, public agent's subject", code, e, 200, "")
	evs.one(t, "message_end", &end)
	if end.Refused || len(end.Citations) == 0 {
		t.Fatalf("the public agent did not answer: %+v", end)
	}
	if rec := env.routing(t, front); rec.Decision != "routed" || *rec.AgentID != pub.Id || rec.Candidates != 1 {
		t.Errorf("routing = %+v", rec)
	}
}
