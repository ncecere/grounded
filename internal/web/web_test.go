package web

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
)

func TestNormalizePattern(t *testing.T) {
	cases := []struct {
		in, want  string
		allowStar bool
		ok        bool
	}{
		{"*.EXAMPLE.edu", "*.example.edu", false, true},
		{" registrar.example.edu. ", "registrar.example.edu", false, true},
		{"*", "*", true, true},
		{"*", "", false, false},
		{"bücher.example", "xn--bcher-kva.example", false, true},
		{"*.bücher.example", "*.xn--bcher-kva.example", false, true},
		{"localhost", "", false, false},
		{"*.*.example.edu", "", false, false},
		{"example.edu/path", "", false, false},
		{"-bad.edu", "", false, false},
		{"exa mple.edu", "", false, false},
		{"", "", true, false},
		{"127.0.0.1", "127.0.0.1", false, true},
	}
	for _, tc := range cases {
		got, err := NormalizePattern(tc.in, tc.allowStar)
		if (err == nil) != tc.ok || got != tc.want {
			t.Errorf("NormalizePattern(%q, %v) = %q, %v; want %q ok=%v", tc.in, tc.allowStar, got, err, tc.want, tc.ok)
		}
	}
}

func TestMatchHost(t *testing.T) {
	cases := []struct {
		pattern, host string
		want          bool
	}{
		{"*", "anything.example.org", true},
		{"*", "", false},
		{"*.example.edu", "example.edu", true},
		{"*.example.edu", "registrar.example.edu", true},
		{"*.example.edu", "a.b.example.edu", true},
		{"*.example.edu", "notexample.edu", false},
		{"*.example.edu", "example.edu.evil.com", false},
		{"example.edu", "example.edu", true},
		{"example.edu", "www.example.edu", false},
		{"example.edu", "EXAMPLE.EDU.", true},
		{"xn--bcher-kva.example", "xn--bcher-kva.example", true},
	}
	for _, tc := range cases {
		if got := MatchHost(tc.pattern, tc.host); got != tc.want {
			t.Errorf("MatchHost(%q, %q) = %v", tc.pattern, tc.host, got)
		}
	}
}

func TestCovers(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"*", "*.example.org", true},
		{"*.example.edu", "*.it.example.edu", true},
		{"*.example.edu", "example.edu", true},
		{"*.example.edu", "*.example.edu", true},
		{"example.edu", "*.example.edu", false},
		{"*.it.example.edu", "*.example.edu", false},
		{"www.example.edu", "www.example.edu", true},
		{"*.example.edu", "*", false},
	}
	for _, tc := range cases {
		if got := Covers(tc.a, tc.b); got != tc.want {
			t.Errorf("Covers(%q, %q) = %v", tc.a, tc.b, got)
		}
	}
}

func code(err error) string {
	if e, ok := apperr.As(err); ok {
		return e.Code
	}
	if err != nil {
		return err.Error()
	}
	return ""
}

func TestParseConfig(t *testing.T) {
	parse := func(js string) (Config, error) { return ParseConfig(json.RawMessage(js), 1000) }

	c, err := parse(`{"mode":"crawl","urls":["HTTPS://Registrar.EXAMPLE.edu/#top","https://registrar.example.edu/"],"exclude":["/calendar/**"],"schedule":"weekly"}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.URLs) != 1 || c.URLs[0] != "https://registrar.example.edu/" {
		t.Errorf("urls not normalised and deduplicated: %v", c.URLs)
	}
	if c.MaxDepth != DefaultMaxDepth || c.MaxPages != DefaultMaxPages || !c.UseSitemaps || c.AllowSubdomains || c.Schedule != "weekly" {
		t.Errorf("defaults = %+v", c)
	}
	if hosts := c.Hosts(); len(hosts) != 1 || hosts[0] != "registrar.example.edu" {
		t.Errorf("hosts = %v", hosts)
	}
	// Round trip through the stored form.
	back, err := Stored(c.JSON())
	if err != nil || back.Mode != c.Mode || back.MaxPages != c.MaxPages {
		t.Errorf("stored round trip = %+v, %v", back, err)
	}

	// Crawl-only settings are dropped for other modes; maxPages follows the mode.
	c, err = parse(`{"mode":"batch","urls":["https://a.example.edu/1","https://a.example.edu/2"],"maxDepth":5,"useSitemaps":true}`)
	if err != nil || c.MaxDepth != 0 || c.UseSitemaps || c.MaxPages != 2 || c.Schedule != "manual" {
		t.Errorf("batch = %+v, %v", c, err)
	}
	c, err = parse(`{"mode":"scrape","urls":["https://a.example.edu/"],"maxPages":50}`)
	if err != nil || c.MaxPages != 1 {
		t.Errorf("scrape = %+v, %v", c, err)
	}
	c, err = parse(`{"mode":"crawl","urls":["https://a.example.edu/"],"maxDepth":0,"useSitemaps":false,"allowSubdomains":true,"includePrefixes":["/admissions/"]}`)
	if err != nil || c.MaxDepth != 0 || c.UseSitemaps || !c.AllowSubdomains || c.IncludePrefixes[0] != "/admissions/" {
		t.Errorf("explicit crawl = %+v, %v", c, err)
	}

	many := make([]string, 21)
	for i := range many {
		many[i] = `"https://a.example.edu/` + strings.Repeat("x", i+1) + `"`
	}
	bad := []string{
		``,
		`null`,
		`{"mode":"crawl","urls":["https://a.example.edu/"],"extra":1}`,
		`{"mode":"spider","urls":["https://a.example.edu/"]}`,
		`{"mode":"scrape","urls":["https://a.example.edu/1","https://a.example.edu/2"]}`,
		`{"mode":"batch","urls":[]}`,
		`{"mode":"crawl","urls":[` + strings.Join(many, ",") + `]}`,
		`{"mode":"crawl","urls":["ftp://a.example.edu/"]}`,
		`{"mode":"crawl","urls":["https://user:pw@a.example.edu/"]}`,
		`{"mode":"crawl","urls":["https://a.example.edu/"],"maxDepth":11}`,
		`{"mode":"crawl","urls":["https://a.example.edu/"],"maxPages":1001}`,
		`{"mode":"crawl","urls":["https://a.example.edu/"],"maxPages":0}`,
		`{"mode":"crawl","urls":["https://a.example.edu/"],"includePrefixes":["admissions"]}`,
		`{"mode":"crawl","urls":["https://a.example.edu/"],"includePrefixes":["/a*"]}`,
		`{"mode":"crawl","urls":["https://a.example.edu/"],"exclude":["calendar"]}`,
		`{"mode":"crawl","urls":["https://a.example.edu/"],"schedule":"hourly"}`,
		`{"mode":"crawl","urls":["https://a.example.edu/"]} {}`,
	}
	for _, js := range bad {
		if _, err := parse(js); code(err) != "invalid_web_config" {
			t.Errorf("%s: err = %v", js, err)
		}
	}
	// A batch may hold up to 1000 URLs.
	urls := make([]string, 1001)
	for i := range urls {
		urls[i] = `"https://a.example.edu/p` + strings.Repeat("y", i%7) + string(rune('a'+i%26)) + `/` + itoa(i) + `"`
	}
	if _, err := parse(`{"mode":"batch","urls":[` + strings.Join(urls[:1000], ",") + `]}`); err != nil {
		t.Errorf("1000 batch URLs: %v", err)
	}
	if _, err := parse(`{"mode":"batch","urls":[` + strings.Join(urls, ",") + `]}`); code(err) != "invalid_web_config" {
		t.Errorf("1001 batch URLs: %v", err)
	}
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func TestNextSync(t *testing.T) {
	now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	if NextSync(ScheduleManual, now) != nil {
		t.Error("manual has a next sync")
	}
	if d := NextSync(ScheduleDaily, now); d == nil || !d.Equal(now.Add(24*time.Hour)) {
		t.Errorf("daily = %v", d)
	}
	if w := NextSync(ScheduleWeekly, now); w == nil || !w.Equal(now.Add(7*24*time.Hour)) {
		t.Errorf("weekly = %v", w)
	}
}
