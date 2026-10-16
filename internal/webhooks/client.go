package webhooks

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"time"

	"github.com/ncecere/grounded/internal/crawl"
)

// ErrBlockedAddress: the host resolves to an address a webhook is never sent to (private, loopback, link-local, cloud metadata).
var ErrBlockedAddress = errors.New("the host resolves to a private, loopback, link-local or cloud metadata address")

// maxAnswer is how much of the receiver's answer is read (and discarded): a delivery only needs the status.
const maxAnswer = 4 << 10

// ClientConfig builds a Client. Zero values are production's.
type ClientConfig struct {
	// Timeout bounds one delivery, connecting included (default 10 s).
	Timeout time.Duration
	// Lookup resolves a host (default the system resolver).
	Lookup func(ctx context.Context, host string) ([]netip.Addr, error)
	// Dial connects to an address that was checked (default a net.Dialer).
	Dial func(ctx context.Context, network, address string) (net.Conn, error)
	// TLS is the client's TLS configuration (tests trust their server's certificate).
	TLS *tls.Config
	// AllowPrivate lifts the address guard: for tests only.
	AllowPrivate bool
}

// Client posts deliveries. It resolves the host itself, refuses every address the crawler refuses, connects to the address it checked (so a
// second DNS answer cannot redirect it), follows no redirects and reads at most 4 KB of the answer.
type Client struct {
	http *http.Client
	cfg  ClientConfig
}

// NewClient returns a Client.
func NewClient(cfg ClientConfig) *Client {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	c := &Client{cfg: cfg}
	tr := &http.Transport{
		Proxy:               nil, // never through an environment proxy: the guard is the only way out
		DialContext:         c.dial,
		TLSClientConfig:     cfg.TLS,
		TLSHandshakeTimeout: cfg.Timeout,
		DisableKeepAlives:   true,
		ForceAttemptHTTP2:   true,
	}
	c.http = &http.Client{
		Transport:     tr,
		Timeout:       cfg.Timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return c
}

func (c *Client) lookup(ctx context.Context, host string) ([]netip.Addr, error) {
	if ip, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{ip.Unmap()}, nil
	}
	if c.cfg.Lookup != nil {
		return c.cfg.Lookup(ctx, host)
	}
	return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
}

// dial resolves, checks every answer and connects to a checked address.
func (c *Client) dial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addrs, err := c.lookup(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", host, err)
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("resolve %s: no addresses", host)
	}
	if !c.cfg.AllowPrivate {
		for _, a := range addrs {
			if !crawl.PublicAddr(a.Unmap()) {
				return nil, ErrBlockedAddress
			}
		}
	}
	dial := c.cfg.Dial
	if dial == nil {
		d := &net.Dialer{Timeout: c.cfg.Timeout}
		dial = d.DialContext
	}
	var last error
	for _, a := range addrs {
		conn, err := dial(ctx, network, net.JoinHostPort(a.String(), port))
		if err == nil {
			return conn, nil
		}
		last = err
	}
	return nil, last
}

// Post sends body and returns the receiver's HTTP status. Any answer is a status, including 3xx (redirects are not followed).
func (c *Client) Post(ctx context.Context, rawURL string, header http.Header, body []byte) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	for k, v := range header {
		req.Header[k] = v
	}
	res, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, maxAnswer))
	return res.StatusCode, nil
}
