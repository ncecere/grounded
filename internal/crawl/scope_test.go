package crawl

import (
	"strings"
	"testing"
)

func TestScopeHostsAndPrefixes(t *testing.T) {
	// Host cases ported from yoink urlpolicy.InScope.
	for _, tt := range []struct {
		seed, target string
		sub, want    bool
	}{
		{"https://example.com/Docs", "https://example.com/blog", false, true},
		{"https://api.example.com/Docs", "https://example.com/blog", true, false},
		{"https://example.com/Docs", "https://sub.example.com/blog", false, false},
		{"https://example.com/Docs", "http://sub.example.com/blog", true, true},
		{"https://example.com/Docs", "https://example.com.evil/blog", true, false},
		{"https://example.com/Docs", "https://evil-example.com/blog", true, false},
		{"https://bücher.example/", "https://xn--bcher-kva.example/A", false, true},
		{"https://[2606:4700:4700::1111]/", "https://[2606:4700:4700:0:0:0:0:1111]/A", true, true},
		{"https://[2606:4700:4700::1111]/", "https://[2606:4700:4700::1001]/", true, false},
		{"https://93.184.216.34/", "https://x.93.184.216.34/", true, false},
	} {
		s := Scope{Seeds: []string{tt.seed}, AllowSubdomains: tt.sub, MaxDepth: 3}
		if got, reason := s.Allows(tt.target, 1); got != tt.want {
			t.Errorf("%s -> %s: %v %s", tt.seed, tt.target, got, reason)
		}
	}
	s := Scope{
		Seeds:           []string{"https://www.example.edu/admissions/apply"},
		IncludePrefixes: []string{"/admissions/", "news"},
		Exclude:         []string{"/admissions/private", "**/*.ics", "/news/*/drafts/**", "/tmp?"},
		MaxDepth:        2,
	}
	for _, tt := range []struct {
		target string
		depth  int
		reason string
	}{
		{"https://www.example.edu/admissions/apply", 0, ""},
		{"https://www.example.edu/admissions/apply", 9, ""}, // seeds always allowed
		{"https://www.example.edu/admissions/", 1, ""},
		{"https://www.example.edu/admissions", 1, ""},
		{"https://www.example.edu/admissions/x/y", 2, ""},
		{"https://www.example.edu/admissions/x", 3, ReasonDepth},
		{"https://www.example.edu/admissions/x", -1, ReasonDepth},
		{"https://www.example.edu/admissionsx", 1, ReasonPrefix},
		{"https://www.example.edu/Admissions/x", 1, ReasonPrefix},
		{"https://www.example.edu/news/today", 1, ""},
		{"https://www.example.edu/other", 1, ReasonPrefix},
		{"https://example.edu/admissions/x", 1, ReasonHost},
		{"https://www.example.edu/admissions/private", 1, ReasonExcluded},
		{"https://www.example.edu/admissions/private/a", 1, ReasonExcluded},
		{"https://www.example.edu/admissions/privateer", 1, ""},
		{"https://www.example.edu/admissions/cal/events.ics", 1, ReasonExcluded},
		{"https://www.example.edu/news/2026/drafts", 1, ReasonExcluded},
		{"https://www.example.edu/news/2026/drafts/a/b", 1, ReasonExcluded},
		{"https://www.example.edu/news/2026/10/drafts/a", 1, ""},
		{"https://www.example.edu/admissions/%252e%252e/secret", 1, ReasonAmbiguousPath},
		{"https://www.example.edu/admissions/%255c..%255csecret", 1, ReasonAmbiguousPath},
		{"https://www.example.edu/admissions/a/a/a/a/a", 1, TrapRepeatedSegment},
		{"not a url", 1, ReasonInvalidURL},
	} {
		ok, reason := s.Allows(tt.target, tt.depth)
		if ok != (tt.reason == "") || reason != tt.reason {
			t.Errorf("Allows(%s, %d) = %v %q; want %q", tt.target, tt.depth, ok, reason, tt.reason)
		}
	}
	// Dot segments are resolved before prefix checks, so they can't escape.
	if ok, _ := s.Allows("https://www.example.edu/admissions/../secret", 1); ok {
		t.Error("traversal escaped prefix")
	}
	// Empty prefixes = whole host; MaxDepth 0 = seeds only.
	whole := Scope{Seeds: []string{"https://example.com/a/b"}}
	if ok, r := whole.Allows("https://example.com/", 0); !ok {
		t.Errorf("whole host: %s", r)
	}
	if ok, r := whole.Allows("https://example.com/x", 1); ok || r != ReasonDepth {
		t.Errorf("depth 0 scope followed a link: %v %s", ok, r)
	}
	if ok, r := (Scope{Seeds: []string{"https://example.com/"}, MaxDepth: 1}).Allows("https://sub.example.com/", 1); ok || r != ReasonHost {
		t.Errorf("subdomain allowed by default: %s", r)
	}
}

func TestGlobs(t *testing.T) {
	for _, tt := range []struct {
		pattern, path string
		want          bool
	}{
		{"/a/*", "/a/b", true},
		{"/a/*", "/a/b/c", false},
		{"/a/**", "/a", true},
		{"/a/**", "/a/b/c", true},
		{"/a/**", "/ab", false},
		{"**/secret", "/x/y/secret", true},
		{"**/secret", "/secret", true},
		{"*.pdf", "/x.pdf", true},
		{"*.pdf", "/d/x.pdf", false},
		{"/f?o", "/foo", true},
		{"/f?o", "/f/o", false},
		{"/a.b*", "/axb", false},
		{"private", "/private/x", true},
	} {
		if got := matchExclude(tt.pattern, tt.path); got != tt.want {
			t.Errorf("match(%q, %q) = %v", tt.pattern, tt.path, got)
		}
	}
}

func TestTrapReason(t *testing.T) {
	for _, tt := range []struct{ raw, reason string }{
		// Ported from yoink.
		{"https://example.com/2026/01/23/good-article", ""},
		{"https://example.com/a/a/a/a/a", TrapRepeatedSegment},
		{"https://example.com/" + strings.Repeat("x/", 33), TrapPathDepth},
		{"https://example.com/?" + strings.Repeat("x=1&", 64) + "y=1", TrapQuery},
		// New.
		{"https://example.com/docs/intro", ""},
		{"https://example.com/a/b/c/a/b/c/a/b/c", TrapRepeatedBlock},
		{"https://example.com/x/y/x/y/x/y", TrapRepeatedBlock},
		{"https://example.com/x/y/x/y", ""},
		{"https://example.com/?q=" + strings.Repeat("a", 1100), TrapQuery},
		{"https://example.com/" + strings.Repeat("a", 2100), TrapURLLength},
		{"https://example.com/events/calendar?month=2026-11", TrapCalendar},
		{"https://example.com/calendar/2031/05", TrapCalendar},
		{"https://example.com/events/calendar", ""},
		{"https://example.com/events/list?tribe-bar-date=2026-01-01", ""},
		{"https://example.com/news?page=3", ""},
	} {
		if got := TrapReason(tt.raw); got != tt.reason {
			t.Errorf("TrapReason(%.80s) = %q; want %q", tt.raw, got, tt.reason)
		}
	}
}
