package testutil

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// FakeMCP is a remote MCP server for tests of the MCP client
// (internal/mcpclient, docs/mcp-client.md), built with the official Go SDK
// and served statelessly over Streamable HTTP at URL(). Its tools:
//
//   - check_outage {service}: "Service <service>: operating normally. No
//     outages reported." (the citable one)
//   - slow {}: waits SetSlowDelay (default 5s) or until cancelled, then "done"
//   - huge {}: a 50,000-character result
//   - needs_input {}: an MRTR input request (elicitation), never a result
//   - broken {}: a tool error (isError)
//
// RequireHeader makes it answer 401 to requests without a header; Hide and
// SetDescription change what tools/list returns (refresh tests). Calls
// records every tools/call with its arguments and headers.
type FakeMCP struct {
	*httptest.Server

	mu           sync.Mutex
	header       string
	value        string
	slow         time.Duration
	hidden       map[string]bool
	descriptions map[string]string
	calls        []FakeMCPCall
	requests     int
}

// FakeMCPCall is one tools/call the fake served.
type FakeMCPCall struct {
	Tool      string
	Arguments json.RawMessage
	Header    http.Header
}

// FakeMCPHugeChars is the length of the huge tool's result.
const FakeMCPHugeChars = 50000

// NewFakeMCP starts the fake on a loopback address (closed with the test).
func NewFakeMCP(t testing.TB) *FakeMCP {
	f := &FakeMCP{slow: 5 * time.Second, hidden: map[string]bool{}, descriptions: map[string]string{}}
	h := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return f.server() },
		&mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true, PropagateRequestCancellation: true})
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.requests++
		name, value := f.header, f.value
		f.mu.Unlock()
		if name != "" && r.Header.Get(name) != value {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), fakeMCPHeaderKey{}, r.Header.Clone()))
		h.ServeHTTP(w, r)
	}))
	t.Cleanup(f.Close)
	return f
}

type fakeMCPHeaderKey struct{}

// URL is the Streamable HTTP endpoint.
func (f *FakeMCP) URL() string { return f.Server.URL + "/mcp" }

// RequireHeader makes every request need name: value.
func (f *FakeMCP) RequireHeader(name, value string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.header, f.value = name, value
}

// SetSlowDelay sets how long the slow tool waits.
func (f *FakeMCP) SetSlowDelay(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.slow = d
}

// Hide removes a tool from tools/list (and calls to it fail).
func (f *FakeMCP) Hide(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hidden[name] = true
}

// SetDescription changes a tool's description in tools/list.
func (f *FakeMCP) SetDescription(name, d string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.descriptions[name] = d
}

// Calls returns the tools/call requests served so far.
func (f *FakeMCP) Calls() []FakeMCPCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]FakeMCPCall(nil), f.calls...)
}

// Requests counts every HTTP request (lists and calls alike).
func (f *FakeMCP) Requests() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests
}

type fakeMCPTool struct {
	name, title, desc string
	schema            map[string]any
	run               func(ctx context.Context, args map[string]any) *mcp.CallToolResult
}

func mcpText(s string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: s}}}
}

func (f *FakeMCP) tools() []fakeMCPTool {
	empty := map[string]any{"type": "object", "properties": map[string]any{}}
	return []fakeMCPTool{
		{name: "check_outage", title: "Check outage", desc: "Reports whether a campus service has an outage right now.",
			schema: map[string]any{"type": "object", "required": []string{"service"},
				"properties": map[string]any{"service": map[string]any{"type": "string", "description": "The service, for example email"}}},
			run: func(_ context.Context, args map[string]any) *mcp.CallToolResult {
				return mcpText(fmt.Sprintf("Service %v: operating normally. No outages reported.", args["service"]))
			}},
		{name: "slow", desc: "A tool that takes a long time.", schema: empty,
			run: func(ctx context.Context, _ map[string]any) *mcp.CallToolResult {
				f.mu.Lock()
				d := f.slow
				f.mu.Unlock()
				select {
				case <-time.After(d):
				case <-ctx.Done():
				}
				return mcpText("done")
			}},
		{name: "huge", desc: "A tool with a very long result.", schema: empty,
			run: func(context.Context, map[string]any) *mcp.CallToolResult {
				return mcpText("Huge result: " + strings.Repeat("x", FakeMCPHugeChars-13))
			}},
		{name: "needs_input", desc: "A tool that asks the user a question first.", schema: empty,
			run: func(context.Context, map[string]any) *mcp.CallToolResult {
				return &mcp.CallToolResult{InputRequests: mcp.InputRequestMap{"confirm": &mcp.ElicitParams{Message: "Are you sure?"}}}
			}},
		{name: "broken", desc: "A tool that always fails.", schema: empty,
			run: func(context.Context, map[string]any) *mcp.CallToolResult {
				res := mcpText("the backend is down")
				res.IsError = true
				return res
			}},
	}
}

// server builds the MCP server of one request from the current state.
func (f *FakeMCP) server() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "fake-status", Version: "1.0.0"}, nil)
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.tools() {
		if f.hidden[t.name] {
			continue
		}
		desc := t.desc
		if d, ok := f.descriptions[t.name]; ok {
			desc = d
		}
		run := t.run
		name := t.name
		s.AddTool(&mcp.Tool{Name: t.name, Title: t.title, Description: desc, InputSchema: t.schema},
			func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				var args map[string]any
				_ = json.Unmarshal(req.Params.Arguments, &args)
				hdr, _ := ctx.Value(fakeMCPHeaderKey{}).(http.Header)
				f.mu.Lock()
				f.calls = append(f.calls, FakeMCPCall{Tool: name, Arguments: append(json.RawMessage(nil), req.Params.Arguments...), Header: hdr})
				f.mu.Unlock()
				return run(ctx, args), nil
			})
	}
	return s
}
