package crawl

import (
	"net/netip"
	"net/url"
	"regexp"
	"strings"
)

// Reasons returned by Scope.Allows and TrapReason. They form a closed
// vocabulary suitable for storing on frontier rows and for metrics labels.
const (
	ReasonInvalidURL    = "invalid_url"
	ReasonDepth         = "depth"
	ReasonHost          = "host"
	ReasonPrefix        = "prefix"
	ReasonExcluded      = "excluded"
	ReasonAmbiguousPath = "ambiguous_path"

	TrapURLLength       = "trap_url_length"
	TrapPathDepth       = "trap_path_depth"
	TrapRepeatedSegment = "trap_repeated_segment"
	TrapRepeatedBlock   = "trap_repeated_block"
	TrapQuery           = "trap_query"
	TrapCalendar        = "trap_calendar"
)

// Scope decides which discovered URLs a crawl follows.
//
// Rules, in order (see Allows):
//   - A candidate equal to a normalised seed is always allowed.
//   - depth must be within 0..MaxDepth (negative MaxDepth is treated as 0).
//   - The host must equal a seed's host, or (AllowSubdomains, DNS seeds only)
//     be a subdomain of one. Scheme and port are not compared.
//   - Paths that could traverse after repeated percent-decoding are refused.
//   - IncludePrefixes: empty means the whole host. Otherwise the path must
//     match one prefix on a segment boundary: "/admissions/" and "/admissions"
//     both match "/admissions" and "/admissions/x" but not "/admissionsx".
//     Matching is case-sensitive.
//   - Exclude patterns are matched against the path only (not the query).
//     A pattern without glob metacharacters is a segment-boundary prefix like
//     IncludePrefixes. Otherwise it is a whole-path glob where "*" matches
//     within one segment, "**" matches across segments (including none), and
//     "?" matches one non-'/' byte; "/a/**" also matches "/a". Patterns are
//     anchored; use "**/private/**" to match anywhere.
//   - TrapReason must be empty.
type Scope struct {
	Seeds           []string // normalised seed URLs
	IncludePrefixes []string // optional path prefixes (e.g. "/admissions/"); empty = whole host
	Exclude         []string // path globs or prefixes, see type docs
	AllowSubdomains bool     // also follow subdomains of each seed's host
	MaxDepth        int      // link hops from a seed (0 = seeds only)
}

// Allows reports whether candidate (normalised) at depth may be crawled, and
// why not (one of the Reason*/Trap* constants).
func (s Scope) Allows(candidate string, depth int) (bool, string) {
	c, err := Normalize(candidate)
	if err != nil {
		return false, ReasonInvalidURL
	}
	cu, _ := url.Parse(c)
	hostOK := false
	for _, raw := range s.Seeds {
		seed, err := Normalize(raw)
		if err != nil {
			continue
		}
		if seed == c {
			return true, ""
		}
		su, _ := url.Parse(seed)
		if hostInScope(su.Hostname(), cu.Hostname(), s.AllowSubdomains) {
			hostOK = true
		}
	}
	if depth < 0 || depth > max(0, s.MaxDepth) {
		return false, ReasonDepth
	}
	if !hostOK {
		return false, ReasonHost
	}
	p := cu.EscapedPath()
	if !safePath(p) {
		return false, ReasonAmbiguousPath
	}
	if len(s.IncludePrefixes) > 0 {
		ok := false
		for _, prefix := range s.IncludePrefixes {
			if matchPrefix(prefix, p) {
				ok = true
				break
			}
		}
		if !ok {
			return false, ReasonPrefix
		}
	}
	for _, pattern := range s.Exclude {
		if matchExclude(pattern, p) {
			return false, ReasonExcluded
		}
	}
	if r := TrapReason(c); r != "" {
		return false, r
	}
	return true, ""
}

func hostInScope(seedHost, host string, subdomains bool) bool {
	if seedHost == host {
		return true
	}
	if !subdomains {
		return false
	}
	if _, err := netip.ParseAddr(seedHost); err == nil {
		return false
	}
	return strings.HasSuffix(host, "."+seedHost)
}

func matchPrefix(prefix, p string) bool {
	if prefix == "" {
		return false
	}
	if prefix[0] != '/' {
		prefix = "/" + prefix
	}
	root := strings.TrimRight(prefix, "/")
	return root == "" || p == root || strings.HasPrefix(p, root+"/")
}

func matchExclude(pattern, p string) bool {
	if pattern == "" {
		return false
	}
	if !strings.ContainsAny(pattern, "*?") {
		return matchPrefix(pattern, p)
	}
	re := globRegexp(pattern)
	return re != nil && re.MatchString(p)
}

// globRegexp compiles a path glob; results are not cached because scopes are
// small and Allows is not a hot loop compared with fetching.
func globRegexp(pattern string) *regexp.Regexp {
	if pattern[0] != '/' && !strings.HasPrefix(pattern, "**") {
		pattern = "/" + pattern
	}
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(pattern); i++ {
		switch c := pattern[i]; {
		case c == '*' && i+1 < len(pattern) && pattern[i+1] == '*':
			// "/**" at the end also matches the bare directory.
			if strings.HasSuffix(b.String(), "/") && i+2 == len(pattern) {
				s := strings.TrimSuffix(b.String(), "/")
				b.Reset()
				b.WriteString(s + "(?:/.*)?")
			} else {
				b.WriteString(".*")
			}
			i++
		case c == '*':
			b.WriteString("[^/]*")
		case c == '?':
			b.WriteString("[^/]")
		default:
			b.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	b.WriteString("$")
	re, err := regexp.Compile(b.String())
	if err != nil {
		return nil
	}
	return re
}

// safePath rejects dot traversal and backslashes even under repeated
// percent-encoding (ported from yoink urlpolicy). Normalize already resolves
// literal and singly-encoded dot segments; this catches "%252e%252e" etc. that
// a double-decoding server could use to escape a path prefix.
func safePath(p string) bool {
	for round := 0; round < 8; round++ {
		if strings.Contains(p, "\\") {
			return false
		}
		for _, segment := range strings.Split(p, "/") {
			if segment == "." || segment == ".." {
				return false
			}
		}
		var decoded strings.Builder
		for i := 0; i < len(p); i++ {
			if p[i] == '%' && i+2 < len(p) && isHex(p[i+1]) && isHex(p[i+2]) {
				decoded.WriteByte(unhex(p[i+1])<<4 | unhex(p[i+2]))
				i += 2
				continue
			}
			decoded.WriteByte(p[i])
		}
		if decoded.String() == p {
			return true
		}
		p = decoded.String()
	}
	return false
}

var (
	calendarSegment = regexp.MustCompile(`(?i)(calendar|kalender|agenda)`)
	dateLike        = regexp.MustCompile(`^\d{4}(?:[-/]?\d{1,2}(?:[-/]?\d{1,2})?)?$`)
	calendarParams  = map[string]bool{"date": true, "day": true, "month": true, "year": true, "week": true, "cal": true, "caldate": true, "calendar_date": true, "view": true, "mode": true, "start": true, "end": true, "tribe-bar-date": true, "ical": true, "outlook-ical": true, "time": true, "timestamp": true}
)

// TrapReason flags crawler traps (ported from yoink's basic trap filter and
// extended). It returns "" for normal URLs, otherwise one of:
//   - trap_url_length: URL longer than 2048 bytes;
//   - trap_path_depth: more than 32 path segments;
//   - trap_repeated_segment: any path segment occurring more than 4 times;
//   - trap_repeated_block: a block of 1-3 segments repeated 3+ times in a row
//     (e.g. /a/b/a/b/a/b from relative-link loops);
//   - trap_query: more than 64 query parameters, or a query longer than 1024
//     bytes;
//   - trap_calendar: a path segment mentioning calendar/agenda combined with a
//     date-like path segment or a date/navigation query parameter. Plain dated
//     article paths such as /2026/01/23/news are not flagged.
func TrapReason(normalised string) string {
	if len(normalised) > 2048 {
		return TrapURLLength
	}
	u, err := url.Parse(normalised)
	if err != nil {
		return ReasonInvalidURL
	}
	parts := strings.Split(strings.Trim(u.EscapedPath(), "/"), "/")
	if len(parts) > 32 {
		return TrapPathDepth
	}
	counts := map[string]int{}
	for _, p := range parts {
		if p != "" {
			counts[p]++
			if counts[p] > 4 {
				return TrapRepeatedSegment
			}
		}
	}
	if repeatedBlock(parts) {
		return TrapRepeatedBlock
	}
	if u.RawQuery != "" && (strings.Count(u.RawQuery, "&")+1 > 64 || len(u.RawQuery) > 1024) {
		return TrapQuery
	}
	calendar := false
	datedPath := false
	for _, p := range parts {
		if calendarSegment.MatchString(p) {
			calendar = true
		}
		if dateLike.MatchString(p) {
			datedPath = true
		}
	}
	if calendar {
		if datedPath {
			return TrapCalendar
		}
		for key, values := range u.Query() {
			if calendarParams[strings.ToLower(key)] {
				return TrapCalendar
			}
			for _, v := range values {
				if dateLike.MatchString(v) {
					return TrapCalendar
				}
			}
		}
	}
	return ""
}

func repeatedBlock(parts []string) bool {
	for size := 1; size <= 3; size++ {
		for start := 0; start+3*size <= len(parts); start++ {
			block := parts[start : start+size]
			if block[0] == "" {
				continue
			}
			reps := 1
			for next := start + size; next+size <= len(parts); next += size {
				if !equalSegments(block, parts[next:next+size]) {
					break
				}
				reps++
			}
			if reps >= 3 {
				return true
			}
		}
	}
	return false
}

func equalSegments(a, b []string) bool {
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
