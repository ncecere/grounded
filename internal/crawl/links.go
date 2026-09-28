package crawl

import (
	"bytes"
	"net/url"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// maxLinksPerPage bounds Links output on pathological pages.
const maxLinksPerPage = 20000

// Links extracts absolute, normalised http(s) links from an HTML page
// (a[href], respecting <base>, rel=nofollow ignored, dedup, order preserved).
//
// Behaviour: links whose rel contains "nofollow" are skipped; if the page has
// <meta name="robots"> containing "nofollow" or "none", no links are returned. The first <base href> wins and is resolved
// against pageURL. Pure-fragment hrefs ("#top") and non-http(s) schemes
// (mailto:, javascript:, ...) are skipped; fragments are stripped by
// Normalize, so "/a#x" and "/a#y" yield one "/a". Output is capped at 20,000
// links. Streaming tokenizer: no DOM is built.
func Links(body []byte, pageURL string) []string {
	page, err := url.Parse(pageURL)
	if err != nil || (page.Scheme != "http" && page.Scheme != "https") {
		return nil
	}
	lc := &linkCollector{page: page, base: page, out: []string{}, seen: map[string]bool{}}
	z := html.NewTokenizer(bytes.NewReader(body))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			return lc.out
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		name, hasAttr := z.TagName()
		if !hasAttr {
			continue
		}
		attrs := tagAttrs(z)
		switch atom.Lookup(name) {
		case atom.Base:
			lc.setBase(attrs)
		case atom.Meta:
			if robotsNofollow(attrs) {
				return nil
			}
		case atom.A:
			if lc.add(attrs) {
				return lc.out
			}
		}
	}
}

// tagAttrs reads the current tag's attributes; the first of repeated
// attributes wins.
func tagAttrs(z *html.Tokenizer) map[string]string {
	attrs := map[string]string{}
	for {
		k, v, more := z.TagAttr()
		key := string(k)
		if _, dup := attrs[key]; !dup {
			attrs[key] = string(v)
		}
		if !more {
			return attrs
		}
	}
}

// robotsNofollow reports a <meta name="robots"> with nofollow or none.
func robotsNofollow(attrs map[string]string) bool {
	if !strings.EqualFold(strings.TrimSpace(attrs["name"]), "robots") {
		return false
	}
	for _, d := range strings.Split(strings.ToLower(attrs["content"]), ",") {
		if d = strings.TrimSpace(d); d == "nofollow" || d == "none" {
			return true
		}
	}
	return false
}

// linkCollector gathers a page's distinct links.
type linkCollector struct {
	page, base *url.URL
	baseSet    bool
	out        []string
	seen       map[string]bool
}

// setBase applies the first <base href> (resolved against the page).
func (lc *linkCollector) setBase(attrs map[string]string) {
	href, ok := attrs["href"]
	if !ok || lc.baseSet {
		return
	}
	lc.baseSet = true
	if b, err := lc.page.Parse(strings.TrimSpace(href)); err == nil && (b.Scheme == "http" || b.Scheme == "https") {
		lc.base = b
	}
}

// add adds an <a href> link unless it is nofollow, a fragment, not http(s)
// or already seen. It reports whether the cap is reached.
func (lc *linkCollector) add(attrs map[string]string) bool {
	href, ok := attrs["href"]
	if !ok || hasToken(attrs["rel"], "nofollow") {
		return false
	}
	href = strings.TrimSpace(href)
	if href == "" || strings.HasPrefix(href, "#") {
		return false
	}
	ref, err := lc.base.Parse(href)
	if err != nil || (ref.Scheme != "http" && ref.Scheme != "https") {
		return false
	}
	n, err := Normalize(ref.String())
	if err != nil || lc.seen[n] {
		return false
	}
	lc.seen[n] = true
	lc.out = append(lc.out, n)
	return len(lc.out) >= maxLinksPerPage
}

func hasToken(list, token string) bool {
	for _, f := range strings.Fields(strings.ToLower(list)) {
		if f == token {
			return true
		}
	}
	return false
}
