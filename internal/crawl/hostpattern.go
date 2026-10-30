package crawl

import (
	"errors"
	"net/netip"
	"regexp"
	"strings"

	"golang.org/x/net/idna"
)

// hostPatternRE matches a host pattern after normalisation; it is the same
// rule as the CHECK constraints on crawl_allowlist and crawl_domain_requests.
var hostPatternRE = regexp.MustCompile(`^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

// Host pattern errors.
var (
	ErrHostPattern = errors.New(`enter a host such as "example.edu" or a wildcard such as "*.example.edu"`)
	ErrStarPattern = errors.New(`"*" (every host) is not allowed here`)
)

// NormalizeHostPattern lower-cases a host pattern and converts it to IDNA
// ASCII. Patterns are "*" (any public host; only when allowStar),
// "*.example.edu" (example.edu and every subdomain) or "example.edu" (that
// host only).
func NormalizeHostPattern(p string, allowStar bool) (string, error) {
	p = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(p)), ".")
	if p == "*" {
		if !allowStar {
			return "", ErrStarPattern
		}
		return p, nil
	}
	prefix := ""
	if strings.HasPrefix(p, "*.") {
		prefix, p = "*.", p[2:]
	}
	ascii, err := idna.Lookup.ToASCII(p)
	if err != nil {
		return "", ErrHostPattern
	}
	full := prefix + ascii
	if len(full) > 253 || !hostPatternRE.MatchString(full) {
		return "", ErrHostPattern
	}
	// An address is one host: "*.10.0.0.1" matches nothing real.
	if _, err := netip.ParseAddr(ascii); err == nil && prefix != "" {
		return "", ErrHostPattern
	}
	return full, nil
}

// Longest DNS label and name, in characters (RFC 1035 section 2.3.4: 63 octets a label, 255 in the wire form, so 253 as text).
const (
	MaxDNSLabel = 63
	MaxDNSName  = 253
)

// ValidDNSLengths reports whether every label of a normalised host or host pattern is 1 to 63 characters and the name (without a
// leading "*.") at most 253. NormalizeHostPattern does not check it, because the allowlists that use it hold patterns saved before; a
// place that takes a new host (a webhook destination, a webhook's address) does, since a longer label can never be resolved.
func ValidDNSLengths(host string) bool {
	host = strings.TrimPrefix(host, "*.")
	if host == "" || len(host) > MaxDNSName {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if n := len(label); n < 1 || n > MaxDNSLabel {
			return false
		}
	}
	return true
}
