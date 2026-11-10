package gateway

import (
	"net/http"
	"testing"
	"time"
)

// Every client shares one transport that keeps enough idle connections for an
// answer's burst of calls, and a replaced http.DefaultTransport is followed.
func TestClientsShareATransport(t *testing.T) {
	a, b := New("http://gateway.example", "k", time.Second), New("http://gateway.example", "k", time.Minute)
	ta, ok := a.HTTP.Transport.(*http.Transport)
	if !ok || a.HTTP.Transport != b.HTTP.Transport {
		t.Fatalf("clients do not share a transport: %T %p %p", a.HTTP.Transport, a.HTTP.Transport, b.HTTP.Transport)
	}
	if ta.MaxIdleConnsPerHost != idleConnsPerGateway {
		t.Fatalf("idle connections per gateway = %d", ta.MaxIdleConnsPerHost)
	}
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	replaced := old.(*http.Transport).Clone()
	replaced.ResponseHeaderTimeout = 7 * time.Second
	http.DefaultTransport = replaced
	tc := New("http://gateway.example", "k", time.Second).HTTP.Transport.(*http.Transport)
	if tc == ta || tc.ResponseHeaderTimeout != 7*time.Second || tc.MaxIdleConnsPerHost != idleConnsPerGateway {
		t.Fatalf("a replaced default transport was not followed: %+v", tc.ResponseHeaderTimeout)
	}
}
