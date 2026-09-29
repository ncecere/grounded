// Package htmlmd converts HTML documents into clean, chunkable Markdown.
//
// The extraction pipeline is a standalone port of yoink's HTTP extractor: the
// DOM is parsed with a charset-aware reader, active and non-content elements
// are removed, main content is optionally selected with yoink's semantic and
// heuristic scoring, and the result is rendered as normalised Markdown with
// headings, lists, pipe tables, fenced code, links and images. Head metadata
// (title, description and language) is extracted before any pruning.
//
// The package performs no network access. Links are resolved against an
// optional base URL but never fetched.
package htmlmd

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/PuerkitoBio/goquery"
	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/charset"
	"golang.org/x/text/transform"
)

// DefaultMaxInputBytes is the input bound used when Options.MaxInputBytes is 0.
const DefaultMaxInputBytes = 20 << 20

const (
	// maxURLBytes bounds a single resolved link or image URL.
	maxURLBytes = 8192
	// minOutputLimit is the smallest rendered-Markdown budget. The effective
	// budget is four times the input limit so legitimate expansion (absolute
	// links, table padding) fits while pathological expansion is refused.
	minOutputLimit = 1 << 20
)

// Options control conversion.
type Options struct {
	// BaseURL resolves relative links; nil keeps links as written.
	BaseURL *url.URL
	// MainContentOnly drops navigation, headers, footers, sidebars and other
	// boilerplate using yoink's main-content selection. Use true for web
	// pages; false for converted documents (e.g. Tika XHTML) where everything matters.
	MainContentOnly bool
	// MaxInputBytes bounds the HTML parsed (0 = 20 MiB default). Larger input returns ErrTooLarge.
	MaxInputBytes int
}

// Result of a conversion.
type Result struct {
	Title       string   // <title> or og:title, cleaned; "" if none
	Description string   // meta description / og:description; "" if none
	Language    string   // <html lang>, lower-case; "" if none
	Markdown    string   // normalised Markdown, trailing newline, no leading/trailing blank lines
	Links       []string // absolute http(s) links found in the selected content (deduplicated, in order) when BaseURL != nil; otherwise raw hrefs
}

// ErrTooLarge is returned when the input exceeds Options.MaxInputBytes or the
// rendered Markdown would expand beyond the derived output budget.
var ErrTooLarge = errors.New("htmlmd: input too large")

// removedSelector lists elements that are never content: active content,
// embedded documents, form controls, and explicitly hidden nodes. Unlike
// yoink, <form> itself is kept because some CMSs (e.g. ASP.NET WebForms) wrap
// the entire page in one.
const removedSelector = "script, style, noscript, template, iframe, frame, frameset, object, embed, " +
	"svg, math, canvas, input, button, select, option, datalist, textarea, link, meta, base, title, " +
	"[hidden], [aria-hidden='true']"

// Convert parses HTML and renders Markdown.
func Convert(html []byte, opts Options) (Result, error) {
	limit := opts.MaxInputBytes
	if limit <= 0 {
		limit = DefaultMaxInputBytes
	}
	if len(html) > limit {
		return Result{}, ErrTooLarge
	}
	// The charset reader keeps a UTF-8 byte-order mark as text; drop it.
	html = bytes.TrimPrefix(html, []byte("\xef\xbb\xbf"))
	if len(bytes.TrimSpace(html)) == 0 {
		return Result{}, nil
	}
	doc, err := goquery.NewDocumentFromReader(decoded(html))
	if err != nil {
		return Result{}, fmt.Errorf("htmlmd: parse HTML: %w", err)
	}

	base := effectiveBase(doc, opts.BaseURL)
	res := Result{}
	extractHeadMetadata(doc, &res)

	body := doc.Find("body").First()
	if body.Length() == 0 {
		return res, nil
	}
	adoptOuterPageMarkers(body.Nodes[0])
	body.Find(removedSelector).Remove()
	root := body
	if opts.MainContentOnly {
		root = selectMain(root)
	}
	res.Links = collectLinks(root, base)

	outLimit := max(4*limit, minOutputLimit)
	md, truncated := renderMarkdown(root.Nodes, base, outLimit)
	if truncated {
		return Result{}, fmt.Errorf("%w: rendered Markdown exceeds %d bytes", ErrTooLarge, outLimit)
	}
	if md != "" {
		md += "\n"
	}
	res.Markdown = md
	return res, nil
}

// effectiveBase honours a document <base href> only when a BaseURL was given;
// without one, links are kept exactly as written.
func effectiveBase(doc *goquery.Document, opt *url.URL) *url.URL {
	if opt == nil || !isHTTPURL(opt) {
		return nil
	}
	base := *opt
	if href, ok := doc.Find("base[href]").First().Attr("href"); ok {
		if u, err := url.Parse(strings.TrimSpace(href)); err == nil {
			if r := base.ResolveReference(u); isHTTPURL(r) {
				return r
			}
		}
	}
	return &base
}

func isHTTPURL(u *url.URL) bool {
	s := strings.ToLower(u.Scheme)
	return (s == "http" || s == "https") && u.Host != "" && u.Opaque == ""
}

// resolveLink returns the Markdown destination for raw. With a base, only
// absolute HTTP(S) URLs without credentials survive (fragments are kept). With
// no base, relative references are kept as written and absolute references
// must still be HTTP(S); javascript:, data:, mailto: and similar are dropped.
func resolveLink(base *url.URL, raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxURLBytes {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	if base != nil {
		u = base.ResolveReference(u)
	}
	if u.Scheme == "" && u.Opaque == "" {
		if base != nil {
			return "", false
		}
		// Relative reference kept as written; only escape characters that
		// would break an angle-bracket Markdown destination.
		return destinationEscaper.Replace(raw), true
	}
	u.Scheme = strings.ToLower(u.Scheme)
	if (u.Scheme != "http" && u.Scheme != "https") || u.Opaque != "" || u.Host == "" || u.User != nil {
		return "", false
	}
	u.Host = strings.ToLower(u.Host)
	if port := u.Port(); (u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443") {
		u.Host = strings.TrimSuffix(u.Host, ":"+port)
	}
	if u.Path == "" {
		u.Path = "/"
	}
	s := u.String()
	if len(s) > maxURLBytes {
		return "", false
	}
	return s, true
}

var destinationEscaper = strings.NewReplacer(" ", "%20", "<", "%3C", ">", "%3E")

// collectLinks returns links in the selected content, deduplicated in document
// order. With a base, fragments are removed so they identify documents;
// fragment-only self references are skipped in both modes.
func collectLinks(root *goquery.Selection, base *url.URL) []string {
	out := []string{}
	seen := map[string]bool{}
	const selector = "a[href], area[href]"
	root.Find(selector).AddSelection(root.Filter(selector)).Each(func(_ int, s *goquery.Selection) {
		raw, _ := s.Attr("href")
		raw = strings.TrimSpace(raw)
		if raw == "" || raw[0] == '#' {
			return
		}
		link, ok := resolveLink(base, raw)
		if !ok {
			return
		}
		if base != nil {
			if i := strings.IndexByte(link, '#'); i >= 0 {
				link = link[:i]
			}
		}
		if !seen[link] {
			seen[link] = true
			out = append(out, link)
		}
	})
	return out
}

// pageMarkerPattern matches the document pipeline's page marker comments.
// "ragd:page" is the legacy form (written before the rename to Grounded) and
// is still accepted; the canonical line is always "grounded:page".
var pageMarkerPattern = regexp.MustCompile(`^(?:grounded|ragd):page ([0-9]{1,10})$`)

// pageMarker reports the canonical marker line for a <!-- grounded:page N -->
// (or legacy <!-- ragd:page N -->) comment.
func pageMarker(n *xhtml.Node) (string, bool) {
	if n.Type != xhtml.CommentNode {
		return "", false
	}
	m := pageMarkerPattern.FindStringSubmatch(strings.TrimSpace(n.Data))
	if m == nil {
		return "", false
	}
	return "<!-- grounded:page " + m[1] + " -->", true
}

// adoptOuterPageMarkers moves page-marker comments that the HTML parser placed
// outside <body> (before <html>, in <head>, or after </body>) into the body so
// fragments such as "<!-- grounded:page 1 --><p>…" keep every marker in order.
func adoptOuterPageMarkers(body *xhtml.Node) {
	htmlNode := body.Parent
	if htmlNode == nil {
		return
	}
	var lead, trail []*xhtml.Node
	collect := func(parent *xhtml.Node, stop *xhtml.Node, into *[]*xhtml.Node) {
		for c := parent.FirstChild; c != nil && c != stop; c = c.NextSibling {
			if _, ok := pageMarker(c); ok {
				*into = append(*into, c)
			}
		}
	}
	if doc := htmlNode.Parent; doc != nil {
		collect(doc, htmlNode, &lead)
	}
	for c := htmlNode.FirstChild; c != nil && c != body; c = c.NextSibling {
		if c.Type == xhtml.ElementNode && c.Data == "head" {
			collect(c, nil, &lead)
		} else if _, ok := pageMarker(c); ok {
			lead = append(lead, c)
		}
	}
	for c := body.NextSibling; c != nil; c = c.NextSibling {
		if _, ok := pageMarker(c); ok {
			trail = append(trail, c)
		}
	}
	if htmlNode.Parent != nil {
		for c := htmlNode.NextSibling; c != nil; c = c.NextSibling {
			if _, ok := pageMarker(c); ok {
				trail = append(trail, c)
			}
		}
	}
	first := body.FirstChild
	for _, c := range lead {
		c.Parent.RemoveChild(c)
		body.InsertBefore(c, first)
	}
	for _, c := range trail {
		c.Parent.RemoveChild(c)
		body.AppendChild(c)
	}
}

func cleanSpace(s string) string { return strings.Join(strings.Fields(s), " ") }

func attr(n *xhtml.Node, key string) string {
	for _, a := range n.Attr {
		if a.Namespace == "" && a.Key == key {
			return a.Val
		}
	}
	return ""
}

// decoded reads html in its character set: a BOM or <meta charset> decides
// (WHATWG sniffing, with no transport content type). The sniffer only looks
// at the first 1,024 bytes and falls back to windows-1252 when they're ASCII,
// which garbled UTF-8 pages whose first non-ASCII text comes later ("’" read
// as "â€™"). So a document that is valid UTF-8 throughout is read as UTF-8
// unless it declares another charset; valid UTF-8 with non-ASCII bytes is
// almost never windows-1252 text.
func decoded(html []byte) io.Reader {
	enc, name, _ := charset.DetermineEncoding(html, "text/html")
	if name == "windows-1252" && utf8.Valid(html) {
		return bytes.NewReader(html)
	}
	return transform.NewReader(bytes.NewReader(html), enc.NewDecoder())
}
