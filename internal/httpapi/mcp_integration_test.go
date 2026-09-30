package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The MCP server (docs/mcp.md): off until a platform admin turns it on,
// then POST /mcp for API keys with the mcp scope, with the key's own limits.

// setMCP turns the MCP server on or off as the platform admin.
func setMCP(t *testing.T, admin *session, on bool) {
	t.Helper()
	var cur apitypes.MCPSettings
	if code := admin.get("/v1/admin/settings/mcp", &cur); code != 200 {
		t.Fatalf("get mcp settings = %d", code)
	}
	var out apitypes.MCPSettings
	code, e := admin.call("PUT", "/v1/admin/settings/mcp", map[string]any{"enabled": on}, &out, ifMatch(cur.Revision))
	mustCode(t, "set mcp", code, e, 200, "")
	if out.Enabled != on {
		t.Fatalf("mcp settings = %+v", out)
	}
}

// createKey creates an API key as s and returns its secret.
func createKey(t *testing.T, s *session, base string, body map[string]any) apitypes.APIKeyCreated {
	t.Helper()
	var k apitypes.APIKeyCreated
	code, e := s.call("POST", base+"/api-keys", body, &k, nil)
	mustCode(t, "create key", code, e, 201, "")
	return k
}

// bearer adds an API key to every request of an MCP client.
type bearer struct{ key string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.key)
	return http.DefaultTransport.RoundTrip(r)
}

// mcpConnect connects the SDK's client to /mcp with a key, at a protocol
// version ("" is the SDK's latest, 2026-07-28).
func mcpConnect(t *testing.T, base, key, version string) (*mcp.ClientSession, error) {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "grounded-test", Version: "1.0.0"}, nil)
	transport := &mcp.StreamableClientTransport{Endpoint: base + "/mcp", HTTPClient: &http.Client{Transport: bearer{key}}, DisableStandaloneSSE: true}
	cs, err := client.Connect(t.Context(), transport, &mcp.ClientSessionOptions{ProtocolVersion: version})
	if err == nil {
		t.Cleanup(func() { _ = cs.Close() })
	}
	return cs, err
}

// mustConnect is mcpConnect that fails the test on an error.
func mustConnect(t *testing.T, base, key, version string) *mcp.ClientSession {
	t.Helper()
	cs, err := mcpConnect(t, base, key, version)
	if err != nil {
		t.Fatalf("connect %s: %v", version, err)
	}
	return cs
}

// rpcRefusal is a refusal's JSON-RPC error body.
type rpcRefusal struct {
	JSONRPC string
	Error   struct {
		Code    int
		Message string
		Data    struct{ Code string }
	}
}

// mcpRaw posts a JSON-RPC message to /mcp with a key ("" sends none).
func mcpRaw(t *testing.T, base, method, key string, body any) (*http.Response, rpcRefusal) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, base+"/mcp", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out rpcRefusal
	_ = json.Unmarshal(raw, &out)
	return res, out
}

var listTools = map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": map[string]any{
	"_meta": map[string]any{"io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": map[string]any{}}}}

// wantRefusal checks a refusal's status, JSON-RPC code and Grounded code.
func wantRefusal(t *testing.T, what string, res *http.Response, body rpcRefusal, status, rpc int, code string) {
	t.Helper()
	if res.StatusCode != status || body.JSONRPC != "2.0" || body.Error.Code != rpc || body.Error.Data.Code != code || body.Error.Message == "" {
		t.Fatalf("%s = %d %+v, want %d %d %s", what, res.StatusCode, body, status, rpc, code)
	}
}

func TestMCPSwitchAndKeys(t *testing.T) {
	env := newAgentEnv(t)
	url := env.app.URL
	env.publishAgent(t, "Parking helper", env.agentConfig(env.kb.Id.String()))
	key := createKey(t, env.member, env.base, map[string]any{"name": "assistant", "scopes": []string{"mcp"}})

	// Off by default: 404 with a JSON-RPC error, whatever the key.
	res, body := mcpRaw(t, url, "POST", key.Secret, listTools)
	wantRefusal(t, "while off", res, body, 404, -32004, "mcp_off")
	if _, err := mcpConnect(t, url, key.Secret, ""); err == nil {
		t.Fatal("a client connected while the server is off")
	}
	var me apitypes.Me
	if env.member.get("/v1/me", &me); me.Capabilities.Mcp == nil || *me.Capabilities.Mcp {
		t.Fatalf("capability while off = %v", me.Capabilities.Mcp)
	}

	// Platform admins turn it on (audited); auditors read it; If-Match is required.
	var st apitypes.MCPSettings
	if code := env.auditor.get("/v1/admin/settings/mcp", &st); code != 200 || st.Enabled {
		t.Fatalf("auditor read = %d %+v", code, st)
	}
	code, e := env.auditor.call("PUT", "/v1/admin/settings/mcp", map[string]any{"enabled": true}, nil, ifMatch(st.Revision))
	mustCode(t, "auditor turns it on", code, e, 403, "")
	code, e = env.admin.call("PUT", "/v1/admin/settings/mcp", map[string]any{"enabled": true}, nil, nil)
	mustCode(t, "without If-Match", code, e, 428, "")
	setMCP(t, env.admin, true)
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.mcp' AND after_state->>'enabled' = 'true'`); n != 1 {
		t.Fatalf("platform.mcp audit entries = %d", n)
	}
	if env.member.get("/v1/me", &me); me.Capabilities.Mcp == nil || !*me.Capabilities.Mcp {
		t.Fatalf("capability while on = %v", me.Capabilities.Mcp)
	}

	// Keys: none, garbage, one without the scope, then the method.
	res, body = mcpRaw(t, url, "POST", "", listTools)
	wantRefusal(t, "no key", res, body, 401, -32001, "invalid_api_key")
	if !strings.HasPrefix(res.Header.Get("WWW-Authenticate"), "Bearer") {
		t.Errorf("WWW-Authenticate = %q", res.Header.Get("WWW-Authenticate"))
	}
	res, body = mcpRaw(t, url, "POST", "rag_nope", listTools)
	wantRefusal(t, "a garbage key", res, body, 401, -32001, "invalid_api_key")
	query := createKey(t, env.member, env.base, map[string]any{"name": "rest", "scopes": []string{"query"}})
	res, body = mcpRaw(t, url, "POST", query.Secret, listTools)
	wantRefusal(t, "a key without mcp", res, body, 403, -32003, "missing_scope")
	// A refused call isn't a use: the key's Last used stays empty.
	if n := env.scalar(t, `SELECT count(*) FROM api_keys WHERE id = $1 AND last_used_at IS NOT NULL`, query.Key.Id); n != 0 {
		t.Error("a refused /mcp call set the key's Last used")
	}
	res, body = mcpRaw(t, url, "GET", key.Secret, nil)
	wantRefusal(t, "GET", res, body, 405, -32600, "method_not_allowed")
	// A session cookie is no credential here.
	code, raw := env.member.raw("POST", "/mcp", listTools, map[string]string{"Accept": "application/json, text/event-stream"})
	if code != 401 {
		t.Fatalf("a browser session = %d %s", code, raw)
	}

	checkDocumentedCurl(t, url, key.Secret)
	// The key works, at 2026-07-28 and at an older revision (and is then used).
	cs := mustConnect(t, url, key.Secret, "")
	if n := env.scalar(t, `SELECT count(*) FROM api_keys WHERE id = $1 AND last_used_at IS NOT NULL`, key.Key.Id); n != 1 {
		t.Error("an accepted /mcp call didn't set the key's Last used")
	}
	if v := cs.InitializeResult().ProtocolVersion; v != "2026-07-28" {
		t.Errorf("negotiated %s", v)
	}
	for _, version := range []string{"2025-11-25", "2025-06-18", "2025-03-26"} {
		old := mustConnect(t, url, key.Secret, version)
		if v := old.InitializeResult().ProtocolVersion; v != version {
			t.Errorf("legacy client asked for %s, got %s", version, v)
		}
		tools, err := old.ListTools(t.Context(), nil)
		if err != nil || len(tools.Tools) != 2 || tools.Tools[0].Name != "ask" || tools.Tools[1].Name != "search" {
			t.Fatalf("legacy tools %s = %+v %v", version, tools, err)
		}
		r, err := old.CallTool(t.Context(), &mcp.CallToolParams{Name: "search", Arguments: map[string]any{"knowledge_base": "student-help", "query": "parking permit"}})
		if err != nil || r.IsError || r.StructuredContent == nil {
			t.Fatalf("legacy search %s = %+v %v", version, r, err)
		}
	}

	// Revoked keys stop at once.
	revoked := createKey(t, env.member, env.base, map[string]any{"name": "gone", "scopes": []string{"mcp"}})
	mustConnect(t, url, revoked.Secret, "")
	code, e = env.member.call("DELETE", env.base+"/api-keys/"+revoked.Key.Id.String(), nil, nil, nil)
	mustCode(t, "revoke", code, e, 200, "")
	res, body = mcpRaw(t, url, "POST", revoked.Secret, listTools)
	wantRefusal(t, "a revoked key", res, body, 401, -32001, "invalid_api_key")

	// A personal key stops when its owner is suspended.
	var detail apitypes.UserDetail
	env.admin.get("/v1/admin/users/"+env.member.me.User.Id.String(), &detail)
	code, e = env.admin.call("PATCH", "/v1/admin/users/"+env.member.me.User.Id.String(), map[string]string{"status": "suspended"}, nil, ifMatch(detail.User.Revision))
	mustCode(t, "suspend", code, e, 200, "")
	res, body = mcpRaw(t, url, "POST", key.Secret, listTools)
	wantRefusal(t, "a suspended owner's key", res, body, 401, -32001, "invalid_api_key")

	// Off again: 404 for a key that worked.
	service := createKey(t, env.owner, env.base, map[string]any{"name": "svc", "kind": "service", "scopes": []string{"mcp"}})
	mustConnect(t, url, service.Secret, "")
	setMCP(t, env.admin, false)
	res, body = mcpRaw(t, url, "POST", service.Secret, listTools)
	wantRefusal(t, "turned off", res, body, 404, -32004, "mcp_off")
}

// callTool calls a tool and decodes its structured content into out.
func callTool(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any, out any) *mcp.CallToolResult {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("call %s: %v", name, err)
	}
	if out != nil && !res.IsError {
		raw, _ := json.Marshal(res.StructuredContent)
		if err := json.Unmarshal(raw, out); err != nil {
			t.Fatalf("decode %s: %v: %s", name, err, raw)
		}
	}
	return res
}

// toolText is a result's text content.
func toolText(res *mcp.CallToolResult) string {
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}

// checkDocumentedCurl sends docs/mcp.md's "Checking the connection with
// curl" requests as written: server/discover with its two headers, and the
// plain tools/list.
func checkDocumentedCurl(t *testing.T, base, key string) {
	t.Helper()
	for _, c := range []struct {
		body    string
		headers map[string]string
		want    string
	}{
		{`{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",` +
			`"io.modelcontextprotocol/clientCapabilities":{}}}}`,
			map[string]string{"Mcp-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover"}, `"grounded"`},
		{`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, nil, `"search"`},
	} {
		req, _ := http.NewRequest("POST", base+"/mcp", strings.NewReader(c.body))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		for k, v := range c.headers {
			req.Header.Set(k, v)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(res.Body)
		_ = res.Body.Close()
		if res.StatusCode != 200 || !strings.Contains(string(raw), c.want) {
			t.Errorf("documented curl %s = %d %s", c.body[:40], res.StatusCode, raw)
		}
	}
}
