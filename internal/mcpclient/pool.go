// Agents' tool calls reuse one connection per server (#251). Before, every call built a transport, dialled, did the
// TLS handshake and the MCP handshake (server/discover, or initialize), then called the tool: several round trips to
// the server before the call itself. Now each server has one guarded transport and one MCP session, kept for the
// server's revision: an edit (its URL, header, timeout) starts afresh.
//
// What doesn't change: the transport's dialler is the guarded one (guard.go), so every new connection (the first,
// one after an idle connection closed, one after an error) checks every address the host resolves to and is pinned to
// the checked one; a kept connection stays on the address it was checked for, whatever DNS says later. Calls still
// check the server's row (enabled, ceiling) every time (call.go); Test server, Read tools and the health job still
// open a connection of their own, so they test what a first call would meet.

package mcpclient

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// sessionIdle is how long an unused session is kept: past it, the next call opens a new one (and the sweep closes
// sessions of servers no longer called).
const sessionIdle = 2 * time.Minute

// pool keeps one connection per server. The zero pool is ready to use.
type pool struct {
	mu sync.Mutex
	m  map[uuid.UUID]*pooled
}

// pooled is one server's transport and session, for one revision and target.
type pooled struct {
	revision int64
	target   target
	client   *http.Client
	done     func() // closes the transport's idle connections

	mu       sync.Mutex
	sess     *mcp.ClientSession
	lastUsed time.Time
	retired  bool // replaced or swept: no new session is opened on it
}

// errRetired: the connection was replaced while a call was getting it (the call gets the new one).
var errRetired = errors.New("mcpclient: connection replaced")

// server returns the server's pooled connection for this revision and target, replacing one kept for another (the old
// one is closed once calls still using it had time to end), and closes sessions idle for longer than sessionIdle.
func (s *Service) pooledServer(id uuid.UUID, revision int64, t target) *pooled {
	p := &s.conns
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.m == nil {
		p.m = map[uuid.UUID]*pooled{}
	}
	for key, e := range p.m {
		if key != id && e.idle() {
			delete(p.m, key)
			e.retire(0)
		}
	}
	if e, ok := p.m[id]; ok {
		if e.revision == revision && e.target == t {
			return e
		}
		e.retire(e.target.timeout)
	}
	e := &pooled{revision: revision, target: t}
	e.client, e.done = s.httpClient(t)
	p.m[id] = e
	return e
}

// idle reports whether the session went unused for sessionIdle.
func (e *pooled) idle() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return time.Since(e.lastUsed) > sessionIdle
}

// retire closes the session and the idle connections after grace (calls in flight on them end first).
func (e *pooled) retire(grace time.Duration) {
	e.mu.Lock()
	e.retired = true
	e.mu.Unlock()
	time.AfterFunc(grace, func() {
		e.mu.Lock()
		sess := e.sess
		e.sess = nil
		e.mu.Unlock()
		if sess != nil {
			_ = sess.Close()
		}
		e.done()
	})
}

// session returns the open session, or opens one (one handshake for concurrent callers). An idle session is replaced:
// a server may have ended it.
func (s *Service) session(ctx context.Context, e *pooled) (*mcp.ClientSession, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.retired {
		return nil, errRetired
	}
	if e.sess != nil && time.Since(e.lastUsed) > sessionIdle {
		_ = e.sess.Close()
		e.sess = nil
	}
	if e.sess == nil {
		cs, err := s.connect(ctx, e.target, e.client)
		if err != nil {
			return nil, err
		}
		e.sess = cs
	}
	e.lastUsed = time.Now()
	return e.sess, nil
}

// drop forgets a session that failed (if it is still the kept one): the next call opens a new one.
func (e *pooled) drop(cs *mcp.ClientSession) {
	e.mu.Lock()
	if e.sess == cs {
		e.sess = nil
	}
	e.mu.Unlock()
	_ = cs.Close()
}

// pooledCall calls a tool on the server's kept session. A session the server no longer knows (HTTP 404 for its
// session ID, which the server sends without running the request: MCP's Streamable HTTP transport, "Session
// Management") is replaced and the call made once more. Any other failure is the call's error and drops the session
// too, so the next call starts afresh rather than on a connection that may be broken (a tool's own error is a result,
// not a failure, and keeps it).
func (s *Service) pooledCall(ctx context.Context, id uuid.UUID, revision int64, t target, params *mcp.CallToolParams) (*mcp.CallToolResult, error) {
	e := s.pooledServer(id, revision, t)
	for attempt := 0; ; {
		cs, err := s.session(ctx, e)
		if errors.Is(err, errRetired) {
			e = s.pooledServer(id, revision, t)
			continue
		}
		if err != nil {
			return nil, err
		}
		res, err := cs.CallTool(ctx, params)
		if err == nil {
			return res, nil
		}
		missing := errors.Is(err, mcp.ErrSessionMissing)
		e.drop(cs)
		if !missing || attempt > 0 || ctx.Err() != nil {
			return nil, err
		}
		attempt++
		if ex := exchangeOf(ctx); ex != nil {
			ex.reset() // the 404 was the old session's, not this call's
		}
	}
}

// Close closes every kept session and connection (at shutdown, and in tests).
func (s *Service) Close() {
	p := &s.conns
	p.mu.Lock()
	defer p.mu.Unlock()
	for id, e := range p.m {
		delete(p.m, id)
		e.retire(0)
	}
}
