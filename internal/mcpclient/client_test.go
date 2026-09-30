package mcpclient

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/testutil"
)

func testService(allowPrivate bool) *Service {
	return &Service{AllowPrivate: allowPrivate, Log: slog.New(slog.DiscardHandler), lookup: defaultResolver}
}

func TestNormalizeURL(t *testing.T) {
	for _, c := range []struct {
		in           string
		allowPrivate bool
		ok           bool
	}{
		{"https://status.example.edu/mcp", false, true},
		{"  https://status.example.edu/mcp ", false, true},
		{"http://status.example.edu/mcp", false, false},  // https only
		{"http://status.example.edu/mcp", true, false},   // http only for loopback
		{"http://127.0.0.1:9000/mcp", false, false},      // loopback refused
		{"http://127.0.0.1:9000/mcp", true, true},        // the development allowance
		{"http://localhost:9000/mcp", true, true},        // loopback by name
		{"https://localhost/mcp", false, false},          // loopback by name refused
		{"https://10.1.2.3/mcp", false, false},           // private
		{"https://169.254.169.254/latest", false, false}, // link-local (metadata)
		{"https://[fe80::1]/mcp", false, false},          // IPv6 link-local
		{"https://10.1.2.3/mcp", true, true},             // private with the allowance
		{"https://8.8.8.8/mcp", false, true},             // a public literal
		{"https://user:pw@status.example.edu/mcp", false, false},
		{"https://status.example.edu/mcp?key=secret", false, false},
		{"https://status.example.edu/mcp#x", false, false},
		{"ftp://status.example.edu/mcp", false, false},
		{"status.example.edu/mcp", false, false},
		{"https://" + strings.Repeat("a", 500) + ".example.edu/", false, false},
	} {
		_, err := NormalizeURL(c.in, c.allowPrivate)
		if (err == nil) != c.ok {
			t.Errorf("NormalizeURL(%q, %v) = %v, want ok %v", c.in, c.allowPrivate, err, c.ok)
		}
	}
	// Each problem says what it is.
	for in, want := range map[string]string{
		"https://user:pw@status.example.edu/mcp":     "user name or password",
		"https://status.example.edu/mcp?key=secret":  "can't have a query",
		"https://status.example.edu/mcp#x":           "can't have a fragment",
		"status.example.edu/mcp":                     "Enter a full URL",
		"ftp://status.example.edu/mcp":               "must use https.",
		"https://" + strings.Repeat("a", 500) + ".x": "too long",
	} {
		if _, err := NormalizeURL(in, false); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("NormalizeURL(%.40q) = %v, want %q", in, err, want)
		}
	}
}

// The dialer refuses a host that resolves to a private address (a DNS
// change can't point a registered server inside), unless allowed.
func TestDialerRefusesPrivateResolution(t *testing.T) {
	d := &dialer{lookup: func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("203.0.114.1"), netip.MustParseAddr("10.0.0.5")}, nil
	}}
	if _, err := d.dial(context.Background(), "tcp", "status.example.edu:443"); !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("mixed answer: %v", err)
	}
	if _, err := d.dial(context.Background(), "tcp", "127.0.0.1:1"); !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("loopback literal: %v", err)
	}
}

func TestListAndCallAgainstTheFake(t *testing.T) {
	fake := testutil.NewFakeMCP(t)
	fake.RequireHeader("X-API-Key", "k-123456789")
	s := testService(true)
	tgt := target{url: fake.URL(), headerName: "X-API-Key", headerValue: "k-123456789", timeout: 5 * time.Second}
	ctx := context.Background()

	tools, err := s.listTools(ctx, tgt)
	if err != nil || len(tools) != 5 || tools[1].Name != "check_outage" || !strings.Contains(string(tools[1].InputSchema), `"service"`) {
		t.Fatalf("tools = %+v, %v", tools, err)
	}
	res, err := s.call(ctx, tgt, "check_outage", json.RawMessage(`{"service":"email"}`))
	if err != nil || res.IsError || res.Text != "Service email: operating normally. No outages reported." {
		t.Fatalf("check_outage = %+v, %v", res, err)
	}
	calls := fake.Calls()
	if len(calls) != 1 || string(calls[0].Arguments) != `{"service":"email"}` {
		t.Fatalf("calls = %+v", calls)
	}

	// A tool error is a result with isError, not a failure.
	if res, err := s.call(ctx, tgt, "broken", nil); err != nil || !res.IsError || res.Text != "the backend is down" {
		t.Fatalf("broken = %+v, %v", res, err)
	}
	// The result the model reads is cut, with a note.
	res, err = s.call(ctx, tgt, "huge", nil)
	if err != nil || !res.Truncated || res.Size != testutil.FakeMCPHugeChars || !strings.Contains(res.Text, "[The result was cut") {
		t.Fatalf("huge = size %d truncated %v, %v", res.Size, res.Truncated, err)
	}
	// An MRTR input request is refused.
	var e *Error
	if _, err := s.call(ctx, tgt, "needs_input", nil); !errors.As(err, &e) || e.Class != ClassInputRequired {
		t.Fatalf("needs_input = %v", err)
	}
	// The server's timeout bounds a call.
	fake.SetSlowDelay(5 * time.Second)
	short := tgt
	short.timeout = 300 * time.Millisecond
	start := time.Now()
	if _, err := s.call(ctx, short, "slow", nil); !errors.As(err, &e) || e.Class != ClassTimeout || time.Since(start) > 3*time.Second {
		t.Fatalf("slow = %v after %s", err, time.Since(start))
	}
}

func TestErrorClasses(t *testing.T) {
	fake := testutil.NewFakeMCP(t)
	fake.RequireHeader("Authorization", "Bearer right")
	s := testService(true)
	ctx := context.Background()
	var e *Error

	// Wrong credentials: auth, with the status.
	_, err := s.listTools(ctx, target{url: fake.URL(), headerName: "Authorization", headerValue: "Bearer wrong", timeout: 5 * time.Second})
	if !errors.As(err, &e) || e.Class != ClassAuth || e.HTTPStatus != 401 || strings.Contains(e.Message, "wrong") {
		t.Fatalf("wrong key = %#v", err)
	}
	// The private address rule applies when dialling.
	if _, err := testService(false).listTools(ctx, target{url: fake.URL(), timeout: 5 * time.Second}); !errors.As(err, &e) || e.Class != ClassConfig {
		t.Fatalf("loopback without the allowance = %v", err)
	}
	// Redirects are never followed.
	redirect := httptest.NewServer(http.RedirectHandler(fake.URL(), http.StatusTemporaryRedirect))
	defer redirect.Close()
	if _, err := s.listTools(ctx, target{url: redirect.URL, timeout: 5 * time.Second}); !errors.As(err, &e) || e.Class != ClassConfig {
		t.Fatalf("redirect = %v", err)
	}
	// Nothing listening: unavailable.
	if _, err := s.listTools(ctx, target{url: "http://127.0.0.1:1/mcp", timeout: 2 * time.Second}); !errors.As(err, &e) || e.Class != ClassUnavailable {
		t.Fatalf("closed port = %v", err)
	}
	// A response over the cap.
	small := testService(true)
	small.MaxResponseBytes = 64
	_, err = small.listTools(ctx, target{url: fake.URL(), headerName: "Authorization", headerValue: "Bearer right", timeout: 5 * time.Second})
	if !errors.As(err, &e) || e.Class != ClassTooLarge {
		t.Fatalf("over the cap = %v", err)
	}
}
