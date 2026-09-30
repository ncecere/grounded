// The MCP server at POST /mcp (docs/mcp.md, docs/v0.3.0.md §3) and its
// platform switch. /mcp speaks JSON-RPC (the Model Context Protocol), so it
// is described in docs/mcp.md rather than api/openapi.yaml, and mounted
// outside apiRoutes (the route table the OpenAPI contract test checks).

package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/buildinfo"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/mcpserver"
	"github.com/ncecere/grounded/internal/secrets"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

const (
	// maxMCPBody bounds a JSON-RPC request: a question is at most 8,000
	// characters, so this leaves ample room.
	maxMCPBody = 1 << 20
	// mcpToolTimeout bounds one tool call (a search, or a whole answer);
	// the request gets a little longer to write the result.
	mcpToolTimeout    = 5 * time.Minute
	mcpRequestTimeout = mcpToolTimeout + 15*time.Second
	// mcpListTTL is how long a client may cache the tool list.
	mcpListTTL = time.Minute
)

// JSON-RPC error codes for refusals before the protocol starts
// (implementation-defined, -32000 to -32019).
const (
	rpcUnauthorized = -32001
	rpcForbidden    = -32003
	rpcNotFound     = -32004
	rpcRateLimited  = -32005
	rpcInvalid      = -32600
	rpcInternal     = -32603
)

// mcpServerKey carries the request's MCP server to the SDK's handler.
type mcpServerKey struct{}

// mcpSettingsRoutes: the MCP server's platform switch.
func (a *api) mcpSettingsRoutes() []route {
	return []route{
		{"GET", "/v1/admin/settings/mcp", a.admin(a.adminGetMCPSettings)},
		{"PUT", "/v1/admin/settings/mcp", a.admin(a.adminPutMCPSettings)},
	}
}

// mcpRoutes serve /mcp. Only POST speaks MCP (stateless Streamable HTTP);
// GET and DELETE answer 405, as a stateless server does.
func mcpRoutes(d Deps) []route {
	a := &api{Deps: d, q: dbgen.New(d.Pool)}
	h := a.mcpHandler()
	return []route{{"POST", "/mcp", h}, {"GET", "/mcp", h}, {"DELETE", "/mcp", h}}
}

// mcpHandler checks the switch, then the API key (keyauth.go: invalid,
// revoked, expired, a personal key's owner gone or suspended, the per-key
// request rate), then the mcp scope, and serves the caller's MCP server.
func (a *api) mcpHandler() http.Handler {
	pepper, _ := secrets.ParseKey(a.Config.APIKeyPepper) // validated at startup
	srv := mcpserver.New(mcpserver.Options{
		Backend: &mcpserver.Services{KnowledgeBaseService: a.KBs, AgentService: a.Agents, Q: a.q},
		Handles: mcpserver.NewHandles(pepper), Version: buildinfo.Version,
		Timeout: mcpToolTimeout, ListTTL: mcpListTTL, Log: a.Log,
	})
	sdk := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		s, _ := r.Context().Value(mcpServerKey{}).(*mcp.Server)
		return s
	}, &mcp.StreamableHTTPOptions{
		Stateless: true, JSONResponse: true, Logger: a.Log, MaxRequestBodyBytes: maxMCPBody, PropagateRequestCancellation: true,
		// Callers authenticate with a bearer key, never a cookie, so a
		// page rebinding its DNS to a private address gains nothing; and
		// behind a reverse proxy on the same host every request arrives on
		// loopback with the public Host, which the SDK's guard would refuse.
		DisableLocalhostProtection: true,
	})
	serve := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, _ := keyActor(r)
		if !key.Key.HasScope(authz.ScopeMCP) {
			mcpError(w, http.StatusForbidden, "missing_scope", "This API key does not have the mcp scope. Create a key with the MCP scope.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), mcpRequestTimeout)
		defer cancel()
		s, err := srv.For(ctx, mcpserver.NewKeyCaller(a.actor(r)))
		if err != nil {
			a.Log.ErrorContext(ctx, "mcp server", "err", err)
			mcpError(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again shortly.")
			return
		}
		sdk.ServeHTTP(w, r.WithContext(context.WithValue(ctx, mcpServerKey{}, s)))
	})
	noKey := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mcpError(w, http.StatusUnauthorized, "invalid_api_key", "Send an API key with the mcp scope as: Authorization: Bearer <key>")
	})
	withKey := a.keyOr(noKey, serve, mcpError)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		on, err := a.Platform.MCPEnabled(r.Context())
		if err != nil {
			a.Log.ErrorContext(r.Context(), "mcp switch", "err", err)
			mcpError(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again shortly.")
			return
		}
		if !on {
			mcpError(w, http.StatusNotFound, "mcp_off", "The MCP server is off. A platform admin can turn it on under Admin, Overview, Features.")
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			mcpError(w, http.StatusMethodNotAllowed, "method_not_allowed", "This MCP server is stateless: send every request with POST.")
			return
		}
		withKey.ServeHTTP(w, r)
	})
}

// mcpError writes a refusal as an HTTP status with a JSON-RPC error body
// (id null: the request wasn't read), which MCP clients show; code is the
// Grounded error code, in data. A 401 names the Bearer scheme.
func mcpError(w http.ResponseWriter, status int, code, message string) {
	rpc := rpcInvalid
	switch status {
	case http.StatusUnauthorized:
		rpc = rpcUnauthorized
		w.Header().Set("WWW-Authenticate", `Bearer realm="grounded"`)
	case http.StatusForbidden:
		rpc = rpcForbidden
	case http.StatusNotFound:
		rpc = rpcNotFound
	case http.StatusTooManyRequests:
		rpc = rpcRateLimited
	case http.StatusInternalServerError:
		rpc = rpcInternal
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": nil,
		"error": map[string]any{"code": rpc, "message": message, "data": map[string]any{"code": code}}})
}

// mcpOn reports the switch for /v1/me.
func (a *api) mcpOn(ctx context.Context) bool {
	if a.Platform == nil {
		return false
	}
	on, err := a.Platform.MCPEnabled(ctx)
	return err == nil && on
}

func toAPIMCPSettings(st dbgen.McpSetting) apitypes.MCPSettings {
	return apitypes.MCPSettings{Enabled: st.Enabled, Revision: st.Revision, UpdatedAt: st.UpdatedAt}
}

func (a *api) adminGetMCPSettings(w http.ResponseWriter, r *http.Request) {
	st, err := a.Platform.MCPSettings(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIMCPSettings(st))
}

func (a *api) adminPutMCPSettings(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.MCPSettingsUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.Platform.SetMCPEnabled(r.Context(), a.actor(r), in.Enabled, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIMCPSettings(st))
}
