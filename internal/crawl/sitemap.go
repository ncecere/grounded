package crawl

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Sitemap bounds. The protocol caps one sitemap at 50,000 URLs and 50 MB.
const (
	DefaultSitemapMaxURLs   = 50000
	maxSitemapDepth         = 3 // index nesting below the root documents
	maxSitemapDocuments     = 64
	maxSitemapDocBytes      = 50 << 20
	maxSitemapTotalBytes    = 64 << 20
	maxSitemapEntriesPerDoc = 50000
)

// Sitemaps discovers URLs from robots.txt "Sitemap:" lines and /sitemap.xml
// for an origin, following sitemap indexes (depth<=3), supporting gzip, bounded
// by maxURLs and maxBytes. Returns normalised URLs (callers still apply Scope).
// Uses the same Fetcher (so SSRF/robots/pacing apply).
//
// Behaviour: origin may be any URL on the origin (only scheme/host/port are
// used). maxURLs <= 0 means DefaultSitemapMaxURLs. Byte bounds are fixed: 50
// MiB per decoded document, 64 MiB in total, at most 64 documents. Both
// Content-Encoding gzip and raw .xml.gz bodies are decoded; plain-text
// sitemaps (one URL per line) are accepted. With RespectRobots, sitemap
// documents disallowed by robots.txt are skipped silently. Missing documents
// (404/410) are not errors. Other per-document failures are skipped; an error
// (joined causes) is returned only when documents failed and none succeeded,
// or when ctx ends. Partial URLs are returned alongside any error.
func (f *Fetcher) Sitemaps(ctx context.Context, origin string, maxURLs int) ([]string, error) {
	normalized, err := Normalize(origin)
	if err != nil {
		return nil, err
	}
	root, _ := originOf(normalized)
	if maxURLs <= 0 {
		maxURLs = DefaultSitemapMaxURLs
	}
	w := &sitemapWalk{f: f, maxURLs: maxURLs, queued: map[string]bool{}, seen: map[string]bool{}, out: []string{}}
	entry, err := f.robotsFor(ctx, root)
	if err != nil {
		return nil, err
	}
	if entry.err != nil {
		return nil, entry.err
	}
	if entry.data != nil {
		for _, s := range entry.data.Sitemaps {
			w.enqueue(strings.TrimSpace(s), 0)
		}
	}
	w.enqueue(root+"/sitemap.xml", 0)

	for len(w.queue) > 0 && len(w.out) < maxURLs {
		d := w.queue[0]
		w.queue = w.queue[1:]
		if err := ctx.Err(); err != nil {
			return w.out, err
		}
		if w.total >= maxSitemapTotalBytes {
			w.failures = append(w.failures, fmt.Errorf("sitemap byte budget exhausted"))
			break
		}
		if err := w.visit(ctx, d); err != nil {
			return w.out, err
		}
	}
	if w.succeeded == 0 && len(w.failures) > 0 {
		return w.out, fmt.Errorf("crawl: sitemap discovery failed: %w", errors.Join(w.failures...))
	}
	return w.out, nil
}

// sitemapDoc is a queued sitemap document at an index nesting depth.
type sitemapDoc struct {
	url   string
	depth int
}

// sitemapWalk is one sitemap discovery: the document queue, the URLs found
// and the per-document failures.
type sitemapWalk struct {
	f         *Fetcher
	maxURLs   int
	queue     []sitemapDoc
	queued    map[string]bool
	out       []string
	seen      map[string]bool
	total     int // decoded bytes read
	succeeded int
	failures  []error
}

func (w *sitemapWalk) enqueue(raw string, depth int) {
	n, err := Normalize(raw)
	if err != nil || w.queued[n] || depth > maxSitemapDepth || len(w.queued) >= maxSitemapDocuments {
		return
	}
	w.queued[n] = true
	w.queue = append(w.queue, sitemapDoc{n, depth})
}

// visit reads one sitemap document: an index queues its sitemaps, a urlset
// adds its URLs. Failures are recorded; only a context error is returned.
func (w *sitemapWalk) visit(ctx context.Context, d sitemapDoc) error {
	body, truncated, ok, err := w.fetch(ctx, d)
	if err != nil || !ok {
		return err
	}
	w.total += len(body)
	index, locs, perr := parseSitemap(body, maxSitemapEntriesPerDoc)
	if perr == nil && truncated {
		perr = fmt.Errorf("sitemap exceeds byte limit")
	}
	if perr != nil {
		w.failures = append(w.failures, fmt.Errorf("%s: %w", d.url, perr))
	} else {
		w.succeeded++
	}
	for _, loc := range locs {
		if index {
			w.enqueue(loc, d.depth+1)
			continue
		}
		n, err := Normalize(loc)
		if err != nil || w.seen[n] {
			continue
		}
		w.seen[n] = true
		w.out = append(w.out, n)
		if len(w.out) >= w.maxURLs {
			break
		}
	}
	return nil
}

// fetch downloads a sitemap document, gunzipping it when needed. ok is false
// when the document is skipped: disallowed by robots.txt, missing, or failed
// (recorded).
func (w *sitemapWalk) fetch(ctx context.Context, d sitemapDoc) (body []byte, truncated, ok bool, err error) {
	f := w.f
	if f.cfg.RespectRobots {
		if err := f.robotsCheck(ctx, d.url); err != nil {
			if !errors.Is(err, ErrRobotsDisallowed) {
				w.failures = append(w.failures, fmt.Errorf("%s: %w", d.url, err))
			}
			return nil, false, false, nil
		}
	}
	limit := int64(min(maxSitemapDocBytes, maxSitemapTotalBytes-w.total))
	h := http.Header{}
	h.Set("Accept", "application/xml, text/xml, application/gzip, text/plain;q=0.8, */*;q=0.1")
	r, err := f.get(ctx, d.url, false, h, limit, nil)
	if err != nil {
		if ctx.Err() != nil {
			return nil, false, false, ctx.Err()
		}
		w.failures = append(w.failures, fmt.Errorf("%s: %w", d.url, err))
		return nil, false, false, nil
	}
	if r.status == http.StatusNotFound || r.status == http.StatusGone {
		return nil, false, false, nil
	}
	if r.status < 200 || r.status >= 300 {
		w.failures = append(w.failures, fmt.Errorf("%s: status %d", d.url, r.status))
		return nil, false, false, nil
	}
	body, truncated = r.body, r.truncated
	if len(body) >= 2 && body[0] == 0x1f && body[1] == 0x8b {
		if body, truncated, err = gunzipBounded(body, limit); err != nil {
			w.failures = append(w.failures, fmt.Errorf("%s: %w", d.url, err))
			return nil, false, false, nil
		}
	}
	return body, truncated, true, nil
}

func gunzipBounded(body []byte, limit int64) ([]byte, bool, error) {
	gz, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, false, fmt.Errorf("invalid gzip: %w", err)
	}
	defer gz.Close()
	out, err := io.ReadAll(io.LimitReader(gz, limit+1))
	truncated := int64(len(out)) > limit
	if truncated {
		out = out[:limit]
	} else if err != nil {
		return nil, false, fmt.Errorf("invalid gzip: %w", err)
	}
	return out, truncated, nil
}

// parseSitemap returns whether body is a sitemap index and its <loc> values
// (at most maxEntries). XML directives (DOCTYPE/entities) are refused. Invalid
// XML returns the locations read so far plus an error. A body that does not
// start with '<' is treated as a plain-text sitemap.
func parseSitemap(body []byte, maxEntries int) (bool, []string, error) {
	trimmed := bytes.TrimLeft(bytes.TrimPrefix(body, []byte("\xef\xbb\xbf")), " \t\r\n")
	if len(trimmed) > 0 && trimmed[0] != '<' {
		locs, err := parseTextSitemap(trimmed, maxEntries)
		return false, locs, err
	}
	dec := xml.NewDecoder(bytes.NewReader(body))
	p := &sitemapParser{maxEntries: maxEntries}
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return p.index(), p.locs, fmt.Errorf("invalid sitemap: %w", err)
		}
		if done, err := p.token(tok); done || err != nil {
			return p.index(), p.locs, err
		}
	}
	if p.root == "" || !p.closed {
		return p.index(), p.locs, fmt.Errorf("invalid sitemap: missing or unclosed root element")
	}
	return p.index(), p.locs, nil
}

// parseTextSitemap reads a plain-text sitemap: one http(s) URL per line.
func parseTextSitemap(body []byte, maxEntries int) ([]string, error) {
	var locs []string
	sc := bufio.NewScanner(bytes.NewReader(body))
	sc.Buffer(make([]byte, 0, 64<<10), maxURLBytes+2)
	for sc.Scan() && len(locs) < maxEntries {
		line := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(line, "http://") || strings.HasPrefix(line, "https://") {
			locs = append(locs, line)
		}
	}
	return locs, sc.Err()
}

// sitemapParser reads the <loc> values of a <urlset> (url/loc) or a
// <sitemapindex> (sitemap/loc) from XML tokens.
type sitemapParser struct {
	maxEntries int
	stack      []string
	root       string
	locs       []string
	text       strings.Builder
	inLoc      bool
	closed     bool
}

func (p *sitemapParser) index() bool { return p.root == "sitemapindex" }

// reject discards everything read: the document is not a sitemap.
func (p *sitemapParser) reject(err error) error {
	p.root, p.locs = "", nil
	return err
}

// token handles one XML token. done reports that maxEntries was reached.
func (p *sitemapParser) token(tok xml.Token) (done bool, err error) {
	switch t := tok.(type) {
	case xml.Directive:
		return false, p.reject(fmt.Errorf("invalid sitemap: XML directives are not supported"))
	case xml.StartElement:
		return false, p.start(t)
	case xml.CharData:
		if p.inLoc {
			if p.text.Len()+len(t) > maxURLBytes {
				return false, fmt.Errorf("invalid sitemap: location too long")
			}
			p.text.Write(t)
		}
	case xml.EndElement:
		return p.end(), nil
	}
	return false, nil
}

func (p *sitemapParser) start(t xml.StartElement) error {
	if len(p.stack) == 0 {
		if p.root != "" || p.closed {
			return fmt.Errorf("invalid sitemap: multiple root elements")
		}
		p.root = t.Name.Local
		if p.root != "urlset" && p.root != "sitemapindex" {
			return p.reject(fmt.Errorf("invalid sitemap: root <%s>", t.Name.Local))
		}
	}
	p.stack = append(p.stack, t.Name.Local)
	if len(p.stack) > 32 {
		return fmt.Errorf("invalid sitemap: XML depth limit exceeded")
	}
	if len(p.stack) == 3 && t.Name.Local == "loc" &&
		((p.root == "urlset" && p.stack[1] == "url") || (p.root == "sitemapindex" && p.stack[1] == "sitemap")) {
		p.inLoc = true
		p.text.Reset()
	}
	return nil
}

// end closes an element and reports whether maxEntries was reached.
func (p *sitemapParser) end() bool {
	if len(p.stack) == 3 && p.inLoc {
		p.locs = append(p.locs, strings.TrimSpace(p.text.String()))
		p.inLoc = false
		if len(p.locs) >= p.maxEntries {
			return true
		}
	}
	p.stack = p.stack[:len(p.stack)-1]
	if len(p.stack) == 0 {
		p.closed = true
	}
	return false
}
