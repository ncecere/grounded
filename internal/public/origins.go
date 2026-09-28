package public

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Allowed origins of a publishable key (docs/phase4-publishing.md §6): an
// exact origin scheme://host[:port], or a wildcard https://*.example.edu
// that matches any subdomain (not example.edu itself). Default ports are
// dropped, so https://a.example.edu:443 and https://a.example.edu are the
// same origin. A missing scheme means http for local hosts (localhost,
// 127.0.0.1, [::1], *.localhost) and https otherwise; the normalised value
// is returned so the UI can show it (docs/ui-review F-08). Origins are
// enforced by the embed page's Content-Security-Policy frame-ancestors and
// checked when a widget session starts.

var errOriginFormat = errors.New(`use an origin such as https://www.example.edu, https://www.example.edu:8443 or https://*.example.edu`)

// Named problems, so the UI can say what is wrong with an origin.
var (
	errOriginPath   = errors.New("an origin has no path: remove everything after the host and port")
	errOriginQuery  = errors.New("an origin has no query or fragment")
	errOriginUser   = errors.New("an origin has no user name or password")
	errOriginScheme = errors.New("an origin starts with http:// or https://")
	errOriginPort   = errors.New("the port must be a number from 1 to 65535")
	errOriginHost   = errors.New("the host must be a domain name such as www.example.edu or an IP address")
)

// origin is a parsed origin; host may start with "*." (a pattern).
type origin struct {
	scheme, host, port string
}

func (o origin) String() string {
	host := o.host
	if strings.Contains(host, ":") { // IPv6
		host = "[" + host + "]"
	}
	s := o.scheme + "://" + host
	if o.port != "" {
		s += ":" + o.port
	}
	return s
}

func defaultPort(scheme string) string {
	if scheme == "https" {
		return "443"
	}
	return "80"
}

// parseOrigin reads an origin or (pattern true) an allowed-origin pattern.
func parseOrigin(raw string, pattern bool) (origin, error) {
	raw = strings.TrimSpace(raw)
	if pattern && !strings.Contains(raw, "://") {
		raw = defaultScheme(raw) + "://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		if strings.Contains(err.Error(), "port") {
			return origin{}, errOriginPort
		}
		return origin{}, errOriginFormat
	}
	if err := urlProblem(u); err != nil {
		return origin{}, err
	}
	o := origin{scheme: strings.ToLower(u.Scheme), host: strings.ToLower(u.Hostname()), port: u.Port()}
	if o.port != "" {
		n, err := strconv.Atoi(o.port)
		if err != nil || n < 1 || n > 65535 {
			return origin{}, errOriginPort
		}
		o.port = strconv.Itoa(n)
		if o.port == defaultPort(o.scheme) {
			o.port = ""
		}
	}
	if err := checkHost(o.host, pattern); err != nil {
		return origin{}, err
	}
	return o, nil
}

// urlProblem names what makes a parsed URL more than an origin.
func urlProblem(u *url.URL) error {
	switch {
	case u.Opaque != "":
		return errOriginFormat
	case u.User != nil:
		return errOriginUser
	case u.RawQuery != "" || u.ForceQuery || u.Fragment != "":
		return errOriginQuery
	case u.Path != "" && u.Path != "/":
		return errOriginPath
	case !strings.EqualFold(u.Scheme, "https") && !strings.EqualFold(u.Scheme, "http"):
		return errOriginScheme
	}
	return nil
}

// defaultScheme is the scheme of an origin typed without one: http for the
// local machine (browsers serve local development over http), else https.
func defaultScheme(raw string) string {
	host := raw
	if i := strings.IndexAny(host, "/?#"); i >= 0 {
		host = host[:i]
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.ToLower(strings.Trim(host, "[]"))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || host == "::1" {
		return "http"
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return "http"
	}
	return "https"
}

// checkHost accepts a DNS name, an IP address (not in patterns) or a
// *.domain pattern with at least two labels after the star.
func checkHost(host string, pattern bool) error {
	if host == "" || len(host) > 253 {
		return errOriginHost
	}
	if strings.HasPrefix(host, "*.") {
		if !pattern || strings.Count(host[2:], ".") < 1 || !validDNS(host[2:]) {
			return errors.New("a wildcard needs a domain with at least two labels, such as *.example.edu")
		}
		return nil
	}
	if strings.Contains(host, "*") {
		return errors.New("a wildcard goes at the start only, such as *.example.edu")
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		return nil
	}
	if !validDNS(host) {
		return errOriginHost
	}
	return nil
}

func validDNS(h string) bool {
	for _, label := range strings.Split(h, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
				return false
			}
		}
	}
	return true
}

// NormalizeAllowedOrigins validates and normalises a key's allowed origins
// (at most 20, duplicates removed).
func NormalizeAllowedOrigins(in []string) ([]string, error) {
	out, _, err := NormalizeOrigins(in)
	return out, err
}

// OriginChange is an allowed origin stored differently from how it was
// typed (a scheme added, a default port dropped, lower case).
type OriginChange struct {
	Input, Origin string
}

// NormalizeOrigins is NormalizeAllowedOrigins that also reports the
// origins it changed, so the UI can show what was saved.
func NormalizeOrigins(in []string) ([]string, []OriginChange, error) {
	out := []string{}
	changes := []OriginChange{}
	seen := map[string]bool{}
	for _, raw := range in {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		o, err := parseOrigin(trimmed, true)
		if err != nil {
			return nil, nil, &OriginError{Origin: raw, Err: err}
		}
		s := o.String()
		if s != trimmed {
			changes = append(changes, OriginChange{Input: trimmed, Origin: s})
		}
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	if len(out) > 20 {
		return nil, nil, errors.New("a key can allow at most 20 origins")
	}
	return out, changes, nil
}

// OriginError names an allowed origin that could not be read.
type OriginError struct {
	Origin string
	Err    error
}

func (e *OriginError) Error() string { return strings.TrimSpace(e.Origin) + ": " + e.Err.Error() }

// MatchOrigin reports whether an origin (as sent in an Origin header, or
// the origin of a Referer) is allowed by a list of normalised patterns.
func MatchOrigin(raw string, allowed []string) bool {
	o, err := parseOrigin(raw, false)
	if err != nil {
		return false
	}
	for _, a := range allowed {
		p, err := parseOrigin(a, true)
		if err != nil || p.scheme != o.scheme || p.port != o.port {
			continue
		}
		if p.host == o.host {
			return true
		}
		if strings.HasPrefix(p.host, "*.") && strings.HasSuffix(o.host, p.host[1:]) && len(o.host) > len(p.host)-1 {
			return true
		}
	}
	return false
}

// OriginOf returns the origin of a URL (a Referer), or "".
func OriginOf(rawURL string) string {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host)
}

// FrameAncestors is the CSP frame-ancestors source list for the embed
// page: 'self' (the editor's preview) and the allowed origins. CSP host
// sources accept the same *.domain wildcards.
func FrameAncestors(allowed []string) string {
	parts := []string{"'self'"}
	for _, a := range allowed {
		if o, err := parseOrigin(a, true); err == nil {
			parts = append(parts, o.String())
		}
	}
	return strings.Join(parts, " ")
}

// OriginCheck is how one typed origin would be saved, or its problem.
type OriginCheck struct {
	Input   string
	Origin  string // "" when invalid
	Problem string // "" when valid
}

// CheckOrigins normalises each non-empty origin without saving (for the
// widget key dialog).
func CheckOrigins(in []string) []OriginCheck {
	out := []OriginCheck{}
	for _, raw := range in {
		v := strings.TrimSpace(raw)
		if v == "" {
			continue
		}
		if o, err := parseOrigin(v, true); err != nil {
			out = append(out, OriginCheck{Input: v, Problem: err.Error()})
		} else {
			out = append(out, OriginCheck{Input: v, Origin: o.String()})
		}
	}
	return out
}
