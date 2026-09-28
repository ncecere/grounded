package httpapi_test

import "fmt"

// Classification of a team's agents: editing, versions, sharing,
// publishable keys, chat and the OpenAI-compatible API (DESIGN.md §3.5,
// §7). Team B's main agent is public; team A's is for its team only.

func init() {
	for id, p := range agentPolicies {
		p.scope = scopeTeam
		register(id, p)
	}
}

var agentPolicies = map[string]policy{
	"listAgents": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.team("/agents")) }},
	"createAgent": {own: editors, build: func(c *mctx) request {
		return post(c.team("/agents"), map[string]any{"name": fmt.Sprintf("matrix agent %d", c.e.next())})
	}},
	"getAgent": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.ag("")) }},
	"updateAgent": {own: editors, build: func(c *mctx) request {
		return patch(c.ag(""), map[string]any{"description": upd}).h(c.rev(c.ag("")))
	}},
	// Editors edit agents; deleting one is for team admins and owners.
	"deleteAgent": {own: admins, build: func(c *mctx) request { return del(c.team("/agents/" + c.pick(c.tf.agent, c.e.freshAgent))) }},
	// A fresh agent's draft is for the team, which editors may publish.
	"publishAgent": {own: editors, build: func(c *mctx) request {
		return post(c.team("/agents/"+c.pick(c.tf.agent, c.e.freshAgent)+"/publish"), map[string]any{"note": "matrix"})
	}},
	"listAgentVersions": {own: members.and(readKeys), build: func(c *mctx) request { return get(c.ag("/versions")) }},
	"getAgentVersion":   {own: members.and(readKeys), build: func(c *mctx) request { return get(c.ag("/versions/1")) }},
	"revertAgent":       {own: editors, build: func(c *mctx) request { return post(c.ag("/revert"), map[string]any{"version": 1}) }},
	// Disabling or re-enabling an agent is for team admins and owners.
	"setAgentStatus": {own: admins, build: func(c *mctx) request {
		return post(c.ag("/status"), map[string]any{"status": "active"})
	}},
	"testAgent": {own: editors, build: func(c *mctx) request {
		return post(c.ag("/test"), map[string]any{"message": "Where do students buy a parking permit?", "stream": false})
	}},
	// Platform staff read analytics across teams in /v1/admin/analytics.
	"getAgentAnalytics": {own: editors, build: func(c *mctx) request { return get(c.ag("/analytics")) }},

	// Sharing and publishable keys (docs/phase4-publishing.md §3, §6).
	// Audience, links and the widget snippet (no secrets): the whole team.
	"getAgentSharing":     {own: members, build: func(c *mctx) request { return get(c.ag("/sharing")) }},
	"listPublishableKeys": {own: admins, build: func(c *mctx) request { return get(c.ag("/publishable-keys")) }},
	"createPublishableKey": {own: admins, build: func(c *mctx) request {
		return post(c.ag("/publishable-keys"), map[string]any{"name": "matrix", "allowedOrigins": []string{widgetOrigin}})
	}},
	"updatePublishableKey": {own: admins, build: func(c *mctx) request {
		p := c.ag("/publishable-keys/" + c.tf.pubKey)
		return patch(p, map[string]any{"enabled": true}).h(ifMatch(c.pubKeyRev()))
	}},
	"revokePublishableKey": {own: admins, build: func(c *mctx) request {
		return del(c.ag("/publishable-keys/" + c.pick(c.tf.pubKey, c.e.freshPubKey)))
	}},

	// Break-glass on a team (ADR-0024): the owners' notice; the team's
	// conversations only under break-glass.
	// The owners' notice; platform staff see every session in /v1/admin
	// and here.
	"listTeamBreakGlassSessions": {own: of(cOwner), foreign: platform, build: func(c *mctx) request { return get(c.team("/break-glass")) }},
	"listTeamConversations":      {build: func(c *mctx) request { return get(c.team("/conversations")) }},

	// Chat with a team's agent at its team address.
	"getAgentProfile": {own: members.and(readKeys), build: func(c *mctx) request {
		return get("/v1/agents/" + c.tf.slug + "/" + c.tf.agentSl)
	}},
	"chat": {own: members.and(queryKeys), build: func(c *mctx) request {
		return post("/v1/agents/"+c.tf.slug+"/"+c.tf.agentSl+"/chat", map[string]any{"message": "Where do students buy a parking permit?", "stream": false})
	}},
	"openaiChatCompletions": {own: members.and(queryKeys), build: func(c *mctx) request {
		return post("/v1/chat/completions", map[string]any{"model": "agent:" + c.tf.slug + "/" + c.tf.agentSl,
			"messages": []map[string]any{{"role": "user", "content": "Where do students buy a parking permit?"}}})
	}},
}
