package connector

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/crawl"
)

// ErrBlockedAddress: the host resolves to a private, loopback or link-local address that is not allowed.
var ErrBlockedAddress = errors.New("the host resolves to a private address that is not allowed for connectors")

// Outbound configures the client every connector request goes through.
type Outbound struct {
	// PrivateHosts are host names allowed on private addresses: a self-hosted wiki or object store inside the
	// network. Every other host must resolve to public addresses only, as for the crawler. Nothing sets it yet: no
	// environment setting may lift the address check, so the first connector for a self-hosted product brings the
	// platform admin's way of allowing a host with it.
	PrivateHosts []string
	// AllowPrivate lifts the address check (tests and development only).
	AllowPrivate bool
	// Timeout bounds one request, connect to last byte of the headers (default 60 s). Bodies stream without a limit
	// here; the sink limits what it reads.
	Timeout time.Duration
	// MaxRetries is how often a throttled request is tried again (default 5), and MaxWait the longest it waits for
	// one retry (default 2 min). A provider asking for longer fails the request, and the sync is retried later.
	MaxRetries int
	MaxWait    time.Duration
	// Lookup and Dial replace DNS and the network in tests.
	Lookup func(ctx context.Context, host string) ([]netip.Addr, error)
	Dial   func(ctx context.Context, network, address string) (net.Conn, error)
	// Sleep replaces waiting in tests.
	Sleep func(ctx context.Context, d time.Duration) error
}

// NewHTTPClient returns the guarded client. Redirects are followed (at most 10) and every hop is checked the same way,
// because the check is made when connecting.
func NewHTTPClient(o Outbound) *http.Client {
	if o.Timeout <= 0 {
		o.Timeout = 60 * time.Second
	}
	if o.MaxRetries <= 0 {
		o.MaxRetries = 5
	}
	if o.MaxWait <= 0 {
		o.MaxWait = 2 * time.Minute
	}
	g := &guard{o: o, private: map[string]bool{}}
	for _, h := range o.PrivateHosts {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			g.private[h] = true
		}
	}
	tr := &http.Transport{
		DialContext:           g.dial,
		ForceAttemptHTTP2:     true,
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: o.Timeout,
	}
	return &http.Client{Transport: &retry{next: tr, o: o}}
}

type guard struct {
	o       Outbound
	private map[string]bool
}

func (g *guard) lookup(ctx context.Context, host string) ([]netip.Addr, error) {
	if ip, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{ip.Unmap()}, nil
	}
	if g.o.Lookup != nil {
		return g.o.Lookup(ctx, host)
	}
	return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
}

// dial resolves the host, checks every answer and connects to a checked address, so a name cannot answer with a public
// address for the check and a private one for the connection.
func (g *guard) dial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addrs, err := g.lookup(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", host, err)
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("resolve %s: no addresses", host)
	}
	if !g.o.AllowPrivate && !g.private[strings.ToLower(host)] {
		for _, a := range addrs {
			if !crawl.PublicAddr(a.Unmap()) {
				return nil, fmt.Errorf("%s: %w", host, ErrBlockedAddress)
			}
		}
	}
	dial := g.o.Dial
	if dial == nil {
		d := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
		dial = d.DialContext
	}
	var last error
	for _, a := range addrs {
		conn, err := dial(ctx, network, net.JoinHostPort(a.Unmap().String(), port))
		if err == nil {
			return conn, nil
		}
		last = err
	}
	return nil, last
}

// retry waits and tries again when the provider throttles: 429, or 503 with Retry-After. Only requests whose body can
// be sent again are retried (no body, or GetBody set, as http.NewRequest does for byte and string bodies).
type retry struct {
	next http.RoundTripper
	o    Outbound
}

func (r *retry) RoundTrip(req *http.Request) (*http.Response, error) {
	for attempt := 0; ; attempt++ {
		res, err := r.next.RoundTrip(req)
		if err != nil {
			return nil, err
		}
		wait, throttled := retryAfter(res, attempt)
		if !throttled || attempt >= r.o.MaxRetries || wait > r.o.MaxWait || (req.Body != nil && req.GetBody == nil) {
			return res, nil
		}
		_ = res.Body.Close()
		if req.GetBody != nil {
			body, err := req.GetBody()
			if err != nil {
				return nil, err
			}
			req = req.Clone(req.Context())
			req.Body = body
		}
		if err := r.sleep(req.Context(), wait); err != nil {
			return nil, err
		}
	}
}

func (r *retry) sleep(ctx context.Context, d time.Duration) error {
	if r.o.Sleep != nil {
		return r.o.Sleep(ctx, d)
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// retryAfter says whether the answer is a throttle and how long to wait: what the provider asked for, or 1 s doubling
// with each attempt when it did not say.
func retryAfter(res *http.Response, attempt int) (time.Duration, bool) {
	h := res.Header.Get("Retry-After")
	if res.StatusCode != http.StatusTooManyRequests && (res.StatusCode != http.StatusServiceUnavailable || h == "") {
		return 0, false
	}
	if n, err := strconv.Atoi(strings.TrimSpace(h)); err == nil && n >= 0 {
		return time.Duration(n) * time.Second, true
	}
	if at, err := http.ParseTime(h); err == nil {
		if d := time.Until(at); d > 0 {
			return d, true
		}
		return 0, true
	}
	return time.Second << min(attempt, 6), true
}
