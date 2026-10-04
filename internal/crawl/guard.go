// The SSRF guard: every request (pages, robots.txt, sitemaps and each
// redirect hop) is checked against the scheme, port and host policies,
// resolved to public addresses only, paced, and pinned to the approved
// addresses when dialling.

package crawl

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
)

var deniedNetworks = func() []netip.Prefix {
	ranges := []string{
		"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "168.63.129.16/32", "172.16.0.0/12",
		"192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
		"224.0.0.0/4", "240.0.0.0/4",
		// IPv6: only allocated global unicast (2000::/3) is accepted, minus
		// special assignments, documentation, 6to4/Teredo and translation.
		"2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20",
	}
	out := make([]netip.Prefix, 0, len(ranges))
	for _, r := range ranges {
		out = append(out, netip.MustParsePrefix(r))
	}
	return out
}()

var globalUnicast6 = netip.MustParsePrefix("2000::/3")

// PublicAddr reports whether ip is a public unicast address: not private,
// loopback, link-local, CGNAT, metadata, documentation or translation
// space. The MCP client's guard uses it too (internal/mcpclient).
func PublicAddr(ip netip.Addr) bool { return publicIP(ip) }

// publicIP reports whether ip is a public unicast address (ported from yoink).
func publicIP(ip netip.Addr) bool {
	if !ip.IsValid() || ip.Zone() != "" {
		return false
	}
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() {
		return false
	}
	if ip.Is6() && !globalUnicast6.Contains(ip) {
		return false
	}
	for _, p := range deniedNetworks {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

// BlocksPattern reports whether a host pattern is an IP address this
// fetcher never fetches (checkDestination refuses it), so an allowlist entry
// for it would do nothing (AD-08). Host names are checked when they are
// resolved, at crawl time; with AllowPrivateForTests nothing is blocked.
func (f *Fetcher) BlocksPattern(pattern string) bool {
	if f == nil || f.cfg.AllowPrivateForTests {
		return false
	}
	if ip, err := netip.ParseAddr(pattern); err == nil {
		return !publicIP(ip)
	}
	// Other notations of an address ("0177.0.0.1", "0x7f.0.0.1", "127.1")
	// are what SSRF attempts use; the guard never treats them as public.
	return numericHostRE.MatchString(pattern)
}

var numericHostRE = regexp.MustCompile(`^((0x[0-9a-f]+|[0-9]+)\.)*(0x[0-9a-f]+|[0-9]+)$`)

func defaultPort(scheme string) string {
	if scheme == "https" {
		return "443"
	}
	return "80"
}

type hostPolicyKey struct{}

// WithHostPolicy returns a context whose requests (pages, robots.txt,
// sitemaps and every redirect hop) must also satisfy p, in addition to
// FetcherConfig.HostPolicy. It lets one Fetcher serve crawls with different
// allowlists (for example one per team).
func WithHostPolicy(ctx context.Context, p HostPolicy) context.Context {
	return context.WithValue(ctx, hostPolicyKey{}, p)
}

// checkDestination applies the cheap, resolution-free checks: scheme, host
// policy, port, and literal IPs.
func (f *Fetcher) checkDestination(ctx context.Context, u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("%w: scheme %q", ErrBlockedAddress, u.Scheme)
	}
	host := u.Hostname()
	if f.cfg.HostPolicy != nil && !f.cfg.HostPolicy.AllowHost(host) {
		return fmt.Errorf("%w: %s", ErrHostNotAllowed, host)
	}
	if p, ok := ctx.Value(hostPolicyKey{}).(HostPolicy); ok && p != nil && !p.AllowHost(host) {
		return fmt.Errorf("%w: %s", ErrHostNotAllowed, host)
	}
	if f.cfg.AllowPrivateForTests {
		return nil
	}
	port := u.Port()
	if port != "" && port != "80" && port != "443" {
		return fmt.Errorf("%w: port %s not allowed", ErrBlockedAddress, port)
	}
	if ip, err := netip.ParseAddr(host); err == nil && !publicIP(ip) {
		return fmt.Errorf("%w: %s", ErrBlockedAddress, ip)
	}
	return nil
}

// approve resolves host once and requires every answer to be public. The
// returned addresses are pinned for the dial: no second lookup can rebind.
func (f *Fetcher) approve(ctx context.Context, host, port string) ([]netip.Addr, error) {
	if !f.cfg.AllowPrivateForTests && port != "80" && port != "443" {
		return nil, fmt.Errorf("%w: port %s not allowed", ErrBlockedAddress, port)
	}
	var ips []netip.Addr
	if ip, err := netip.ParseAddr(host); err == nil {
		ips = []netip.Addr{ip}
	} else {
		ips, err = f.lookup(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("crawl: resolve %s: %w", host, err)
		}
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("crawl: %s has no addresses", host)
	}
	if !f.cfg.AllowPrivateForTests {
		// Reject mixed public/private answers outright.
		for _, ip := range ips {
			if !publicIP(ip) {
				return nil, fmt.Errorf("%w: %s resolved to %s", ErrBlockedAddress, host, ip)
			}
		}
	}
	return ips, nil
}

type approvedKey struct{}

type approvedDestination struct {
	host, port string
	ips        []netip.Addr
}

func (f *Fetcher) safeDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	var ips []netip.Addr
	if a, ok := ctx.Value(approvedKey{}).(approvedDestination); ok && a.host == host && a.port == port {
		ips = a.ips
	} else {
		// Defence in depth: a dial without an approval re-approves.
		if ips, err = f.approve(ctx, host, port); err != nil {
			return nil, err
		}
	}
	var errs []error
	for _, ip := range ips {
		conn, err := f.dial(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
		if err == nil {
			return conn, nil
		}
		errs = append(errs, err)
		if ctx.Err() != nil {
			break
		}
	}
	return nil, fmt.Errorf("crawl: dial %s: %w", host, errors.Join(errs...))
}

// guardTransport validates, paces and pins every request, including each
// redirect hop, robots.txt and sitemap requests.
type guardTransport struct {
	f    *Fetcher
	next http.RoundTripper
}

func (t guardTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	f := t.f
	u := req.URL
	if err := f.checkDestination(req.Context(), u); err != nil {
		return nil, err
	}
	port := u.Port()
	if port == "" {
		port = defaultPort(u.Scheme)
	}
	host := u.Hostname()
	if f.cfg.Pacer != nil {
		if err := f.cfg.Pacer.Wait(req.Context(), u.Scheme+"://"+net.JoinHostPort(host, port)); err != nil {
			return nil, err
		}
	}
	ctx, cancel := context.WithTimeout(req.Context(), f.cfg.Timeout)
	ips, err := f.approve(ctx, host, port)
	if err != nil {
		cancel()
		return nil, err
	}
	ctx = context.WithValue(ctx, approvedKey{}, approvedDestination{host: host, port: port, ips: ips})
	res, err := t.next.RoundTrip(req.Clone(ctx))
	if err != nil {
		cancel()
		return nil, err
	}
	res.Body = &cancelBody{ReadCloser: res.Body, cancel: cancel}
	return res, nil
}

type cancelBody struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b *cancelBody) Close() error {
	err := b.ReadCloser.Close()
	b.cancel()
	return err
}
