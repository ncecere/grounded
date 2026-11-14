package mcpclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// statefulServer is an MCP server that keeps sessions (Mcp-Session-Id, for clients on the initialize handshake) and
// counts handshake requests (server/discover, then initialize when it falls back to it), tool calls served and TCP
// connections. expireNext answers the next request of a session 404, as a
// server that ended the session does.
type statefulServer struct {
	*httptest.Server
	handshakes, calls, conns atomic.Int32
	expireNext               atomic.Bool
}

func newStatefulServer(t *testing.T) *statefulServer {
	t.Helper()
	srv := mcp.NewServer(&mcp.Implementation{Name: "stateful", Version: "1.0.0"}, nil)
	srv.AddTool(&mcp.Tool{Name: "echo", InputSchema: json.RawMessage(`{"type":"object"}`)},
		func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "pong"}}}, nil
		})
	sdk := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv }, &mcp.StreamableHTTPOptions{JSONResponse: true, DisableLocalhostProtection: true})
	s := &statefulServer{}
	s.Server = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(body))
		var msg struct{ Method string }
		_ = json.Unmarshal(body, &msg)
		if r.Header.Get("Mcp-Session-Id") != "" && s.expireNext.CompareAndSwap(true, false) {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
		switch msg.Method {
		case "initialize", "server/discover":
			s.handshakes.Add(1)
		case "tools/call":
			s.calls.Add(1)
		}
		sdk.ServeHTTP(w, r)
	}))
	s.Config.ConnState = func(_ net.Conn, st http.ConnState) {
		if st == http.StateNew {
			s.conns.Add(1)
		}
	}
	s.Start()
	t.Cleanup(s.Close)
	return s
}

func (s *statefulServer) target() target {
	return target{url: s.URL + "/mcp", timeout: 5 * time.Second}
}

func echo(t *testing.T, s *Service, id uuid.UUID, revision int64, tgt target) {
	t.Helper()
	res, err := s.call(context.Background(), id, revision, tgt, "echo", nil)
	if err != nil || res.Text != "pong" {
		t.Fatalf("echo = %+v, %v", res, err)
	}
}

// Calls to one server share one MCP session and one connection (#251), on the current protocol and on the initialize
// handshake, concurrent calls too; another revision of the server starts afresh.
func TestCallsReuseTheSession(t *testing.T) {
	for _, version := range []string{"", "2025-06-18"} {
		t.Run("protocol "+version, func(t *testing.T) {
			fake := newStatefulServer(t)
			s := testService(true)
			s.protocolVersion = version
			t.Cleanup(s.Close)
			id := uuid.New()
			echo(t, s, id, 1, fake.target())
			handshake := fake.handshakes.Load()
			for range 2 {
				echo(t, s, id, 1, fake.target())
			}
			var wg sync.WaitGroup
			for range 4 {
				wg.Go(func() { echo(t, s, id, 1, fake.target()) })
			}
			wg.Wait()
			if h, c := fake.handshakes.Load(), fake.calls.Load(); h != handshake || c != 7 {
				t.Fatalf("%d handshake requests for %d calls, want %d (the first call's) for 7", h, c, handshake)
			}
			if n := fake.conns.Load(); n > 4 {
				t.Errorf("%d TCP connections for 7 calls (at most one per concurrent call)", n)
			}
			echo(t, s, id, 2, fake.target()) // the server was edited
			if h := fake.handshakes.Load(); h != 2*handshake {
				t.Fatalf("a new revision reused the old session (%d handshakes)", h)
			}
		})
	}
}

// A session the server ended (404 for its session ID) is replaced and the call made once more, without the caller
// seeing it; the request the server refused never ran.
func TestCallReconnectsAfterTheSessionExpired(t *testing.T) {
	fake := newStatefulServer(t)
	s := testService(true)
	s.protocolVersion = "2025-06-18" // sessions with an ID: initialize
	t.Cleanup(s.Close)
	id := uuid.New()
	echo(t, s, id, 1, fake.target())
	fake.expireNext.Store(true)
	echo(t, s, id, 1, fake.target())
	if h, c := fake.handshakes.Load(), fake.calls.Load(); h != 2 || c != 2 {
		t.Fatalf("%d handshakes and %d calls served, want 2 and 2", h, c)
	}
	echo(t, s, id, 1, fake.target())
	if h := fake.handshakes.Load(); h != 2 {
		t.Fatalf("the new session wasn't kept (%d handshakes)", h)
	}
}

// A failed exchange drops the session: the next call opens a new one instead of failing on the broken one.
func TestCallDropsAFailedSession(t *testing.T) {
	fake := newStatefulServer(t)
	s := testService(true)
	t.Cleanup(s.Close)
	id := uuid.New()
	echo(t, s, id, 1, fake.target())
	fake.Close() // the server goes away
	var e *Error
	if _, err := s.call(context.Background(), id, 1, fake.target(), "echo", nil); !errors.As(err, &e) || e.Class != ClassUnavailable {
		t.Fatalf("call to a server that went away = %v", err)
	}
	if s.conns.m[id].sess != nil {
		t.Fatal("the failed session was kept")
	}
}

// The kept connection still dials through the guarded dialer: every new connection resolves the host and checks the
// addresses, and one that resolves to a refused address fails, now and on the next call.
func TestPooledCallsDialThroughTheGuard(t *testing.T) {
	fake := newStatefulServer(t)
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(fake.URL, "http://"))
	tgt := target{url: "http://mcp.test:" + port + "/mcp", timeout: 5 * time.Second}
	var lookups atomic.Int32
	loopback := func(context.Context, string) ([]netip.Addr, error) {
		lookups.Add(1)
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	}

	allowed := testService(true)
	allowed.lookup = loopback
	t.Cleanup(allowed.Close)
	id := uuid.New()
	echo(t, allowed, id, 1, tgt)
	first := lookups.Load()
	echo(t, allowed, id, 1, tgt)
	if lookups.Load() != first {
		t.Fatal("a kept connection was dialled again")
	}
	allowed.conns.m[id].done() // the idle connection closes (IdleConnTimeout, or the server)
	echo(t, allowed, id, 1, tgt)
	if lookups.Load() == first {
		t.Fatal("a new connection didn't go through the guarded dialer")
	}

	guarded := testService(false)
	guarded.lookup = loopback
	t.Cleanup(guarded.Close)
	for range 2 {
		var e *Error
		if _, err := guarded.call(context.Background(), id, 1, tgt, "echo", nil); !errors.As(err, &e) || e.Class != ClassConfig {
			t.Fatalf("a host resolving to loopback = %v, want the address refused", err)
		}
	}
}
