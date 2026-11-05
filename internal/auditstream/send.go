package auditstream

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Error classes, shown on the destination (never a response body or a raw error).
const (
	ClassAddress  = "address"
	ClassConnect  = "connect"
	ClassTLS      = "tls"
	ClassTimeout  = "timeout"
	ClassHTTP4xx  = "http_4xx"
	ClassHTTP5xx  = "http_5xx"
	ClassRedirect = "http_3xx"
	ClassInternal = "internal"
)

// SendError is a failed delivery with its class.
type SendError struct {
	Class string
	Err   error
}

func (e *SendError) Error() string { return e.Class + ": " + e.Err.Error() }
func (e *SendError) Unwrap() error { return e.Err }

func fail(class string, err error) error { return &SendError{Class: class, Err: err} }

// Class is an error's class (internal for anything unclassified).
func Class(err error) string {
	var se *SendError
	if errors.As(err, &se) {
		return se.Class
	}
	return ClassInternal
}

// ErrBlockedAddress: a destination may be on a private network, but never on loopback, link-local or a cloud metadata
// address (docs/specs/audit-streaming/DESIGN.md).
var ErrBlockedAddress = errors.New("the host resolves to a loopback, link-local, unspecified or cloud metadata address")

// allowedAddr: anything routable, including private ranges; not loopback, link-local, multicast, unspecified, or the cloud
// metadata ranges (169.254.0.0/16 is link-local; fd00:ec2::254 is AWS's IPv6 metadata address).
func allowedAddr(a netip.Addr) bool {
	a = a.Unmap()
	switch {
	case !a.IsValid(), a.IsLoopback(), a.IsLinkLocalUnicast(), a.IsLinkLocalMulticast(), a.IsMulticast(), a.IsUnspecified(),
		a.IsInterfaceLocalMulticast():
		return false
	case a == netip.MustParseAddr("fd00:ec2::254"), a == netip.MustParseAddr("100.100.100.200"): // AWS IPv6, Alibaba metadata
		return false
	}
	return true
}

// Sender delivers batches. Lookup and Dial are replaced in tests; AllowLoopback lifts the loopback rule for tests only.
type Sender struct {
	Timeout       time.Duration
	Lookup        func(ctx context.Context, host string) ([]netip.Addr, error)
	Dial          func(ctx context.Context, network, address string) (net.Conn, error)
	RootCAs       *x509.CertPool // added to a destination's own CA (tests)
	AllowLoopback bool
}

func (s *Sender) timeout() time.Duration {
	if s.Timeout > 0 {
		return s.Timeout
	}
	return 10 * time.Second
}

// dial resolves the host, checks every answer and connects to a checked address (a second DNS answer can't redirect it).
func (s *Sender) dial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fail(ClassAddress, err)
	}
	var addrs []netip.Addr
	if ip, perr := netip.ParseAddr(host); perr == nil {
		addrs = []netip.Addr{ip}
	} else if s.Lookup != nil {
		addrs, err = s.Lookup(ctx, host)
	} else {
		addrs, err = net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	}
	if err != nil || len(addrs) == 0 {
		return nil, fail(ClassConnect, fmt.Errorf("resolve %s: %v", host, err))
	}
	for _, a := range addrs {
		if !allowedAddr(a) && !(s.AllowLoopback && a.Unmap().IsLoopback()) {
			return nil, fail(ClassAddress, ErrBlockedAddress)
		}
	}
	dial := s.Dial
	if dial == nil {
		d := &net.Dialer{Timeout: s.timeout()}
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
	return nil, classifyNet(last)
}

func classifyNet(err error) error {
	var se *SendError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &se):
		return err
	case errors.Is(err, context.DeadlineExceeded) || isTimeout(err):
		return fail(ClassTimeout, err)
	case isTLS(err):
		return fail(ClassTLS, err)
	}
	return fail(ClassConnect, err)
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func isTLS(err error) bool {
	var (
		rec  tls.RecordHeaderError
		cert *tls.CertificateVerificationError
		unk  x509.UnknownAuthorityError
		host x509.HostnameError
	)
	return errors.As(err, &rec) || errors.As(err, &cert) || errors.As(err, &unk) || errors.As(err, &host) ||
		strings.Contains(err.Error(), "tls:")
}

func (s *Sender) tlsConfig(serverName, caPEM string) (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: serverName}
	if caPEM != "" || s.RootCAs != nil {
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if s.RootCAs != nil {
			pool = s.RootCAs.Clone()
		}
		if caPEM != "" && !pool.AppendCertsFromPEM([]byte(caPEM)) {
			return nil, fail(ClassTLS, errors.New("the CA certificate is not valid PEM"))
		}
		cfg.RootCAs = pool
	}
	return cfg, nil
}

// PostHTTPS sends one batch; any 2xx is delivered.
func (s *Sender) PostHTTPS(ctx context.Context, rawURL, authHeader, contentType, caPEM string, body []byte) error {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return fail(ClassAddress, errors.New("not an https URL"))
	}
	tlsCfg, err := s.tlsConfig(u.Hostname(), caPEM)
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout: s.timeout(),
		Transport: &http.Transport{Proxy: nil, DialContext: s.dial, TLSClientConfig: tlsCfg, TLSHandshakeTimeout: s.timeout(),
			DisableKeepAlives: true, ForceAttemptHTTP2: true},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return fail(ClassAddress, err)
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", "Grounded-AuditStream/1")
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	resp, err := client.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return classifyNet(err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode >= 300 && resp.StatusCode < 400:
		return fail(ClassRedirect, fmt.Errorf("status %d", resp.StatusCode))
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		return fail(ClassHTTP4xx, fmt.Errorf("status %d", resp.StatusCode))
	}
	return fail(ClassHTTP5xx, fmt.Errorf("status %d", resp.StatusCode))
}

// SendSyslog writes framed messages over one TLS connection and flushes them. Syslog has no acknowledgement: a batch is
// delivered once it is written.
func (s *Sender) SendSyslog(ctx context.Context, address, caPEM string, frames [][]byte) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return fail(ClassAddress, err)
	}
	if p, err := strconv.Atoi(port); err != nil || p < 1 || p > 65535 {
		return fail(ClassAddress, errors.New("invalid port"))
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout())
	defer cancel()
	raw, err := s.dial(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer raw.Close()
	tlsCfg, err := s.tlsConfig(host, caPEM)
	if err != nil {
		return err
	}
	conn := tls.Client(raw, tlsCfg)
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	if err := conn.HandshakeContext(ctx); err != nil {
		return classifyNet(err)
	}
	var b bytes.Buffer
	for _, f := range frames {
		b.Write(f)
	}
	if _, err := conn.Write(b.Bytes()); err != nil {
		return classifyNet(err)
	}
	// A clean TLS close: the server has the batch when CloseWrite returns.
	if err := conn.CloseWrite(); err != nil {
		return classifyNet(err)
	}
	return nil
}

// ValidateAddress checks a destination's address as typed (resolution and the address rule are checked when sending).
func ValidateAddress(kind, address string) error {
	switch kind {
	case KindHTTPS:
		u, err := url.Parse(address)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return errors.New("enter an https:// URL without credentials or a fragment")
		}
	case KindSyslog:
		host, port, err := net.SplitHostPort(address)
		p, perr := strconv.Atoi(port)
		if err != nil || host == "" || perr != nil || p < 1 || p > 65535 {
			return errors.New("enter host:port, for example siem.example.edu:6514")
		}
	default:
		return errors.New("kind is https or syslog")
	}
	return nil
}
