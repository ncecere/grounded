package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
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

// A body that is valid JSON but does not fit (an unknown field, the wrong type) says so and names the field, instead of "not valid JSON" (QA pass
// v0.6.0, #115). The code stays invalid_json: clients match on it.
func TestDecodeNamesTheProblem(t *testing.T) {
	type nested struct {
		Count int `json:"count"`
	}
	type body struct {
		Name  string   `json:"name"`
		Limit int      `json:"limit"`
		Ratio float64  `json:"ratio"`
		On    bool     `json:"on"`
		Tags  []string `json:"tags"`
		Inner nested   `json:"inner"`
	}
	cases := []struct {
		name, in string
		want     []string // all must appear in the message
		never    []string
	}{
		{"unknown field", `{"name":"a","kbIds":[1]}`, []string{`Unknown field "kbIds"`}, nil},
		{"text where a number goes", `{"limit":"5"}`, []string{`"limit"`, "a whole number"}, []string{"int", "Go"}},
		{"number where text goes", `{"name":5}`, []string{`"name"`, "text"}, nil},
		{"text where true or false goes", `{"on":"yes"}`, []string{`"on"`, "true or false"}, nil},
		{"object where a list goes", `{"tags":{}}`, []string{`"tags"`, "a list"}, nil},
		{"a nested field is named with its path", `{"inner":{"count":"x"}}`, []string{`"inner.count"`, "a whole number"}, nil},
		{"broken JSON", `{"name":`, []string{"not valid JSON"}, nil},
		{"syntax error", `{name: 1}`, []string{"not valid JSON"}, nil},
		{"empty body", ``, []string{"empty"}, nil},
		{"a very long unknown field name is cut", `{"` + strings.Repeat("x", 500) + `":1}`, []string{"Unknown field"}, []string{strings.Repeat("x", 100)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest("POST", "/", strings.NewReader(tc.in))
			r.Header.Set("Content-Type", "application/json")
			var b body
			if Decode(w, r, &b) {
				t.Fatal("accepted")
			}
			var env struct {
				Error struct{ Code, Message string }
			}
			if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
				t.Fatalf("not an error envelope: %s", w.Body)
			}
			msg := env.Error.Message
			if w.Code != http.StatusBadRequest || env.Error.Code != "invalid_json" {
				t.Fatalf("want 400 invalid_json, got %d %s", w.Code, w.Body)
			}
			for _, want := range tc.want {
				if !strings.Contains(msg, want) {
					t.Errorf("message %s lacks %q", msg, want)
				}
			}
			for _, bad := range tc.never {
				if strings.Contains(msg, bad) {
					t.Errorf("message %s holds %q", msg, bad)
				}
			}
		})
	}
}
