package crawl

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/temoto/robotstxt"
)

const (
	maxRobotsBytes   = 512 << 10 // RFC 9309: parse at least 500 KiB; the rest is ignored
	robotsTTL        = time.Hour
	robotsFailureTTL = time.Minute
	maxRobotsEntries = 10000
)

// robotsEntry is one origin's cached robots.txt decision. Concurrent callers
// for the same origin share a single in-flight fetch.
type robotsEntry struct {
	done    chan struct{}
	retry   bool // loader's own context ended; waiters must try again
	data    *robotstxt.RobotsData
	denyAll error // non-nil: every path is refused with this cause
	err     error // policy/SSRF error: returned as-is, never cached
	expires time.Time
}

func (e *robotsEntry) ready() bool {
	select {
	case <-e.done:
		return true
	default:
		return false
	}
}

// originOf returns scheme://host[:port] of a normalised URL.
func originOf(normalized string) (string, error) {
	u, err := url.Parse(normalized)
	if err != nil {
		return "", err
	}
	return u.Scheme + "://" + u.Host, nil
}

// robotsFor returns the cached (or freshly fetched) robots entry for origin.
func (f *Fetcher) robotsFor(ctx context.Context, origin string) (*robotsEntry, error) {
	for {
		f.robotsMu.Lock()
		e := f.robots[origin]
		if e != nil && e.ready() && !f.now().Before(e.expires) {
			delete(f.robots, origin)
			e = nil
		}
		if e == nil {
			f.evictRobotsLocked()
			e = &robotsEntry{done: make(chan struct{})}
			f.robots[origin] = e
			f.robotsMu.Unlock()
			f.loadRobots(ctx, origin, e)
		} else {
			f.robotsMu.Unlock()
			select {
			case <-e.done:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		if e.retry {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			continue
		}
		return e, nil
	}
}

func (f *Fetcher) evictRobotsLocked() {
	if len(f.robots) < maxRobotsEntries {
		return
	}
	now := f.now()
	for o, e := range f.robots {
		if e.ready() && !now.Before(e.expires) {
			delete(f.robots, o)
		}
	}
	for o, e := range f.robots {
		if len(f.robots) < maxRobotsEntries {
			break
		}
		if e.ready() {
			delete(f.robots, o)
		}
	}
}

func (f *Fetcher) loadRobots(ctx context.Context, origin string, e *robotsEntry) {
	defer close(e.done)
	h := http.Header{}
	h.Set("Accept", "text/plain, */*;q=0.5")
	r, err := f.get(ctx, origin+"/robots.txt", false, h, maxRobotsBytes, nil)
	ttl := robotsTTL
	switch {
	case err != nil && ctx.Err() != nil:
		e.retry = true
	case err != nil && (errors.Is(err, ErrBlockedAddress) || errors.Is(err, ErrHostNotAllowed)):
		e.err = err
	case err != nil:
		e.denyAll = fmt.Errorf("robots.txt unavailable: %w", err)
		ttl = robotsFailureTTL
	case r.status >= 200 && r.status < 300:
		if looksLikeHTML(r.body) {
			// Soft-404 HTML pages carry no rules (Google/RFC 9309 behaviour).
			e.data, _ = robotstxt.FromBytes(nil)
			break
		}
		data, perr := robotstxt.FromBytes(r.body)
		if perr != nil {
			e.denyAll = fmt.Errorf("robots.txt unparseable: %w", perr)
		} else {
			e.data = data
		}
	case r.status == http.StatusUnauthorized || r.status == http.StatusForbidden || r.status == http.StatusTooManyRequests || r.status >= 500:
		// Conservative (yoink): access-denied, rate-limited and server errors
		// mean "do not crawl"; retried after robotsFailureTTL.
		e.denyAll = fmt.Errorf("robots.txt status %d", r.status)
		ttl = robotsFailureTTL
	default:
		// 404, 410 and other 4xx: no restrictions (RFC 9309 2.3.1.3).
		e.data, _ = robotstxt.FromBytes(nil)
	}
	e.expires = f.now().Add(ttl)
	if e.retry || e.err != nil {
		f.robotsMu.Lock()
		if f.robots[origin] == e {
			delete(f.robots, origin)
		}
		f.robotsMu.Unlock()
	}
}

func looksLikeHTML(b []byte) bool {
	head := bytes.ToLower(bytes.TrimSpace(b[:min(len(b), 1024)]))
	return bytes.HasPrefix(head, []byte("<!doctype html")) || bytes.HasPrefix(head, []byte("<html")) || bytes.Contains(head, []byte("<head")) || bytes.Contains(head, []byte("<body"))
}

// robotsCheck returns nil when normalized may be fetched by our product token.
func (f *Fetcher) robotsCheck(ctx context.Context, normalized string) error {
	origin, err := originOf(normalized)
	if err != nil {
		return err
	}
	e, err := f.robotsFor(ctx, origin)
	if err != nil {
		return err
	}
	if e.err != nil {
		return e.err
	}
	if e.denyAll != nil {
		return fmt.Errorf("%w: %s: %v", ErrRobotsDisallowed, normalized, e.denyAll)
	}
	u, _ := url.Parse(normalized)
	if !e.data.TestAgent(u.RequestURI(), f.robotsTok) {
		return fmt.Errorf("%w: %s", ErrRobotsDisallowed, normalized)
	}
	return nil
}

// Allowed reports whether robots.txt permits fetching rawURL (using the cache).
// Policy and SSRF failures are returned as errors.
func (f *Fetcher) Allowed(ctx context.Context, rawURL string) (bool, error) {
	normalized, err := Normalize(rawURL)
	if err != nil {
		return false, err
	}
	err = f.robotsCheck(ctx, normalized)
	if errors.Is(err, ErrRobotsDisallowed) {
		return false, nil
	}
	return err == nil, err
}
