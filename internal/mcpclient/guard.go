package mcpclient

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/crawl"
)

// The address rule (docs/mcp-client.md, "Security"): an MCP server's URL is
// https, and its host resolves to public addresses only, checked when the
// URL is saved and again, pinned, every time a connection is dialled (so a
// DNS change can't point a registered server at the internal network). With
// the development allowance (DEV_AUTH on a loopback APP_URL) private,
// loopback and link-local addresses are accepted, and plain http is
// accepted for loopback hosts. Redirects are never followed.

// ErrBlockedAddress: the URL's host is (or resolves to) an address the rule
// refuses.
var ErrBlockedAddress = errors.New("mcpclient: address not allowed")

// maxURL bounds a server URL.
const maxURL = 500

func invalidURL(msg string) error { return apperr.Invalid("invalid_url", msg) }

// NormalizeURL checks a server URL: https (http only for a loopback host
// with the development allowance), a host, no user info, query or
// fragment (credentials belong in the header, which is stored encrypted),
// and a literal IP address only when the rule allows it. Host names are
// resolved when dialling.
func NormalizeURL(raw string, allowPrivate bool) (string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(raw) > maxURL {
		return "", invalidURL("The URL must be an https URL without a query, such as https://status.example.edu/mcp")
	}
	host := u.Hostname()
	switch u.Scheme {
	case "https":
	case "http":
		if !allowPrivate || !loopbackHost(host) {
			return "", invalidURL("The URL must use https")
		}
	default:
		return "", invalidURL("The URL must use https")
	}
	if ip, err := netip.ParseAddr(host); err == nil && !allowPrivate && !crawl.PublicAddr(ip) {
		return "", invalidURL("The URL's address is private, loopback or link-local; MCP servers must be reachable at a public address")
	}
	if !allowPrivate && strings.EqualFold(host, "localhost") {
		return "", invalidURL("The URL's address is private, loopback or link-local; MCP servers must be reachable at a public address")
	}
	return u.String(), nil
}

func loopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip, err := netip.ParseAddr(host)
	return err == nil && ip.IsLoopback()
}

// resolver looks up a host's addresses (tests replace it).
type resolver func(ctx context.Context, host string) ([]netip.Addr, error)

func defaultResolver(ctx context.Context, host string) ([]netip.Addr, error) {
	return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
}

// dialer dials only addresses the rule allows, resolving the host once and
// pinning the connection to the approved addresses.
type dialer struct {
	allowPrivate bool
	lookup       resolver
	net          net.Dialer
}

func (d *dialer) dial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	var ips []netip.Addr
	if ip, err := netip.ParseAddr(host); err == nil {
		ips = []netip.Addr{ip}
	} else if ips, err = d.lookup(ctx, host); err != nil {
		return nil, fmt.Errorf("mcpclient: resolve %s: %w", host, err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("mcpclient: %s has no addresses", host)
	}
	if !d.allowPrivate {
		for _, ip := range ips {
			if !crawl.PublicAddr(ip) {
				return nil, fmt.Errorf("%w: %s resolved to %s", ErrBlockedAddress, host, ip)
			}
		}
	}
	var errs []error
	for _, ip := range ips {
		conn, err := d.net.DialContext(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
		if err == nil {
			return conn, nil
		}
		errs = append(errs, err)
		if ctx.Err() != nil {
			break
		}
	}
	return nil, fmt.Errorf("mcpclient: dial %s: %w", host, errors.Join(errs...))
}

// exchange records what the server answered, for error classes.
type exchange struct {
	mu     sync.Mutex
	status int // the last HTTP status >= 400 (0: none)
}

func (e *exchange) setStatus(code int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if code >= 400 {
		e.status = code
	}
}

func (e *exchange) lastStatus() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.status
}

// ErrResponseTooLarge: a response body passed MaxResponseBytes.
var ErrResponseTooLarge = errors.New("mcpclient: response too large")

// headerTransport adds the static header, records error statuses and caps
// response bodies.
type headerTransport struct {
	next        http.RoundTripper
	header      string
	value       string
	maxResponse int64
	ex          *exchange
}

func (t *headerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.header != "" {
		req = req.Clone(req.Context())
		req.Header.Set(t.header, t.value)
	}
	res, err := t.next.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	t.ex.setStatus(res.StatusCode)
	res.Body = &cappedBody{ReadCloser: res.Body, left: t.maxResponse}
	return res, nil
}

// cappedBody fails a read past its limit.
type cappedBody struct {
	io.ReadCloser
	left int64
}

func (b *cappedBody) Read(p []byte) (int, error) {
	if b.left <= 0 {
		return 0, ErrResponseTooLarge
	}
	if int64(len(p)) > b.left {
		p = p[:b.left+1] // one byte more tells a body that ends exactly at the limit from a longer one
	}
	n, err := b.ReadCloser.Read(p)
	b.left -= int64(n)
	if b.left < 0 {
		return n - 1, ErrResponseTooLarge
	}
	return n, err
}

// httpClient builds the client of one exchange with a server: the guarded
// dialer, no proxy from the environment, no redirects, the header and the
// body cap. done closes its idle connections.
func (s *Service) httpClient(t target, ex *exchange) (client *http.Client, done func()) {
	d := &dialer{allowPrivate: s.AllowPrivate, lookup: s.lookup, net: net.Dialer{Timeout: 10 * time.Second}}
	tr := &http.Transport{
		DialContext:           d.dial,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: t.timeout,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
	}
	return &http.Client{
		Transport: &headerTransport{next: tr, header: t.headerName, value: t.headerValue, maxResponse: s.maxResponse(), ex: ex},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return fmt.Errorf("%w: MCP servers may not redirect", ErrBlockedAddress)
		},
	}, tr.CloseIdleConnections
}
