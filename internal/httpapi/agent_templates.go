package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// Agent templates (v0.6.0, C4): starting points for a new agent. Anyone who can make an agent lists them; platform admins save an agent
// as one, rename it and delete it.

func (a *api) agentTemplateRoutes() []route {
	return []route{
		{"GET", "/v1/agent-templates", a.session(a.listAgentTemplates)},
		{"POST", "/v1/teams/{team}/agents/{agentId}/save-as-template", a.session(a.saveAgentAsTemplate)},
		{"PATCH", "/v1/admin/agent-templates/{templateId}", a.admin(a.adminUpdateAgentTemplate)},
		{"DELETE", "/v1/admin/agent-templates/{templateId}", a.admin(a.adminDeleteAgentTemplate)},
	}
}

func toAPITemplate(t agents.Template) apitypes.AgentTemplate {
	out := viaJSON[apitypes.AgentTemplate](t)
	out.Config = toAPIConfig(t.Config)
	if out.StarterQuestions == nil {
		out.StarterQuestions = []string{}
	}
	return out
}

func (a *api) listAgentTemplates(w http.ResponseWriter, r *http.Request) {
	list, err := a.Agents.ListTemplates(r.Context(), a.actor(r))
	writeList(w, r, list, err, toAPITemplate)
}

func templateInput(w http.ResponseWriter, r *http.Request) (agents.TemplateInput, bool) {
	var in struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if !httpx.Decode(w, r, &in) {
		return agents.TemplateInput{}, false
	}
	return agents.TemplateInput{Name: in.Name, Description: in.Description}, true
}

func (a *api) saveAgentAsTemplate(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	in, ok := templateInput(w, r)
	if !ok {
		return
	}
	t, err := a.Agents.SaveAsTemplate(r.Context(), a.actor(r), r.PathValue("team"), id, in)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPITemplate(t))
}

func (a *api) adminUpdateAgentTemplate(w http.ResponseWriter, r *http.Request) {
	in, ok := templateInput(w, r)
	if !ok {
		return
	}
	t, err := a.Agents.UpdateTemplate(r.Context(), a.actor(r), r.PathValue("templateId"), in)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPITemplate(t))
}

func (a *api) adminDeleteAgentTemplate(w http.ResponseWriter, r *http.Request) {
	writeOK(w, r, a.Agents.DeleteTemplate(r.Context(), a.actor(r), r.PathValue("templateId")))
}
