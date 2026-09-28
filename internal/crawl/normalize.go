package crawl

import (
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/net/idna"
)

// maxURLBytes bounds both raw input and normalised output.
const maxURLBytes = 8192

var errInvalidURL = errors.New("crawl: invalid URL")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", errInvalidURL, fmt.Sprintf(format, args...))
}

// Normalize canonicalises an absolute http(s) URL for identity: lower-case
// scheme/host, IDNA to ASCII, default ports dropped, fragment removed,
// dot-segments resolved, empty path -> "/", and tracking query params removed
// (utm_*, gclid, fbclid, mc_cid, mc_eid). Other query params are kept in sorted
// order. Rejects userinfo, non-http(s) schemes, and invalid hosts.
//
// Additional canonicalisation (see package docs): percent-escapes are
// upper-cased and escaped unreserved characters decoded; "%2e" counts as a dot
// segment (WHATWG); IPv6 literals are compressed; and hosts that "end in a
// number" are parsed as WHATWG IPv4 (so 2130706433, 0177.0.0.1, 0x7f.1 and
// 127.1 all become 127.0.0.1) or rejected. Non-default ports are kept here; the
// Fetcher enforces its own port policy.
func Normalize(raw string) (string, error) {
	if len(raw) == 0 || len(raw) > maxURLBytes {
		return "", invalid("URL must contain 1-%d bytes", maxURLBytes)
	}
	// WHATWG strips ASCII tab/newline anywhere and surrounding whitespace.
	raw = strings.TrimSpace(strings.NewReplacer("\t", "", "\n", "", "\r", "").Replace(raw))
	u, err := url.Parse(raw)
	if err != nil {
		return "", invalid("%v", err)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", invalid("scheme must be http or https")
	}
	if u.Opaque != "" || u.Host == "" {
		return "", invalid("URL must be absolute")
	}
	if u.User != nil {
		return "", invalid("URL must not contain credentials")
	}
	host, err := normalizeHost(u.Hostname())
	if err != nil {
		return "", err
	}
	if strings.HasSuffix(u.Host, ":") {
		return "", invalid("empty port")
	}
	port, err := normalizePort(scheme, u.Port())
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString(scheme)
	b.WriteString("://")
	if strings.Contains(host, ":") {
		b.WriteString("[" + host + "]")
	} else {
		b.WriteString(host)
	}
	if port != "" {
		b.WriteString(":" + port)
	}
	b.WriteString(normalizePath(u.EscapedPath()))
	if q := normalizeQuery(u.RawQuery); q != "" {
		b.WriteString("?" + q)
	}
	out := b.String()
	if len(out) > maxURLBytes {
		return "", invalid("normalised URL too long")
	}
	return out, nil
}

func normalizeHost(h string) (string, error) {
	host := strings.TrimSuffix(strings.ToLower(h), ".")
	if host == "" || strings.ContainsAny(host, "%\\ \t\r\n") {
		return "", invalid("invalid host")
	}
	if strings.Contains(host, ":") {
		ip, err := netip.ParseAddr(host)
		if err != nil || !ip.Is6() || ip.Zone() != "" {
			return "", invalid("invalid IPv6 host")
		}
		return ip.String(), nil
	}
	if endsInNumber(host) {
		ip, ok := parseWHATWGIPv4(host)
		if !ok {
			return "", invalid("invalid IPv4 host")
		}
		return ip.String(), nil
	}
	ascii, err := idna.Lookup.ToASCII(host)
	if err != nil {
		return "", invalid("invalid hostname: %v", err)
	}
	if len(ascii) > 253 {
		return "", invalid("hostname too long")
	}
	if !validLabels(ascii) || endsInNumber(ascii) {
		return "", invalid("invalid hostname")
	}
	return ascii, nil
}

// normalizePort validates a port and drops the scheme's default.
func normalizePort(scheme, port string) (string, error) {
	if port == "" {
		return "", nil
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", invalid("invalid port")
	}
	if scheme == "http" && n == 80 || scheme == "https" && n == 443 {
		return "", nil
	}
	return strconv.Itoa(n), nil
}

// validLabels checks the labels of an ASCII hostname: 1-63 characters of
// a-z, 0-9 and "-", not starting or ending with "-".
func validLabels(ascii string) bool {
	for _, label := range strings.Split(ascii, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, r := range label {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
				return false
			}
		}
	}
	return true
}

// endsInNumber implements the WHATWG "ends in a number" check: such hosts are
// IPv4 addresses (in any legacy notation) or invalid, never DNS names.
func endsInNumber(host string) bool {
	parts := strings.Split(host, ".")
	last := parts[len(parts)-1]
	if last == "" {
		return false
	}
	if strings.Trim(last, "0123456789") == "" {
		return true
	}
	_, ok := parseIPv4Number(last)
	return ok
}

func parseIPv4Number(s string) (uint64, bool) {
	if s == "" {
		return 0, false
	}
	base := 10
	switch {
	case len(s) >= 2 && (s[:2] == "0x" || s[:2] == "0X"):
		s, base = s[2:], 16
		if s == "" {
			return 0, true
		}
	case len(s) >= 2 && s[0] == '0':
		s, base = s[1:], 8
	}
	n, err := strconv.ParseUint(s, base, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// parseWHATWGIPv4 accepts 1-4 dot-separated decimal, octal or hex parts, as
// browsers (and inet_aton) do.
func parseWHATWGIPv4(host string) (netip.Addr, bool) {
	parts := strings.Split(host, ".")
	if len(parts) > 4 {
		return netip.Addr{}, false
	}
	nums := make([]uint64, len(parts))
	for i, p := range parts {
		n, ok := parseIPv4Number(p)
		if !ok {
			return netip.Addr{}, false
		}
		nums[i] = n
	}
	for _, n := range nums[:len(nums)-1] {
		if n > 255 {
			return netip.Addr{}, false
		}
	}
	last := nums[len(nums)-1]
	if last >= 1<<(8*(5-len(nums))) {
		return netip.Addr{}, false
	}
	v := last
	for i, n := range nums[:len(nums)-1] {
		v += n << (8 * (3 - i))
	}
	return netip.AddrFrom4([4]byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}), true
}

func isUnreserved(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '.' || c == '_' || c == '~'
}

func isHex(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'
}

func unhex(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	default:
		return c - 'A' + 10
	}
}

// normEscapes upper-cases percent-escapes, decodes escaped unreserved bytes,
// and escapes bytes outside allowed (including a literal '%' that does not
// start a valid escape).
func normEscapes(s string, allowed func(byte) bool) string {
	const hexdigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '%' && i+2 < len(s) && isHex(s[i+1]) && isHex(s[i+2]) {
			d := unhex(s[i+1])<<4 | unhex(s[i+2])
			if isUnreserved(d) {
				b.WriteByte(d)
			} else {
				b.WriteByte('%')
				b.WriteByte(hexdigits[d>>4])
				b.WriteByte(hexdigits[d&15])
			}
			i += 2
			continue
		}
		if c != '%' && allowed(c) {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hexdigits[c>>4])
		b.WriteByte(hexdigits[c&15])
	}
	return b.String()
}

func isSubDelim(c byte) bool { return strings.IndexByte("!$&'()*+,;=", c) >= 0 }

func pathByte(c byte) bool {
	return isUnreserved(c) || isSubDelim(c) || c == ':' || c == '@' || c == '/'
}

func queryByte(c byte) bool {
	return pathByte(c) || c == '?'
}

// normalizePath resolves dot segments (RFC 3986 5.2.4, treating "%2e" as ".").
func normalizePath(escaped string) string {
	p := normEscapes(escaped, pathByte)
	if p == "" {
		return "/"
	}
	if p[0] != '/' {
		p = "/" + p
	}
	segs := strings.Split(p[1:], "/")
	out := make([]string, 0, len(segs))
	trailing := false
	for i, s := range segs {
		last := i == len(segs)-1
		switch s {
		case ".":
			trailing = last
		case "..":
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
			trailing = last
		default:
			out = append(out, s)
			trailing = false
		}
	}
	res := "/" + strings.Join(out, "/")
	if trailing && !strings.HasSuffix(res, "/") {
		res += "/"
	}
	return res
}

// IsTrackingParam reports whether a (decoded) query key is removed by Normalize.
func IsTrackingParam(key string) bool {
	k := strings.ToLower(key)
	switch k {
	case "gclid", "fbclid", "mc_cid", "mc_eid":
		return true
	}
	return strings.HasPrefix(k, "utm_")
}

func normalizeQuery(raw string) string {
	if raw == "" {
		return ""
	}
	type param struct{ key, part string }
	params := []param{}
	for _, part := range strings.Split(raw, "&") {
		if part == "" {
			continue
		}
		part = normEscapes(part, queryByte)
		k, _, _ := strings.Cut(part, "=")
		key, err := url.QueryUnescape(k)
		if err != nil {
			key = k
		}
		if IsTrackingParam(key) {
			continue
		}
		params = append(params, param{key, part})
	}
	sort.SliceStable(params, func(i, j int) bool {
		if params[i].key != params[j].key {
			return params[i].key < params[j].key
		}
		return params[i].part < params[j].part
	})
	parts := make([]string, len(params))
	for i, p := range params {
		parts[i] = p.part
	}
	return strings.Join(parts, "&")
}
