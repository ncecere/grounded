package webhooks

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// publicIP is an address the guard accepts; the test's Dial sends it to the test server instead.
var publicIP = netip.MustParseAddr("93.184.216.34")

// serve starts a TLS server whose certificate covers example.com, and returns a client that trusts it and reaches it for publicIP.
func serve(t *testing.T, h http.HandlerFunc, cfg ClientConfig) (*Client, *httptest.Server, *atomic.Int32) {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	dials := new(atomic.Int32)
	cfg.TLS = &tls.Config{RootCAs: pool}
	if cfg.Lookup == nil {
		cfg.Lookup = func(context.Context, string) ([]netip.Addr, error) { return []netip.Addr{publicIP}, nil }
	}
	if cfg.Dial == nil {
		cfg.Dial = func(ctx context.Context, network, address string) (net.Conn, error) {
			dials.Add(1)
			if want := net.JoinHostPort(publicIP.String(), "443"); address != want {
				t.Errorf("dialled %s, want the checked address %s", address, want)
			}
			return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
		}
	}
	return NewClient(cfg), srv, dials
}

func TestClientDeliversToAPublicAddress(t *testing.T) {
	var got struct {
		method, ctype, sig, body string
	}
	c, _, dials := serve(t, func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got.method, got.ctype, got.sig, got.body = r.Method, r.Header.Get("Content-Type"), r.Header.Get("Grounded-Signature"), string(b)
		w.WriteHeader(http.StatusAccepted)
	}, ClientConfig{})
	status, err := c.Post(t.Context(), "https://example.com/hook", http.Header{"Content-Type": {"application/json"}, "Grounded-Signature": {"t=1,v1=x"}}, []byte(`{"a":1}`))
	if err != nil || status != 202 {
		t.Fatalf("Post = %d, %v", status, err)
	}
	if got.method != "POST" || got.ctype != "application/json" || got.sig != "t=1,v1=x" || got.body != `{"a":1}` || dials.Load() != 1 {
		t.Errorf("the receiver saw %+v after %d dials", got, dials.Load())
	}
}

func TestClientRefusesWhatTheCrawlerRefuses(t *testing.T) {
	for _, host := range []string{"10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "0.0.0.0"} {
		c, _, dials := serve(t, func(http.ResponseWriter, *http.Request) { t.Error("the receiver was reached") }, ClientConfig{
			Lookup: func(context.Context, string) ([]netip.Addr, error) {
				return []netip.Addr{netip.MustParseAddr(host)}, nil
			},
		})
		_, err := c.Post(t.Context(), "https://example.com/hook", nil, nil)
		if !errors.Is(err, ErrBlockedAddress) || dials.Load() != 0 {
			t.Errorf("%s: Post = %v after %d dials, want ErrBlockedAddress and no dial", host, err, dials.Load())
		}
	}
}

// One private answer among public ones refuses the host: a name that sometimes resolves inside is not safe to send to.
func TestClientRefusesAHostWithAnyPrivateAnswer(t *testing.T) {
	c, _, dials := serve(t, func(http.ResponseWriter, *http.Request) { t.Error("the receiver was reached") }, ClientConfig{
		Lookup: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{publicIP, netip.MustParseAddr("10.1.2.3")}, nil
		},
	})
	if _, err := c.Post(t.Context(), "https://example.com/hook", nil, nil); !errors.Is(err, ErrBlockedAddress) || dials.Load() != 0 {
		t.Errorf("Post = %v after %d dials", err, dials.Load())
	}
}

func TestClientRefusesAnAddressInTheURL(t *testing.T) {
	c, _, dials := serve(t, func(http.ResponseWriter, *http.Request) { t.Error("the receiver was reached") }, ClientConfig{})
	for _, u := range []string{"https://127.0.0.1/hook", "https://[::1]/hook", "https://169.254.169.254/latest/meta-data/"} {
		if _, err := c.Post(t.Context(), u, nil, nil); err == nil || dials.Load() != 0 {
			t.Errorf("%s: Post = %v after %d dials, want a refusal", u, err, dials.Load())
		}
	}
}

func TestClientFollowsNoRedirects(t *testing.T) {
	var hits atomic.Int32
	c, _, _ := serve(t, func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Redirect(w, r, "https://169.254.169.254/", http.StatusFound)
	}, ClientConfig{})
	status, err := c.Post(t.Context(), "https://example.com/hook", nil, []byte("x"))
	if err != nil || status != http.StatusFound || hits.Load() != 1 {
		t.Errorf("Post = %d, %v after %d requests, want the 302 itself and one request", status, err, hits.Load())
	}
}

func TestClientReadsLittleOfALargeAnswerAndGivesUpOnASlowOne(t *testing.T) {
	c, _, _ := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.CopyN(w, strings.NewReader(strings.Repeat("x", 8<<20)), 8<<20)
	}, ClientConfig{})
	start := time.Now()
	if status, err := c.Post(t.Context(), "https://example.com/hook", nil, nil); err != nil || status != 200 || time.Since(start) > 5*time.Second {
		t.Errorf("a large answer: %d, %v in %s", status, err, time.Since(start))
	}
	release := make(chan struct{})
	slow, _, _ := serve(t, func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
		// Do not race cancellation with the server's implicit 200 response.
		// Only release the handler after Post has returned.
		<-release
	}, ClientConfig{Timeout: 200 * time.Millisecond})
	t.Cleanup(func() { close(release) })                            // registered after serve: unblock before srv.Close
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second) // bounds a broken client too
	defer cancel()
	start = time.Now()
	if _, err := slow.Post(ctx, "https://example.com/hook", nil, nil); !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 3*time.Second {
		t.Errorf("a slow receiver: %v after %s, want a timeout", err, time.Since(start))
	}
}

func TestClientAllowPrivateIsForTests(t *testing.T) {
	c, _, _ := serve(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }, ClientConfig{
		AllowPrivate: true,
		Lookup: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		},
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, address)
		},
	})
	_ = c // the address is loopback: with AllowPrivate the guard lets the dial through to a closed port, which is a plain connection error
	if _, err := c.Post(t.Context(), "https://example.com:1/hook", nil, nil); err == nil || errors.Is(err, ErrBlockedAddress) {
		t.Errorf("Post = %v, want a connection error, not the guard's", err)
	}
}
