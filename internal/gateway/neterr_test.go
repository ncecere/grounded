package gateway_test

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
)

// message is the admin-facing message of a failed ListModels.
func message(t *testing.T, c *gateway.Client) string {
	t.Helper()
	_, err := c.ListModels(context.Background())
	var ge *gateway.Error
	if !errors.As(err, &ge) || ge.Kind != gateway.KindUnavailable {
		t.Fatalf("want an unavailable error, got %v", err)
	}
	if strings.Contains(ge.Message, "secret-key") {
		t.Fatalf("message leaks the API key: %q", ge.Message)
	}
	return ge.Message
}

func withProxy(c *gateway.Client, proxy string) *gateway.Client {
	u, _ := url.Parse(proxy)
	c.HTTP.Transport = &http.Transport{Proxy: http.ProxyURL(u)}
	return c
}

// closedPort is a local port with nothing listening.
func closedPort(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	return addr
}

func TestTransportErrorsAreNamed(t *testing.T) {
	tlsSrv := httptest.NewUnstartedServer(http.NotFoundHandler())
	tlsSrv.Config.ErrorLog = log.New(io.Discard, "", 0) // expected handshake failures
	tlsSrv.StartTLS()
	defer tlsSrv.Close()
	plain := httptest.NewServer(http.NotFoundHandler())
	defer plain.Close()
	refused := closedPort(t)
	// A proxy that refuses every CONNECT.
	forbidding := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no", http.StatusForbidden)
	}))
	defer forbidding.Close()
	// A server that resets the connection during the TLS handshake.
	resetter, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer resetter.Close()
	go func() {
		for {
			conn, err := resetter.Accept()
			if err != nil {
				return
			}
			_, _ = conn.Read(make([]byte, 16))
			_ = conn.(*net.TCPConn).SetLinger(0)
			conn.Close()
		}
	}()

	trusting := func(host string) *gateway.Client {
		c := gateway.New("https://"+host+"/v1", "secret-key", 5*time.Second)
		c.HTTP.Transport = tlsSrv.Client().Transport.(*http.Transport).Clone()
		return c
	}
	_, tlsPort, _ := net.SplitHostPort(tlsSrv.Listener.Addr().String())

	cases := []struct {
		name   string
		client *gateway.Client
		want   []string
	}{
		{"connection refused", gateway.New("http://"+refused+"/v1", "secret-key", 5*time.Second),
			[]string{"connection refused by " + refused}},
		{"dns", gateway.New("https://grounded-test.invalid/v1", "secret-key", 5*time.Second),
			[]string{"DNS lookup failed for host grounded-test.invalid"}},
		{"untrusted certificate", gateway.New(tlsSrv.URL+"/v1", "secret-key", 5*time.Second),
			[]string{"certificate not trusted", "unknown authority"}},
		{"wrong host name", trusting("localhost:" + tlsPort),
			[]string{"certificate not valid for localhost"}},
		{"not TLS", gateway.New(strings.Replace(plain.URL, "http:", "https:", 1)+"/v1", "secret-key", 5*time.Second),
			[]string{"TLS handshake failed", "did not answer with TLS"}},
		{"reset during TLS", gateway.New("https://"+resetter.Addr().String()+"/v1", "secret-key", 5*time.Second),
			[]string{"TLS handshake failed"}},
		{"proxy not listening", withProxy(gateway.New("https://proxy-target.example.edu/v1", "secret-key", 5*time.Second), "http://"+refused),
			[]string{"proxy refused the connection (" + refused + ")"}},
		{"proxy refuses CONNECT", withProxy(gateway.New("https://proxy-target.example.edu/v1", "secret-key", 5*time.Second), forbidding.URL),
			[]string{"proxy refused the connection", "Forbidden"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			msg := message(t, tc.client)
			for _, w := range tc.want {
				if !strings.Contains(msg, w) {
					t.Errorf("message %q lacks %q", msg, w)
				}
			}
		})
	}
}

func TestTimeoutNamesThePhase(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(400 * time.Millisecond) }))
	defer slow.Close()
	msg := message(t, gateway.New(slow.URL+"/v1", "", 100*time.Millisecond))
	if !strings.HasPrefix(msg, "timed out after 0.") || !strings.Contains(msg, "s (waiting for the response; connect ") {
		t.Fatalf("message = %q", msg)
	}
	// A listener that never completes the TLS handshake.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			defer c.Close()
		}
	}()
	msg = message(t, gateway.New("https://"+l.Addr().String()+"/v1", "", 100*time.Millisecond))
	if !strings.Contains(msg, "(TLS handshake; connect ") {
		t.Fatalf("message = %q", msg)
	}
}

func TestTraceTimings(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(20 * time.Millisecond)
		_, _ = w.Write([]byte(`{"data":[{"id":"m"}]}`))
	}))
	defer srv.Close()
	c := gateway.New(srv.URL, "", 5*time.Second)
	c.HTTP = srv.Client()

	// A warm keep-alive connection is reused...
	if _, err := c.ListModels(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, tr := gateway.WithTrace(context.Background())
	if _, err := c.ListModels(ctx); err != nil {
		t.Fatal(err)
	}
	if got := tr.Timings(); !got.Reused || got.Connect != 0 || got.FirstByte < 20*time.Millisecond {
		t.Fatalf("warm timings = %+v", got)
	}
	// ...unless the test asks for a fresh connection, which measures
	// connect and TLS. Only the first exchange is recorded.
	ctx, tr = gateway.WithTrace(gateway.FreshConnection(context.Background()))
	if gateway.TraceFrom(ctx) != tr {
		t.Fatal("TraceFrom does not return the trace")
	}
	for range 2 {
		if _, err := c.ListModels(ctx); err != nil {
			t.Fatal(err)
		}
	}
	got := tr.Timings()
	if got.Reused || got.Connect <= 0 || got.TLS <= 0 || got.FirstByte < 20*time.Millisecond || got.DNS != 0 {
		t.Fatalf("fresh timings = %+v", got)
	}
	if s := got.String(); !strings.Contains(s, "connect ") || !strings.Contains(s, "TLS ") || !strings.Contains(s, "first byte ") {
		t.Fatalf("summary = %q", s)
	}
	if gateway.TraceFrom(context.Background()) != nil {
		t.Fatal("trace on a plain context")
	}
}
