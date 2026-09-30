package mcpserver

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/observability"
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
	kbList, err := s.opts.Backend.KnowledgeBases(reqCtx, c.Actor())
	if err != nil {
		return nil, err
	}
	agentList, err := s.opts.Backend.Agents(reqCtx, c.Actor())
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
	call := &toolCall{s: s, caller: c, reqCtx: reqCtx}
	if opts := agentOptions(agentList); len(opts) > 0 {
		mcp.AddTool(srv, askTool(opts), call.ask(opts))
	}
	if opts := kbOptions(kbList); len(opts) > 0 {
		mcp.AddTool(srv, searchTool(opts), call.search(opts))
	}
	return srv, nil
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

// record audits a tool call (the key as the actor, never the content) and
// counts it.
func (t *toolCall) record(ctx context.Context, tool, targetType, targetID string, meta map[string]any) {
	a := t.caller.Actor()
	e := a.Audit("mcp."+tool, targetType, targetID)
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
