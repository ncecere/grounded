package httpapi_test

import "fmt"

// Classification of agent templates (v0.6.0, C4). Anyone who can make an agent, and platform staff, list them; platform admins change
// them; API keys do nothing here.
//
// Saving an agent as a template is closed to every caller in this table, on purpose: it needs a platform admin who is also an editor,
// admin or owner of the agent's team (ADR-0011: admins have no default access to agent configuration), and the matrix's platform admin is
// on neither team. TestSaveAsTemplate covers the one caller who can.

func init() {
	for id, p := range templatePolicies {
		p.scope = scopeGlobal
		register(id, p)
	}
	register("saveAgentAsTemplate", policy{scope: scopeTeam, build: func(c *mctx) request {
		return post(c.ag("/save-as-template"), map[string]any{"name": fmt.Sprintf("Matrix template %d", c.e.next())})
	}})
}

var templatePolicies = map[string]policy{
	"listAgentTemplates": {own: editors.and(platform), build: func(*mctx) request { return get("/v1/agent-templates") }},
	// A built-in template cannot be changed: past authorization, the platform admin is refused for what it is.
	"adminUpdateAgentTemplate": {own: padmin, also: []string{"409 template_builtin"}, build: func(*mctx) request {
		return patch("/v1/admin/agent-templates/service-desk-faq", map[string]any{"description": upd})
	}},
	"adminDeleteAgentTemplate": {own: padmin, also: []string{"409 template_builtin"}, build: func(*mctx) request {
		return del("/v1/admin/agent-templates/service-desk-faq")
	}},
}
