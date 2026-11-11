package connector

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// through returns a client whose every connection goes to srv, whatever the host resolves to, so the address check can
// be tested with names that resolve to chosen addresses.
func through(srv *httptest.Server, o Outbound, resolve map[string]string) *http.Client {
	o.Lookup = func(_ context.Context, host string) ([]netip.Addr, error) {
		ip, ok := resolve[host]
		if !ok {
			return nil, errors.New("no such host")
		}
		return []netip.Addr{netip.MustParseAddr(ip)}, nil
	}
	o.Dial = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}
	return NewHTTPClient(o)
}

func TestOutboundRefusesPrivateAddresses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) }))
	defer srv.Close()
	resolve := map[string]string{"public.example.org": "93.184.216.34", "wiki.internal": "10.1.2.3", "rebind.example.org": "127.0.0.1",
		"metadata.example.org": "169.254.169.254", "allowed.internal": "10.9.9.9"}
	c := through(srv, Outbound{PrivateHosts: []string{" Allowed.Internal "}}, resolve)
	for host, blocked := range map[string]bool{"public.example.org": false, "allowed.internal": false, "wiki.internal": true,
		"rebind.example.org": true, "metadata.example.org": true, "10.1.2.3": true, "127.0.0.1": true, "[::1]": true} {
		res, err := c.Get("http://" + host + "/")
		if res != nil {
			res.Body.Close()
		}
		if got := errors.Is(err, ErrBlockedAddress); got != blocked {
			t.Errorf("%s: blocked = %v (%v), want %v", host, got, err, blocked)
		}
	}
	if _, err := c.Get("http://unknown.example.org/"); err == nil || !strings.Contains(err.Error(), "resolve") {
		t.Errorf("a host that does not resolve: %v", err)
	}
	// AllowPrivate is for tests only.
	if res, err := through(srv, Outbound{AllowPrivate: true}, resolve).Get("http://wiki.internal/"); err != nil {
		t.Errorf("with AllowPrivate: %v", err)
	} else {
		res.Body.Close()
	}
}

func TestOutboundChecksEveryRedirect(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host == "public.example.org" {
			http.Redirect(w, r, "http://wiki.internal/secret", http.StatusFound)
			return
		}
		_, _ = w.Write([]byte("secret"))
	}))
	defer srv.Close()
	c := through(srv, Outbound{}, map[string]string{"public.example.org": "93.184.216.34", "wiki.internal": "10.1.2.3"})
	if _, err := c.Get("http://public.example.org/"); !errors.Is(err, ErrBlockedAddress) {
		t.Errorf("a redirect to a private address: %v", err)
	}
}

func TestOutboundWaitsWhenThrottled(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch n := calls.Add(1); {
		case r.URL.Path == "/always":
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
		case r.URL.Path == "/long":
			w.Header().Set("Retry-After", "3600")
			w.WriteHeader(http.StatusTooManyRequests)
		case r.URL.Path == "/unavailable":
			w.WriteHeader(http.StatusServiceUnavailable) // no Retry-After: an outage, not a throttle
		case n == 1:
			w.Header().Set("Retry-After", "7")
			w.WriteHeader(http.StatusTooManyRequests)
		case n == 2:
			w.WriteHeader(http.StatusTooManyRequests) // no header: back off
		default:
			_, _ = w.Write([]byte("ok"))
		}
	}))
	defer srv.Close()
	var waits []time.Duration
	c := through(srv, Outbound{MaxRetries: 3, MaxWait: time.Minute, Sleep: func(_ context.Context, d time.Duration) error {
		waits = append(waits, d)
		return nil
	}}, map[string]string{"api.example.org": "93.184.216.34"})

	res, err := c.Get("http://api.example.org/items")
	if err != nil || res.StatusCode != 200 || calls.Load() != 3 {
		t.Fatalf("a throttled request = %v %v after %d calls", res, err, calls.Load())
	}
	res.Body.Close()
	if len(waits) != 2 || waits[0] != 7*time.Second || waits[1] != 2*time.Second {
		t.Errorf("waits = %v, want what the provider asked for, then a back-off", waits)
	}
	for path, want := range map[string]struct {
		status, calls int
	}{"/always": {429, 4}, "/long": {429, 1}, "/unavailable": {503, 1}} {
		calls.Store(0)
		res, err := c.Get("http://api.example.org" + path)
		if err != nil || res.StatusCode != want.status || int(calls.Load()) != want.calls {
			t.Errorf("%s = %v %v after %d calls, want %d after %d", path, res, err, calls.Load(), want.status, want.calls)
		}
		if res != nil {
			res.Body.Close()
		}
	}
	// A body that can be sent again is; the wait stops with the request.
	calls.Store(0)
	res, err = c.Post("http://api.example.org/items", "application/json", strings.NewReader(`{"q":1}`))
	if err != nil || res.StatusCode != 200 {
		t.Errorf("a throttled POST = %v %v", res, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	stop := through(srv, Outbound{Sleep: func(ctx context.Context, _ time.Duration) error { cancel(); return ctx.Err() }},
		map[string]string{"api.example.org": "93.184.216.34"})
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://api.example.org/always", nil)
	if _, err := stop.Do(req); !errors.Is(err, context.Canceled) {
		t.Errorf("a cancelled wait: %v", err)
	}
}
