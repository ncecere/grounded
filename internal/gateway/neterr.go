package gateway

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// failure is what went wrong with one request, for describeTransportError.
type failure struct {
	err     error
	host    string // host:port of the request URL
	proxy   string // host:port of the HTTP proxy, "" when none
	trace   *Trace
	elapsed time.Duration
}

// describeTransportError names the cause of a failed request for admins
// (roadmap E12): certificate, TLS, proxy, refused, reset, DNS or timeout,
// with the phase that failed. It never includes the API key (only the
// host is named, and URLs are not echoed).
func describeTransportError(f failure) string {
	if f.trace == nil {
		f.trace = &Trace{}
	}
	err := f.err
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	if msg := certificateError(err, f.host); msg != "" {
		return msg
	}
	if msg := tlsError(err); msg != "" {
		return msg
	}
	var ne net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()) {
		return timeoutMessage(f.trace, f.elapsed, hostOnly(f.host))
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		reason := dnsErr.Err
		if dnsErr.IsNotFound {
			reason = "no such host"
		}
		return fmt.Sprintf("DNS lookup failed for host %s: %s", dnsErr.Name, reason)
	}
	if msg := connectionError(f); msg != "" {
		return msg
	}
	if f.trace.tlsStarted() && f.trace.pending() == phaseTLS {
		return "TLS handshake failed: " + short(err)
	}
	if f.proxy != "" && f.trace.connected() && !f.trace.tlsStarted() && f.trace.pending() == phaseConnect {
		// The proxy answered CONNECT with an error status; net/http
		// returns its reason phrase ("Forbidden").
		return fmt.Sprintf("proxy refused the connection (%s): %s", f.proxy, short(err))
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return "the server closed the connection" + during(f.trace)
	}
	return "request failed: " + short(err)
}

// certificateError names certificate verification failures.
func certificateError(err error, host string) string {
	var unknown x509.UnknownAuthorityError
	if errors.As(err, &unknown) {
		issuer := ""
		if unknown.Cert != nil && unknown.Cert.Issuer.CommonName != "" {
			issuer = fmt.Sprintf(" %q", unknown.Cert.Issuer.CommonName)
		}
		return fmt.Sprintf("certificate not trusted: issued by an unknown authority%s; add the issuing CA to the trust store (for example SSL_CERT_FILE)", issuer)
	}
	var hostErr x509.HostnameError
	if errors.As(err, &hostErr) {
		return fmt.Sprintf("certificate not valid for %s: %s", hostOnly(host), hostErr.Error())
	}
	var invalid x509.CertificateInvalidError
	if errors.As(err, &invalid) {
		if invalid.Reason == x509.Expired {
			return "certificate expired or not yet valid: " + invalid.Error()
		}
		return "certificate not trusted: " + invalid.Error()
	}
	var verify *tls.CertificateVerificationError
	if errors.As(err, &verify) {
		return "certificate not trusted: " + short(verify.Err)
	}
	return ""
}

// tlsError names TLS failures that are not about the certificate.
func tlsError(err error) string {
	var rec tls.RecordHeaderError
	// net/http turns a plain-HTTP answer into its own error message.
	if errors.As(err, &rec) || strings.Contains(err.Error(), "server gave HTTP response to HTTPS client") {
		return "TLS handshake failed: the server did not answer with TLS (does the URL need http:// instead of https://?)"
	}
	// A TLS alert from the server ("remote error: tls: handshake failure"),
	// for example no shared protocol version or cipher, or a required
	// client certificate.
	var op *net.OpError
	if errors.As(err, &op) && op.Op == "remote error" {
		return "TLS handshake failed: the server sent " + short(op.Err)
	}
	return ""
}

// connectionError names dial failures: refused, reset, unreachable, and
// failures reaching the proxy.
func connectionError(f failure) string {
	var op *net.OpError
	toProxy := errors.As(f.err, &op) && op.Op == "proxyconnect"
	switch {
	case toProxy && errors.Is(f.err, syscall.ECONNREFUSED):
		return fmt.Sprintf("proxy refused the connection (%s): nothing is listening; check HTTPS_PROXY", f.proxy)
	case errors.Is(f.err, syscall.ECONNREFUSED):
		return fmt.Sprintf("connection refused by %s: nothing is listening on that port", f.host)
	case errors.Is(f.err, syscall.ECONNRESET):
		if f.trace.pending() == phaseTLS {
			return "TLS handshake failed: the connection was reset (a firewall or proxy may be blocking or intercepting TLS)"
		}
		return "connection reset by the server" + during(f.trace)
	case errors.Is(f.err, syscall.EHOSTUNREACH), errors.Is(f.err, syscall.ENETUNREACH):
		return fmt.Sprintf("no route to %s (host or network unreachable)", f.host)
	case toProxy:
		return fmt.Sprintf("could not connect to the proxy %s: %s", f.proxy, short(op.Err))
	case op != nil && op.Op == "dial":
		return fmt.Sprintf("could not connect to %s: %s", f.host, short(op.Err))
	}
	return ""
}

func during(t *Trace) string {
	if p := t.pending(); p != "" {
		return " (" + p + ")"
	}
	return ""
}

// short is err's message without a wrapping url.Error (which would repeat
// the URL), on one line and bounded.
func short(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	s := strings.Join(strings.Fields(err.Error()), " ")
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}

func hostOnly(hostport string) string {
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		return h
	}
	return hostport
}

// requestHost is the host:port a request goes to.
func requestHost(u *url.URL) string {
	if u.Port() != "" {
		return u.Host
	}
	if u.Scheme == "http" {
		return net.JoinHostPort(u.Hostname(), "80")
	}
	return net.JoinHostPort(u.Hostname(), "443")
}
