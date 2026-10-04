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
