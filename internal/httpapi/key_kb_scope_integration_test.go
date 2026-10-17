package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// A key reaches only the knowledge bases it was given, and an agent restriction gives it only the knowledge bases its agents answer from; a key
// limited to some knowledge bases sees only the agents that use nothing else (QA pass v0.6.0, #111, decided by the owner: "agents should only be
// able to read KBs they have access to").
func TestKeyReachesOnlyTheKnowledgeBasesItsRestrictionsAllow(t *testing.T) {
	env := newAgentEnv(t)

	// A second source and knowledge base, so two agents answer from different content.
	var src2 apitypes.DataSource
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": "Housing", "classification": "open"}, &src2, nil)
	mustCode(t, "second source", code, e, 201, "")
	docs2 := env.base + "/sources/" + src2.Id.String() + "/documents"
	code, _, e2 := env.owner.uploadFiles(docs2, []upload{{"housing2.md", []byte("# Housing\n\nResidence halls open in August. PINEAPPLE-B.")}}, "")
	if code != 200 {
		t.Fatalf("upload = %d %s", code, e2)
	}
	env.owner.waitForDocuments(t, docs2)
	var kb2 apitypes.KnowledgeBase
	code, e = env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Housing KB", "topK": 3}, &kb2, nil)
	mustCode(t, "second kb", code, e, 201, "")
	code, e = env.owner.call("PUT", env.base+"/kbs/"+kb2.Id.String()+"/sources/"+src2.Id.String(), nil, &kb2, nil)
	mustCode(t, "attach", code, e, 200, "")
	kb1 := env.kb

	agent1 := env.publishAgent(t, "Parking agent", env.agentConfig(kb1.Id.String()))
	agent2 := env.publishAgent(t, "Housing agent", env.agentConfig(kb2.Id.String()))

	key := func(restrict map[string]any) string {
		body := map[string]any{"name": "k", "kind": "service", "scopes": []string{"query", "ingest"}}
		for k, v := range restrict {
			body[k] = v
		}
		return createKey(t, env.owner, env.base, body).Secret
	}
	get := func(k, path string, out any) (int, string) { return keyCall(t, env.app.URL, "GET", path, k, nil, out) }
	retrieve := func(k string, kb apitypes.KnowledgeBase) (int, string) {
		return keyCall(t, env.app.URL, "POST", env.base+"/kbs/"+kb.Id.String()+"/retrieve", k, map[string]any{"query": "residence halls move-in"}, nil)
	}
	kbNames := func(k string) []string {
		var list []apitypes.KnowledgeBase
		if code, e := get(k, env.base+"/kbs", &list); code != 200 {
			t.Fatalf("list kbs = %d %s", code, e)
		}
		var out []string
		for _, kb := range list {
			out = append(out, kb.Name)
		}
		return out
	}
	agentSlugs := func(k string) []string {
		var list []apitypes.Agent
		if code, e := get(k, env.base+"/agents", &list); code != 200 {
			t.Fatalf("list agents = %d %s", code, e)
		}
		var out []string
		for _, a := range list {
			out = append(out, a.Slug)
		}
		return out
	}
	same := func(got []string, want ...string) bool {
		if len(got) != len(want) {
			return false
		}
		seen := map[string]bool{}
		for _, g := range got {
			seen[g] = true
		}
		for _, w := range want {
			if !seen[w] {
				return false
			}
		}
		return true
	}
	srcPath := func(s apitypes.DataSource) string { return env.base + "/sources/" + s.Id.String() }

	// Control: an unrestricted key reaches everything.
	free := key(nil)
	if got := kbNames(free); !same(got, "Student help", "Housing KB") {
		t.Fatalf("control: an unrestricted key lists knowledge bases %v", got)
	}
	if got := agentSlugs(free); !same(got, agent1.Slug, agent2.Slug) {
		t.Fatalf("control: an unrestricted key lists agents %v", got)
	}

	// Restricted to an agent: only that agent's knowledge base, the sources that feed it, and the agent itself.
	byAgent := key(map[string]any{"agentIds": []string{agent1.Id.String()}})
	if got := kbNames(byAgent); !same(got, "Student help") {
		t.Errorf("an agent-restricted key lists knowledge bases %v, want only the agent's", got)
	}
	if code, e := retrieve(byAgent, kb1); code != 200 {
		t.Errorf("the agent's own knowledge base: %d %s, want 200", code, e)
	}
	if code, e := retrieve(byAgent, kb2); code != 404 || e != "kb_not_found" {
		t.Errorf("another agent's knowledge base: %d %s, want 404 kb_not_found", code, e)
	}
	if code, e := get(byAgent, srcPath(env.upload)+"/documents", nil); code != 200 {
		t.Errorf("the agent's source: %d %s, want 200", code, e)
	}
	if code, e := get(byAgent, srcPath(src2)+"/documents", nil); code != 404 || e != "source_not_found" {
		t.Errorf("another agent's source: %d %s, want 404 source_not_found", code, e)
	}
	if got := agentSlugs(byAgent); !same(got, agent1.Slug) {
		t.Errorf("an agent-restricted key lists agents %v, want only its own", got)
	}

	// Restricted to a knowledge base: only the agents that answer from nothing else.
	byKB := key(map[string]any{"knowledgeBaseIds": []string{kb1.Id.String()}})
	if got := agentSlugs(byKB); !same(got, agent1.Slug) {
		t.Errorf("a knowledge-base-restricted key lists agents %v, want only those using its knowledge base", got)
	}
	if code, e := get(byKB, env.base+"/agents/"+agent2.Id.String(), nil); code != 404 || e != "agent_not_found" {
		t.Errorf("an agent that uses another knowledge base: %d %s, want 404 agent_not_found", code, e)
	}
	if code, e := get(byKB, env.base+"/agents/"+agent1.Id.String(), nil); code != 200 {
		t.Errorf("an agent that uses the key's knowledge base: %d %s, want 200", code, e)
	}

	// Both at once: what both allow, which here is nothing.
	both := key(map[string]any{"agentIds": []string{agent1.Id.String()}, "knowledgeBaseIds": []string{kb2.Id.String()}})
	if got := kbNames(both); len(got) != 0 {
		t.Errorf("an agent and a knowledge base that do not meet: knowledge bases %v, want none", got)
	}
	if code, _ := retrieve(both, kb1); code != 404 {
		t.Errorf("retrieving through an empty intersection = %d, want 404", code)
	}

	// An agent restriction follows the agent: once the agent answers from another knowledge base, so does the key.
	edit := env.agentConfig(kb2.Id.String())
	var cur apitypes.Agent
	env.editor.get(env.base+"/agents/"+agent1.Id.String(), &cur)
	code, e = env.editor.call("PATCH", env.base+"/agents/"+agent1.Id.String(), map[string]any{"config": edit}, nil, ifMatch(cur.Revision))
	mustCode(t, "re-point the agent", code, e, 200, "")
	code, e = env.editor.call("POST", env.base+"/agents/"+agent1.Id.String()+"/publish", map[string]any{"note": "now housing"}, nil, nil)
	mustCode(t, "publish", code, e, 201, "")
	if got := kbNames(byAgent); !same(got, "Housing KB") {
		t.Errorf("after the agent was re-pointed, its key lists knowledge bases %v, want the new one", got)
	}

	// An agent-restricted key sees its agent whatever the draft says: an edit under way that points at another knowledge base does not hide it
	// (what the key reaches follows the published version).
	env.editor.get(env.base+"/agents/"+agent1.Id.String(), &cur)
	code, e = env.editor.call("PATCH", env.base+"/agents/"+agent1.Id.String(), map[string]any{"config": env.agentConfig(kb1.Id.String())}, nil, ifMatch(cur.Revision))
	mustCode(t, "edit the draft, unpublished", code, e, 200, "")
	if got := agentSlugs(byAgent); !same(got, agent1.Slug) {
		t.Errorf("an agent-restricted key lists agents %v while its agent's draft points elsewhere, want its agent", got)
	}
	if got := kbNames(byAgent); !same(got, "Housing KB") {
		t.Errorf("an unpublished edit changed what the key reaches: %v", got)
	}
}
