package webhooks

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"regexp"
	"strings"
	"syscall"
	"testing"
	"time"
)

// What a delivery's error says is shown to the people who manage the webhook: the kind of failure, never an address.
func TestDescribeNamesTheKindOfFailureAndNoAddress(t *testing.T) {
	dnsErr := &net.DNSError{Err: "no such host", Name: "hooks.example.com", Server: "10.96.0.10:53", IsNotFound: true}
	timeout := &net.OpError{Op: "dial", Net: "tcp", Addr: &net.TCPAddr{IP: net.ParseIP("203.0.113.9"), Port: 443}, Err: context.DeadlineExceeded}
	refused := &net.OpError{Op: "dial", Net: "tcp", Addr: &net.TCPAddr{IP: net.ParseIP("203.0.113.9"), Port: 443}, Err: syscall.ECONNREFUSED}
	for _, c := range []struct {
		name string
		err  error
		want string
	}{
		{"blocked", fmt.Errorf(`Post "https://x.example.com/": %w`, ErrBlockedAddress), "private or internal address"},
		{"dns", fmt.Errorf("resolve hooks.example.com: %w", dnsErr), "could not be resolved"},
		{"timeout", fmt.Errorf("Post: %w", timeout), "did not answer in time"},
		{"deadline", fmt.Errorf("Post: %w", context.DeadlineExceeded), "did not answer in time"},
		{"refused", fmt.Errorf("Post: %w", refused), "refused the connection"},
		{"reset", fmt.Errorf("read tcp 10.1.2.3:5555->203.0.113.9:443: %w", syscall.ECONNRESET), "connection was reset"},
		{"plain http", tls.RecordHeaderError{Msg: "first record does not look like a TLS handshake", Conn: nil}, "does not speak TLS"},
		{"anything else", errors.New("dial tcp 203.0.113.9:443: i/o error on 10.0.0.4"), "could not be reached"},
	} {
		got := describe(c.err)
		if !strings.Contains(got, c.want) {
			t.Errorf("%s: %q, want it to say %q", c.name, got, c.want)
		}
		if regexp.MustCompile(`\d+\.\d+\.\d+\.\d+|:\d{2,5}\b|lookup|dial tcp`).MatchString(got) {
			t.Errorf("%s: %q names an address or a raw error", c.name, got)
		}
	}
}

// The same through the real client: a certificate nobody trusts, and a host that resolves to a private address.
func TestDescribeRealClientFailures(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer srv.Close()
	dialSrv := func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}
	public := func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}
	untrusted := NewClient(ClientConfig{Lookup: public, Dial: dialSrv, Timeout: 3 * time.Second}) // no RootCAs: the test server's certificate is unknown
	_, err := untrusted.Post(t.Context(), "https://example.com/hook", nil, nil)
	if got := describe(err); !strings.Contains(got, "TLS certificate could not be verified") {
		t.Errorf("untrusted certificate: %q (from %v)", got, err)
	}
	private := NewClient(ClientConfig{Lookup: func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("10.0.0.7")}, nil
	}})
	_, err = private.Post(t.Context(), "https://example.com/hook", nil, nil)
	if got := describe(err); !strings.Contains(got, "private or internal address") || strings.Contains(got, "10.0.0.7") {
		t.Errorf("private address: %q", got)
	}
}
