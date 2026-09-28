package web

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/crawl"
	"github.com/ncecere/grounded/internal/tags"
)

// Modes (one per source).
const (
	ModeScrape = "scrape" // one URL
	ModeBatch  = "batch"  // a list of URLs
	ModeCrawl  = "crawl"  // seeds plus link following within a scope
)

// Schedules.
const (
	ScheduleManual = "manual"
	ScheduleDaily  = "daily"
	ScheduleWeekly = "weekly"
)

// Limits on a web source configuration.
const (
	MaxBatchURLs    = 1000
	MaxCrawlSeeds   = 20
	MaxDepthLimit   = 10
	DefaultMaxDepth = 3
	DefaultMaxPages = 500
	maxPatterns     = 50
	maxPatternLen   = 500
	// MaxURLBytes is the longest URL stored (documents.external_id).
	MaxURLBytes = 2048
)

// Config is the normalised configuration of a web source, stored in
// data_sources.config and snapshotted on each crawl run. Crawl-only fields
// are zero for scrape and batch sources.
type Config struct {
	Mode            string   `json:"mode"`
	URLs            []string `json:"urls"`
	MaxDepth        int      `json:"maxDepth"`
	MaxPages        int      `json:"maxPages"`
	IncludePrefixes []string `json:"includePrefixes"`
	Exclude         []string `json:"exclude"`
	AllowSubdomains bool     `json:"allowSubdomains"`
	UseSitemaps     bool     `json:"useSitemaps"`
	Schedule        string   `json:"schedule"`
	// Tags are applied to every page (metadata filters).
	Tags []string `json:"tags"`
}

// input mirrors Config with optional fields, to apply defaults.
type input struct {
	Mode            string   `json:"mode"`
	URLs            []string `json:"urls"`
	MaxDepth        *int     `json:"maxDepth"`
	MaxPages        *int     `json:"maxPages"`
	IncludePrefixes []string `json:"includePrefixes"`
	Exclude         []string `json:"exclude"`
	AllowSubdomains *bool    `json:"allowSubdomains"`
	UseSitemaps     *bool    `json:"useSitemaps"`
	Schedule        string   `json:"schedule"`
	Tags            []string `json:"tags"`
}

func invalid(format string, args ...any) error {
	return apperr.Invalid("invalid_web_config", fmt.Sprintf(format, args...))
}

// ParseConfig validates and normalises a web source configuration. URLs are
// normalised with crawl.Normalize and deduplicated; maxPagesLimit is the
// platform ceiling (CRAWL_MAX_PAGES). Unknown fields are rejected. Hosts are
// not checked against the allowlist here (see Service.ValidateConfig).
func ParseConfig(raw json.RawMessage, maxPagesLimit int) (Config, error) {
	in, err := decodeInput(raw)
	if err != nil {
		return Config{}, err
	}
	c := Config{Mode: in.Mode, Schedule: in.Schedule, IncludePrefixes: []string{}, Exclude: []string{}}
	tagList, err := tags.Normalize(in.Tags)
	if err != nil {
		return Config{}, invalid("tags: %s", err.(*apperr.Error).Message)
	}
	c.Tags = tagList
	switch c.Schedule {
	case "":
		c.Schedule = ScheduleManual
	case ScheduleManual, ScheduleDaily, ScheduleWeekly:
	default:
		return Config{}, invalid("schedule must be manual, daily or weekly")
	}
	if c.URLs, err = normalizeURLs(in.URLs); err != nil {
		return Config{}, err
	}
	if err := checkURLCount(c.Mode, len(c.URLs)); err != nil {
		return Config{}, err
	}
	if c.MaxPages, err = maxPages(c.Mode, in.MaxPages, len(c.URLs), maxPagesLimit); err != nil {
		return Config{}, err
	}
	if c.Mode != ModeCrawl {
		// Crawl-only settings have no effect on scrape and batch sources.
		return c, nil
	}
	if err := c.crawlSettings(in); err != nil {
		return Config{}, err
	}
	return c, nil
}

// decodeInput reads exactly one JSON object with known fields only.
func decodeInput(raw json.RawMessage) (input, error) {
	var in input
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return in, invalid("Web sources need a web configuration")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return in, invalid("The web configuration is not valid: %v", err)
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return in, invalid("The web configuration must be a single JSON object")
	}
	return in, nil
}

// normalizeURLs normalises and deduplicates the URLs, keeping their order.
func normalizeURLs(in []string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, raw := range in {
		n, err := crawl.Normalize(strings.TrimSpace(raw))
		if err != nil {
			return nil, invalid("%q is not a valid http(s) URL", clip(raw, 200))
		}
		if len(n) > MaxURLBytes {
			return nil, invalid("URLs must be at most %d characters", MaxURLBytes)
		}
		if !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	return out, nil
}

// checkURLCount checks the mode and its number of URLs.
func checkURLCount(mode string, n int) error {
	switch mode {
	case ModeScrape:
		if n != 1 {
			return invalid("scrape mode takes exactly 1 URL")
		}
	case ModeBatch:
		if n < 1 || n > MaxBatchURLs {
			return invalid("batch mode takes 1-%d URLs", MaxBatchURLs)
		}
	case ModeCrawl:
		if n < 1 || n > MaxCrawlSeeds {
			return invalid("crawl mode takes 1-%d seed URLs", MaxCrawlSeeds)
		}
	default:
		return invalid("mode must be scrape, batch or crawl")
	}
	return nil
}

// maxPages is the page cap: 1 for scrape, else the requested value within
// limit, defaulting to the URL count (batch) or DefaultMaxPages (crawl).
func maxPages(mode string, requested *int, urls, limit int) (int, error) {
	if limit < 1 {
		limit = 1
	}
	switch {
	case mode == ModeScrape:
		return 1, nil
	case requested != nil:
		if *requested < 1 || *requested > limit {
			return 0, invalid("maxPages must be between 1 and %d", limit)
		}
		return *requested, nil
	case mode == ModeBatch:
		return min(urls, limit), nil
	}
	return min(DefaultMaxPages, limit), nil
}

// crawlSettings applies the crawl-only settings: depth, sitemaps,
// subdomains and path patterns.
func (c *Config) crawlSettings(in input) error {
	c.MaxDepth = DefaultMaxDepth
	if in.MaxDepth != nil {
		if *in.MaxDepth < 0 || *in.MaxDepth > MaxDepthLimit {
			return invalid("maxDepth must be between 0 and %d", MaxDepthLimit)
		}
		c.MaxDepth = *in.MaxDepth
	}
	c.UseSitemaps = in.UseSitemaps == nil || *in.UseSitemaps
	c.AllowSubdomains = in.AllowSubdomains != nil && *in.AllowSubdomains
	var err error
	if c.IncludePrefixes, err = pathPatterns("includePrefixes", in.IncludePrefixes, false); err != nil {
		return err
	}
	c.Exclude, err = pathPatterns("exclude", in.Exclude, true)
	return err
}

// pathPatterns validates include prefixes ("/admissions/") or exclude
// patterns ("/calendar/**", "**/private/**").
func pathPatterns(field string, in []string, globs bool) ([]string, error) {
	if len(in) > maxPatterns {
		return nil, invalid("%s takes at most %d entries", field, maxPatterns)
	}
	out := []string{}
	for _, p := range in {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if len(p) > maxPatternLen || strings.ContainsAny(p, " \t\r\n#") || (!globs && strings.ContainsAny(p, "?*")) {
			return nil, invalid("%s entry %q is not a valid path", field, clip(p, 100))
		}
		if !strings.HasPrefix(p, "/") && !(globs && strings.HasPrefix(p, "*")) {
			return nil, invalid("%s entries must start with /", field)
		}
		out = append(out, p)
	}
	return out, nil
}

// Stored parses a configuration previously produced by ParseConfig.
func Stored(raw json.RawMessage) (Config, error) {
	var c Config
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, fmt.Errorf("web: stored config: %w", err)
	}
	if c.Mode == "" || len(c.URLs) == 0 {
		return c, fmt.Errorf("web: stored config is incomplete")
	}
	if c.Tags == nil {
		c.Tags = []string{}
	}
	return c, nil
}

// JSON returns the stored form.
func (c Config) JSON() json.RawMessage {
	b, _ := json.Marshal(c)
	return b
}

// Scope is the crawl scope for link following.
func (c Config) Scope() crawl.Scope {
	return crawl.Scope{
		Seeds: c.URLs, IncludePrefixes: c.IncludePrefixes, Exclude: c.Exclude,
		AllowSubdomains: c.AllowSubdomains, MaxDepth: c.MaxDepth,
	}
}

// Hosts returns the distinct hostnames of the configured URLs.
func (c Config) Hosts() []string {
	var out []string
	seen := map[string]bool{}
	for _, raw := range c.URLs {
		if u, err := url.Parse(raw); err == nil && !seen[u.Hostname()] {
			seen[u.Hostname()] = true
			out = append(out, u.Hostname())
		}
	}
	return out
}

// NextSync returns when a source with schedule should next sync after from
// (nil for manual).
func NextSync(schedule string, from time.Time) *time.Time {
	var t time.Time
	switch schedule {
	case ScheduleDaily:
		t = from.Add(24 * time.Hour)
	case ScheduleWeekly:
		t = from.Add(7 * 24 * time.Hour)
	default:
		return nil
	}
	return &t
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
