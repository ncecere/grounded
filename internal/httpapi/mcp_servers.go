package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/ncecere/grounded/internal/costs"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/mcpclient"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// The MCP client's registry (docs/mcp-client.md): Admin → Models → MCP
// servers for platform admins (auditors read), and the tools editors may
// choose for agents.

func (a *api) mcpClientRoutes() []route {
	return []route{
		{"GET", "/v1/admin/mcp-servers", a.admin(a.adminListMCPServers)},
		{"POST", "/v1/admin/mcp-servers", a.admin(a.adminCreateMCPServer)},
		{"GET", "/v1/admin/mcp-servers/{serverId}", a.admin(a.adminGetMCPServer)},
		{"PATCH", "/v1/admin/mcp-servers/{serverId}", a.admin(a.adminUpdateMCPServer)},
		{"DELETE", "/v1/admin/mcp-servers/{serverId}", a.admin(a.adminDeleteMCPServer)},
		{"POST", "/v1/admin/mcp-servers/{serverId}/test", a.admin(a.adminTestMCPServer)},
		{"POST", "/v1/admin/mcp-servers/{serverId}/refresh", a.admin(a.adminRefreshMCPServerTools)},
		{"GET", "/v1/admin/mcp-servers/{serverId}/tools", a.admin(a.adminListMCPServerTools)},
		{"PUT", "/v1/admin/mcp-servers/{serverId}/tools/{toolId}/approval", a.admin(a.adminSetMCPToolApproval)},
		{"GET", "/v1/mcp-tools", a.session(a.listUsableMCPTools)},
	}
}

func (a *api) toAPIMCPServer(ctx context.Context, s mcpclient.Server) apitypes.MCPServer {
	out := apitypes.MCPServer{
		Id: s.ID, Name: s.Name, Description: s.Description, Url: s.URL, AuthHeaderName: s.AuthHeaderName, HasAuth: s.HasAuth(),
		AuthValueHint: s.AuthValueHint, MaxClassification: s.MaxClassification, TimeoutSeconds: s.TimeoutSeconds, Enabled: s.Enabled,
		ToolCount: s.ToolCount, ApprovedCount: s.ApprovedCount, ToolsRefreshedAt: s.ToolsRefreshedAt, Revision: s.Revision,
		CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt,
	}
	if a.Costs != nil {
		if p, err := a.Costs.MCPServerPrice(ctx, s.ID); err == nil && p != nil {
			v := costs.Format(p)
			out.PricePerCall = &v
		}
	}
	return out
}

func toAPIMCPTool(t dbgen.McpServerTool, approvedByName string) apitypes.MCPServerTool {
	out := apitypes.MCPServerTool{
		Id: t.ID, ServerId: t.ServerID, Name: t.Name, Title: t.Title, Description: t.Description, Approved: t.Approved,
		ApprovedAt: t.ApprovedAt, FirstSeenAt: t.FirstSeenAt, LastSeenAt: t.LastSeenAt, GoneAt: t.GoneAt,
		InputSchema: map[string]any{},
	}
	_ = json.Unmarshal(t.InputSchema, &out.InputSchema)
	if t.ApprovedBy.Valid {
		out.ApprovedBy = &t.ApprovedBy.UUID
		if approvedByName != "" {
			out.ApprovedByName = &approvedByName
		}
	}
	return out
}

func toAPIMCPToolRow(t mcpclient.Tool) apitypes.MCPServerTool {
	return toAPIMCPTool(dbgen.McpServerTool{ID: t.ID, ServerID: t.ServerID, Name: t.Name, Title: t.Title, Description: t.Description,
		InputSchema: t.InputSchema, Approved: t.Approved, ApprovedBy: t.ApprovedBy, ApprovedAt: t.ApprovedAt,
		FirstSeenAt: t.FirstSeenAt, LastSeenAt: t.LastSeenAt, GoneAt: t.GoneAt}, t.ApprovedByName)
}

func (a *api) adminListMCPServers(w http.ResponseWriter, r *http.Request) {
	list, err := a.MCP.ListServers(r.Context(), a.actor(r))
	writeList(w, r, list, err, func(s mcpclient.Server) apitypes.MCPServer { return a.toAPIMCPServer(r.Context(), s) })
}

func (a *api) adminCreateMCPServer(w http.ResponseWriter, r *http.Request) {
	var in apitypes.MCPServerCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	if in.PricePerCall != nil && *in.PricePerCall != "" {
		if _, err := costs.ParseAmount(*in.PricePerCall, "pricePerCall"); failed(w, r, err) {
			return
		}
	}
	s, err := a.MCP.CreateServer(r.Context(), a.actor(r), mcpclient.ServerInput{
		Name: in.Name, Description: deref(in.Description, ""), URL: in.Url, AuthHeaderName: deref(in.AuthHeaderName, ""),
		AuthValue: deref(in.AuthValue, ""), MaxClassification: in.MaxClassification, TimeoutSeconds: deref(in.TimeoutSeconds, 0),
		Enabled: deref(in.Enabled, true),
	})
	if failed(w, r, err) || failed(w, r, a.setMCPPrice(r, s, in.PricePerCall)) {
		return
	}
	writeRevised(w, http.StatusCreated, s.Revision, a.toAPIMCPServer(r.Context(), s))
}

// setMCPPrice records a server's per-call price from today (nil: unchanged;
// "": removed, so its calls are unpriced).
func (a *api) setMCPPrice(r *http.Request, s mcpclient.Server, price *string) error {
	if price == nil || a.Costs == nil {
		return nil
	}
	if *price == "" {
		return a.Costs.ClearMCPServerPrice(r.Context(), a.actor(r), s.ID, s.Name)
	}
	return a.Costs.SetMCPServerPrice(r.Context(), a.actor(r), s.ID, s.Name, *price)
}

func (a *api) adminGetMCPServer(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "serverId")
	if !ok {
		return
	}
	s, err := a.MCP.GetServer(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, s.Revision, a.toAPIMCPServer(r.Context(), s))
}

func (a *api) adminUpdateMCPServer(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "serverId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.MCPServerUpdate](w, r)
	if !ok {
		return
	}
	if in.PricePerCall != nil && *in.PricePerCall != "" {
		if _, err := costs.ParseAmount(*in.PricePerCall, "pricePerCall"); failed(w, r, err) {
			return
		}
	}
	s, err := a.MCP.UpdateServer(r.Context(), a.actor(r), id, mcpclient.ServerUpdate{
		Name: in.Name, Description: in.Description, URL: in.Url, AuthHeaderName: in.AuthHeaderName, AuthValue: in.AuthValue,
		MaxClassification: in.MaxClassification, TimeoutSeconds: in.TimeoutSeconds, Enabled: in.Enabled,
	}, rev)
	if failed(w, r, err) || failed(w, r, a.setMCPPrice(r, s, in.PricePerCall)) {
		return
	}
	writeRevised(w, http.StatusOK, s.Revision, a.toAPIMCPServer(r.Context(), s))
}

func (a *api) adminDeleteMCPServer(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "serverId")
	if !ok {
		return
	}
	writeOK(w, r, a.MCP.DeleteServer(r.Context(), a.actor(r), id))
}

func (a *api) adminTestMCPServer(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "serverId")
	if !ok {
		return
	}
	res, err := a.MCP.Test(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	out := apitypes.MCPServerTestResult{Ok: res.OK, LatencyMs: res.Latency.Milliseconds(), ToolCount: res.ToolCount}
	if e := res.Err; e != nil {
		class := apitypes.MCPServerTestResultErrorClass(e.Class)
		out.ErrorClass, out.Message = &class, &e.Message
		if e.HTTPStatus > 0 {
			st := int32(e.HTTPStatus)
			out.HttpStatus = &st
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminRefreshMCPServerTools(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "serverId")
	if !ok {
		return
	}
	sum, tools, err := a.MCP.Refresh(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	out := apitypes.MCPRefreshResult{Listed: sum.Listed, Added: sum.Added, Changed: sum.Changed, Gone: sum.Gone,
		Tools: make([]apitypes.MCPServerTool, len(tools))}
	for i, t := range tools {
		out.Tools[i] = toAPIMCPToolRow(t)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminListMCPServerTools(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "serverId")
	if !ok {
		return
	}
	tools, err := a.MCP.ListTools(r.Context(), a.actor(r), id)
	writeList(w, r, tools, err, toAPIMCPToolRow)
}

func (a *api) adminSetMCPToolApproval(w http.ResponseWriter, r *http.Request) {
	serverID, ok := pathUUID(w, r, "serverId")
	if !ok {
		return
	}
	toolID, ok := pathUUID(w, r, "toolId")
	if !ok {
		return
	}
	var in apitypes.AdminSetMCPToolApprovalJSONBody
	if !httpx.Decode(w, r, &in) {
		return
	}
	t, err := a.MCP.SetApproval(r.Context(), a.actor(r), serverID, toolID, in.Approved)
	if failed(w, r, err) {
		return
	}
	name := ""
	if t.ApprovedBy.Valid {
		if u, err := a.q.GetUser(r.Context(), t.ApprovedBy.UUID); err == nil {
			name = u.DisplayName
		}
	}
	httpx.JSON(w, http.StatusOK, toAPIMCPTool(t, name))
}

func (a *api) listUsableMCPTools(w http.ResponseWriter, r *http.Request) {
	tools, err := a.MCP.UsableTools(r.Context())
	writeList(w, r, tools, err, func(t mcpclient.UsableTool) apitypes.MCPToolOption {
		return apitypes.MCPToolOption{Id: t.ID, ServerId: t.ServerID, ServerName: t.ServerName, Name: t.Name, Title: t.Title,
			Description: t.Description, MaxClassification: t.ServerMaxClassification}
	})
}
