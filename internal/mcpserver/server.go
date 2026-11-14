package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/parallel"
	"github.com/ncecere/grounded/internal/requestcache"
	"github.com/ncecere/grounded/internal/tracing"
)

// Options configure the MCP server.
type Options struct {
	Backend Backend
	Handles *Handles
	// Version is the server version sent to clients (the build's version).
	Version string
	// Timeout bounds one tool call (a search, or an answer).
	Timeout time.Duration
	// ListTTL is how long a client may cache the tool list (ttlMs on
	// 2026-07-28); lists are private to their caller.
	ListTTL time.Duration
	Log     *slog.Logger
}

// Server builds the MCP server for each request.
type Server struct{ opts Options }

// New returns the MCP server.
func New(opts Options) *Server {
	if opts.Timeout <= 0 {
		opts.Timeout = 3 * time.Minute
	}
	if opts.Log == nil {
		opts.Log = slog.Default()
	}
	return &Server{opts: opts}
}

// instructions are sent to clients with the server's identity.
const instructions = "Grounded answers from an organisation's own documents. Use search to find passages in a knowledge base, " +
	"and ask to put a question to one of its agents, which answers with numbered citations. Quote the [n] citations you rely on."

// For builds the server a request is served by: the caller's tools, their
// enums listing what it may use (in a stable order: ask, then search).
// A tool with nothing to offer is left out: a key that may use no agents
// has no ask tool. reqCtx is the HTTP request's context: a tool call ends
// when the client goes away.
func (s *Server) For(reqCtx context.Context, c Caller) (*mcp.Server, error) {
	return s.build(reqCtx, c, true, true)
}

// ForRequest is For for one HTTP request (r's body is read and put back). A tools/call of ask or search is served
// with that tool alone (#251): its list is built exactly as For builds it, so the names the call may use, and what it
// may reach, are the same as in tools/list, read again for this request; the other tool's list isn't read.
func (s *Server) ForRequest(reqCtx context.Context, c Caller, r *http.Request) (*mcp.Server, error) {
	switch calledTool(r) {
	case toolAsk:
		return s.build(reqCtx, c, true, false)
	case toolSearch:
		return s.build(reqCtx, c, false, true)
	}
	return s.For(reqCtx, c)
}

// build builds the server with the ask tool, the search tool or both. The two lists are read concurrently, the
// knowledge bases' error first, as when they were read one after the other.
func (s *Server) build(reqCtx context.Context, c Caller, withAsk, withSearch bool) (*mcp.Server, error) {
	var (
		kbList    []KnowledgeBase
		agentList []Agent
	)
	lctx := requestcache.With(reqCtx) // the lists share the caller's teams (backend.go)
	err := parallel.InOrder(
		func() (err error) {
			if withSearch {
				kbList, err = s.opts.Backend.KnowledgeBases(lctx, c.Actor())
			}
			return err
		},
		func() (err error) {
			if withAsk {
				agentList, err = s.opts.Backend.Agents(lctx, c.Actor())
			}
			return err
		},
	)
	if err != nil {
		return nil, err
	}
	ttl := int(s.opts.ListTTL / time.Millisecond)
	srv := mcp.NewServer(&mcp.Implementation{Name: "grounded", Title: "Grounded", Version: s.opts.Version}, &mcp.ServerOptions{
		Instructions: instructions,
		Logger:       s.opts.Log,
		// Tools only: no logging, and no list-changed notifications (each
		// request is its own server; a changed list shows on the next list).
		Capabilities: &mcp.ServerCapabilities{Tools: &mcp.ToolCapabilities{}},
		SetCacheable: func(_ context.Context, _ mcp.Request, cc *mcp.Cacheable) {
			cc.TTLMs, cc.CacheScope = ttl, "private"
		},
	})
	// Each request is a span under the HTTP request's, continuing the
	// caller's trace from _meta.traceparent (docs/operations/tracing.md).
	srv.AddReceivingMiddleware(tracing.MCPServerMiddleware(toolAsk, toolSearch))
	call := &toolCall{s: s, caller: c, reqCtx: reqCtx}
	if opts := agentOptions(agentList); len(opts) > 0 {
		mcp.AddTool(srv, askTool(opts), call.ask(opts))
	}
	if opts := kbOptions(kbList); len(opts) > 0 {
		mcp.AddTool(srv, searchTool(opts), call.search(opts))
	}
	return srv, nil
}

// maxPeek bounds how much of a request body calledTool reads (a tool call's arguments are small; a larger body is
// served by For).
const maxPeek = 64 << 10

// calledTool is the tool a request calls: the name of a single JSON-RPC tools/call ("" for anything else, a batch or
// a body that can't be read, which For serves). The body is put back for the SDK, which reads and checks it as before.
func calledTool(r *http.Request) string {
	if r == nil || r.Body == nil {
		return ""
	}
	buf, err := io.ReadAll(io.LimitReader(r.Body, maxPeek+1))
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(buf), r.Body), r.Body}
	if err != nil || len(buf) > maxPeek {
		return ""
	}
	var msg struct {
		Method string `json:"method"`
		Params struct {
			Name string `json:"name"`
		} `json:"params"`
	}
	if json.Unmarshal(buf, &msg) != nil || msg.Method != "tools/call" {
		return ""
	}
	return msg.Params.Name
}

// toolCall runs the tools of one request.
type toolCall struct {
	s      *Server
	caller Caller
	reqCtx context.Context
}

// bound limits a tool call to the timeout and to the HTTP request.
func (t *toolCall) bound(ctx context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(ctx, t.s.opts.Timeout)
	stop := context.AfterFunc(t.reqCtx, cancel)
	return ctx, func() { stop(); cancel() }
}

// The tools' names.
const (
	toolAsk    = "ask"
	toolSearch = "search"
)

// Outcomes of a tool call (the metric's and the audit entry's).
const (
	outcomeOK      = "ok"
	outcomeRefused = "refused"
	outcomeError   = "error"
)

// toolError turns a service error into what the tool returns: the
// service's own message as a tool error the model can read (a refusal,
// such as a used-up budget or a query limit, is not a protocol error), or a
// generic message for an internal failure, which is logged.
func (t *toolCall) toolError(ctx context.Context, tool string, err error) (outcome, code string, out error) {
	if e, ok := apperr.As(err); ok {
		outcome = outcomeRefused
		if e.Status >= 500 {
			outcome = outcomeError
		}
		return outcome, e.Code, userError(e.Message)
	}
	var failed answerFailed
	if errors.As(err, &failed) {
		return outcomeError, failed.code, userError(failed.msg)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return outcomeError, "timeout", userError("This took too long and was stopped. Try again, perhaps with a narrower question.")
	}
	if errors.Is(err, context.Canceled) {
		return outcomeError, "cancelled", userError("The request was cancelled.")
	}
	t.s.opts.Log.ErrorContext(ctx, "mcp tool call", "tool", tool, "err", err)
	return outcomeError, "internal", userError("Something went wrong. Try again shortly.")
}

// record audits a tool call (the key or the person as the actor, never
// the content) under the target's team, and counts it.
func (t *toolCall) record(ctx context.Context, tool, targetType string, target option, meta map[string]any) {
	a := t.caller.Actor()
	e := a.Audit("mcp."+tool, targetType, target.ID.String())
	e.TeamID = target.TeamID
	if a.Key != nil {
		e.TeamID = a.Key.TeamID
	}
	if e.Metadata == nil {
		e.Metadata = map[string]any{}
	}
	e.Metadata["tool"] = tool
	for k, v := range meta {
		e.Metadata[k] = v
	}
	outcome, _ := meta["outcome"].(string)
	observability.MCPToolCalls.WithLabelValues(tool, outcome).Inc()
	if err := t.s.opts.Backend.Audit(context.WithoutCancel(ctx), e); err != nil {
		t.s.opts.Log.ErrorContext(ctx, "audit mcp tool call", "tool", tool, "err", err)
	}
}

// actor is who the tools act as.
func (t *toolCall) actor() authz.Actor { return t.caller.Actor() }

// userError is a tool error's text, written for the person (and the model)
// reading it: whole sentences.
type userError string

func (e userError) Error() string { return string(e) }
