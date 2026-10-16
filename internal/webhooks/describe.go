package webhooks

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"syscall"
)

// describe is why a delivery failed before the receiver answered, in words that are safe to show the people who manage the webhook. A raw
// network error names addresses (the resolver's, the receiver's), which are not theirs to see: only the kind of failure is kept.
func describe(err error) string {
	var (
		dns      *net.DNSError
		unknown  x509.UnknownAuthorityError
		hostname x509.HostnameError
		invalid  x509.CertificateInvalidError
		record   tls.RecordHeaderError
		netErr   net.Error
	)
	switch {
	case errors.Is(err, ErrBlockedAddress):
		return "the host resolves to a private or internal address, which webhooks are never sent to"
	case errors.As(err, &dns):
		return "the host name could not be resolved"
	case errors.As(err, &unknown), errors.As(err, &hostname), errors.As(err, &invalid):
		return "the receiver's TLS certificate could not be verified"
	case errors.As(err, &record):
		return "the receiver does not speak TLS on port 443"
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &netErr) && netErr.Timeout():
		return "the receiver did not answer in time"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "the receiver refused the connection"
	case errors.Is(err, syscall.ECONNRESET):
		return "the connection was reset"
	}
	return "the receiver could not be reached"
}
