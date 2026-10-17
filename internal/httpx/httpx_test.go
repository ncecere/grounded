package httpx

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"
)

func TestClientIP(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	cases := []struct {
		name, remote, xff, want string
	}{
		{"direct client ignores header", "203.0.113.5:1234", "1.2.3.4", "203.0.113.5"},
		{"trusted proxy uses header", "10.1.2.3:80", "198.51.100.7", "198.51.100.7"},
		{"spoofed left-most hop ignored", "10.1.2.3:80", "1.1.1.1, 198.51.100.7", "198.51.100.7"},
		{"chain of trusted proxies", "10.1.2.3:80", "198.51.100.7, 10.9.9.9", "198.51.100.7"},
		{"garbage header falls back to peer", "10.1.2.3:80", "not-an-ip", "10.1.2.3"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = tc.remote
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if got := ClientIP(r, trusted); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestDecode(t *testing.T) {
	type body struct {
		Name string `json:"name"`
	}
	cases := []struct {
		name, in string
		status   int
	}{
		{"ok", `{"name":"a"}`, 0},
		{"unknown field", `{"name":"a","x":1}`, http.StatusBadRequest},
		{"two objects", `{"name":"a"}{"name":"b"}`, http.StatusBadRequest},
		{"too large", `{"name":"` + strings.Repeat("a", MaxBodyBytes) + `"}`, http.StatusRequestEntityTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest("POST", "/", strings.NewReader(tc.in))
			r.Header.Set("Content-Type", "application/json")
			var b body
			ok := Decode(w, r, &b)
			if tc.status == 0 && !ok {
				t.Fatalf("unexpected failure: %s", w.Body)
			}
			if tc.status != 0 && (ok || w.Code != tc.status) {
				t.Fatalf("want %d, got ok=%v code=%d", tc.status, ok, w.Code)
			}
		})
	}
}

// A request whose client went away is logged at info as a cancellation and
// recorded as 499, not as a 500 internal error.
func TestInternalClientGone(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	w := httptest.NewRecorder()
	Internal(w, httptest.NewRequest("GET", "/v1/notifications", nil).WithContext(ctx), context.Canceled)
	if w.Code != StatusClientClosedRequest {
		t.Fatalf("status %d, want 499", w.Code)
	}
	if out := buf.String(); !strings.Contains(out, "level=INFO") || !strings.Contains(out, "client closed request") {
		t.Fatalf("log %q, want an info client cancellation", out)
	}

	buf.Reset()
	w = httptest.NewRecorder()
	Internal(w, httptest.NewRequest("GET", "/v1/notifications", nil), errors.New("boom"))
	if w.Code != http.StatusInternalServerError || !strings.Contains(buf.String(), "level=ERROR") {
		t.Fatalf("status %d log %q, want a 500 logged as an error", w.Code, buf.String())
	}
}

// Postgres text columns cannot hold U+0000: a body that spells one with the
// escape \u0000 is refused with a 400 instead of failing as a 500 at insert.
func TestJSONHasNUL(t *testing.T) {
	cases := []struct {
		name, in string
		want     bool
	}{
		{"escape in a value", `{"a":"x\u0000y"}`, true},
		{"escape in a key", `{"a\u0000":1}`, true},
		{"escape in an array", `{"a":["ok","\u0000"]}`, true},
		{"escape after an escaped quote", `{"a":"q\"\u0000"}`, true},
		{"escaped backslash then u0000 is just text", `{"a":"\\u0000"}`, false},
		{"other control escapes are fine", `{"a":"\u0001 \u001f \n \t"}`, false},
		{"u0000 followed by digits still counts", `{"a":"\u00000"}`, true},
		{"truncated escape", `{"a":"\u00`, false},
		{"no escape", `{"a":"plain"}`, false},
		{"digits outside a string", `{"a":0000}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := JSONHasNUL([]byte(tc.in)); got != tc.want {
				t.Fatalf("JSONHasNUL(%s) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestDecodeRefusesNUL(t *testing.T) {
	var b struct {
		Name string `json:"name"`
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"a\u0000b"}`))
	r.Header.Set("Content-Type", "application/json")
	if Decode(w, r, &b) {
		t.Fatal("a name with U+0000 was accepted")
	}
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"invalid_text"`) {
		t.Fatalf("want 400 invalid_text, got %d %s", w.Code, w.Body)
	}
}

// A client that sends part of a body and stops gets a 408 after BodyReadTimeout, instead of holding the connection (and a goroutine) forever
// (QA pass v0.6.0, #118). A body that arrives in time is unaffected, and the deadline does not outlive the body: a handler that keeps
// answering for longer than the timeout (a chat stream) is not cut off.
func TestDecodeGivesUpOnABodyThatStalls(t *testing.T) {
	old := BodyReadTimeout
	BodyReadTimeout = 300 * time.Millisecond
	t.Cleanup(func() { BodyReadTimeout = old })
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var v map[string]any
		if !Decode(w, r, &v) {
			return
		}
		select { // answering takes longer than the timeout, and a stream watches whether the client is still there
		case <-time.After(900 * time.Millisecond):
			w.WriteHeader(http.StatusOK)
		case <-r.Context().Done():
			w.WriteHeader(StatusClientClosedRequest)
		}
	}))
	t.Cleanup(srv.Close)

	// Stalls after ten bytes of a hundred.
	conn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	start := time.Now()
	fmt.Fprint(conn, "POST / HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"a\":\"bcd")
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	status, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil || !strings.HasPrefix(status, "HTTP/1.1 408") {
		t.Fatalf("a stalled body: status %q, err %v after %s; want a 408", status, err, time.Since(start))
	}
	if took := time.Since(start); took > 3*time.Second {
		t.Errorf("the 408 took %s", took)
	}

	// A complete body is read, and the answer may take longer than the timeout.
	res, err := http.Post(srv.URL, "application/json", strings.NewReader(`{"a":1}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("a body that arrived in time, answered slowly: %d, want 200", res.StatusCode)
	}
}
