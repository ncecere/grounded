package web

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/crawl"
)

// Map limits.
const (
	MapTimeout      = 30 * time.Second
	MapDefaultLimit = 500
	MapMaxLimit     = 2000
)

// MapInput describes a discovery preview.
type MapInput struct {
	URL             string
	UseSitemaps     bool
	Limit           int // 0 = MapDefaultLimit
	IncludePrefixes []string
	Exclude         []string
	AllowSubdomains bool
}

// MapResult lists discovered URLs. Nothing is stored.
type MapResult struct {
	URLs        []string
	Truncated   bool // the limit or the time bound cut discovery short
	SitemapURLs int  // in-scope URLs found in sitemaps
}

// Map discovers the URLs a crawl starting at in.URL would see one hop away:
// the page's links and, optionally, its site's sitemaps, filtered by scope
// and the team's allowlist. It is synchronous and bounded by MapTimeout.
// Team editors (and API keys with the ingest scope) may map.
func (s *Service) Map(ctx context.Context, a authz.Actor, teamRef string, in MapInput) (MapResult, error) {
	acc, err := s.teamAccess(ctx, a, teamRef, authz.RoleEditor, false)
	if err != nil {
		return MapResult{}, err
	}
	if err := s.checkMaintenance(ctx); err != nil {
		return MapResult{}, err
	}
	team := uuid.NullUUID{UUID: acc.Team.ID, Valid: true}
	seed, limit, scope, err := mapScope(in)
	if err != nil {
		return MapResult{}, err
	}
	u, _ := url.Parse(seed)
	if ok, err := s.Allow.Allowed(ctx, team, u.Hostname()); err != nil {
		return MapResult{}, err
	} else if !ok {
		return MapResult{}, s.hostNotAllowedFor(ctx, team, u.Hostname())
	}

	ctx, cancel := context.WithTimeout(ctx, MapTimeout)
	defer cancel()
	ctx = crawl.WithHostPolicy(ctx, s.Allow.Policy(ctx, team))
	m := &mapper{s: s, ctx: ctx, team: team, scope: scope, limit: limit, seen: map[string]bool{}, res: MapResult{URLs: []string{}}}
	m.add(seed)

	pg, fetchErr := s.Fetcher.Fetch(ctx, seed)
	if err := m.addPageLinks(pg, fetchErr, seed, u.Hostname()); err != nil {
		return MapResult{}, err
	}
	if in.UseSitemaps && ctx.Err() == nil {
		urls, _ := s.Fetcher.Sitemaps(ctx, seed, limit*4)
		for _, link := range urls {
			if m.add(link) {
				m.res.SitemapURLs++
			}
		}
	}
	if ctx.Err() != nil {
		m.res.Truncated = true
	}
	if len(m.res.URLs) <= 1 && m.res.SitemapURLs == 0 {
		if err := mapFailure(fetchErr, pg.Status); err != nil {
			return MapResult{}, err
		}
	}
	return m.res, nil
}

// mapScope checks a map request: the seed URL, the limit and the path
// patterns.
func mapScope(in MapInput) (seed string, limit int, scope crawl.Scope, err error) {
	limit = in.Limit
	if limit == 0 {
		limit = MapDefaultLimit
	}
	if limit < 1 || limit > MapMaxLimit {
		return "", 0, scope, apperr.Invalid("invalid_limit", "limit must be between 1 and 2000")
	}
	seed, err = crawl.Normalize(strings.TrimSpace(in.URL))
	if err != nil {
		return "", 0, scope, apperr.Invalid("invalid_url", "Enter a valid http(s) URL")
	}
	include, err := pathPatterns("includePrefixes", in.IncludePrefixes, false)
	if err != nil {
		return "", 0, scope, err
	}
	exclude, err := pathPatterns("exclude", in.Exclude, true)
	if err != nil {
		return "", 0, scope, err
	}
	scope = crawl.Scope{Seeds: []string{seed}, IncludePrefixes: include, Exclude: exclude, AllowSubdomains: in.AllowSubdomains, MaxDepth: 1}
	return seed, limit, scope, nil
}

// mapper collects the distinct in-scope, allowed URLs of a map, up to limit.
type mapper struct {
	s     *Service
	ctx   context.Context
	team  uuid.NullUUID
	scope crawl.Scope
	limit int
	seen  map[string]bool
	res   MapResult
}

// add adds a link seen for the first time if it is in scope and allowed,
// and reports whether it did.
func (m *mapper) add(link string) bool {
	if m.seen[link] {
		return false
	}
	m.seen[link] = true
	if ok, _ := m.scope.Allows(link, 1); !ok || len(link) > MaxURLBytes {
		return false
	}
	lu, err := url.Parse(link)
	if err != nil {
		return false
	}
	if ok, _ := m.s.Allow.Allowed(m.ctx, m.team, lu.Hostname()); !ok {
		return false
	}
	if len(m.res.URLs) >= m.limit {
		m.res.Truncated = true
		return false
	}
	m.res.URLs = append(m.res.URLs, link)
	return true
}

// addPageLinks adds the links of the fetched seed page. A host that is not
// allowed, or an address that may not be crawled, fails the map.
func (m *mapper) addPageLinks(pg crawl.Page, fetchErr error, seed, host string) error {
	switch {
	case errors.Is(fetchErr, crawl.ErrHostNotAllowed):
		return hostNotAllowed(host)
	case errors.Is(fetchErr, crawl.ErrBlockedAddress):
		return apperr.Invalid("blocked_address", "That address cannot be crawled: only public websites on ports 80 and 443 are allowed")
	case fetchErr == nil && pg.Status >= 200 && pg.Status < 300 && isHTML(pg.ContentType):
		base := pg.FinalURL
		if base == "" {
			base = seed
		}
		for _, link := range crawl.Links(pg.Body, base) {
			m.add(link)
		}
	}
	return nil
}

// mapFailure explains why a map found nothing beyond the seed, when the
// seed page could not be read. The remote site's answer is the person's to
// fix (an address, a site that refuses crawlers), so it is a 422 that says
// what the site said, never a 5xx that reads as Grounded's own failure
// (BU-08).
func mapFailure(fetchErr error, status int) error {
	switch {
	case fetchErr != nil && errors.Is(fetchErr, crawl.ErrRobotsDisallowed):
		return apperr.New(422, "robots_disallowed", "The site's robots.txt does not allow crawling this page.")
	case fetchErr != nil && errors.Is(fetchErr, context.DeadlineExceeded):
		return apperr.New(422, "fetch_failed", "That page took too long to answer. Check the address, or try again later.")
	case fetchErr != nil:
		return apperr.New(422, "fetch_failed", "Couldn't reach that page. Check the address and try again.")
	case status < 200 || status >= 300:
		return apperr.New(422, "fetch_failed", remoteStatusText(status))
	}
	return nil
}

// remoteStatusText says in plain words what a site's HTTP status means for
// the person previewing it: "That page returned 404 (not found). Check the
// address."
func remoteStatusText(status int) string {
	code := strconv.Itoa(status)
	switch {
	case status == 404 || status == 410:
		return "That page returned " + code + " (not found). Check the address."
	case status == 401 || status == 403:
		return "That page returned " + code + " (access denied): the site doesn't let crawlers read it. Check the address, or use a public page."
	case status == 429:
		return "That site returned 429 (too many requests). Try again in a few minutes."
	case status >= 500:
		return "That site returned " + code + " (an error on the site's side). Try again later."
	case status >= 300 && status < 400:
		return "That page returned " + code + " (a redirect the crawler couldn't follow). Use the address it redirects to."
	}
	return "That page returned HTTP " + code + ". Check the address."
}
