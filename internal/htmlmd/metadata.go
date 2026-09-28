package htmlmd

import (
	"strings"

	"github.com/PuerkitoBio/goquery"
)

const (
	metadataStringLimit = 2048
	languageLimit       = 64
)

// limitUTF8 truncates s to at most limit bytes without splitting a rune.
func limitUTF8(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	n := limit
	for n > 0 && s[n]&0xc0 == 0x80 {
		n--
	}
	return s[:n]
}

// extractHeadMetadata reads title, description and language before any
// pruning. Values are data, never trusted HTML, and are bounded.
func extractHeadMetadata(doc *goquery.Document, res *Result) {
	bounded := func(s string) string { return limitUTF8(cleanSpace(s), metadataStringLimit) }

	// SVG <title> elements are tooltips, not document titles.
	title := doc.Find("title").FilterFunction(func(_ int, s *goquery.Selection) bool {
		return s.ParentsFiltered("svg, math").Length() == 0
	}).First()
	res.Title = bounded(title.Text())

	meta := map[string]string{}
	doc.Find("meta[content]").Each(func(_ int, s *goquery.Selection) {
		key, _ := s.Attr("property")
		if key == "" {
			key, _ = s.Attr("name")
		}
		if key == "" {
			key, _ = s.Attr("http-equiv")
		}
		key = strings.ToLower(strings.TrimSpace(key))
		if key == "" {
			return
		}
		if _, exists := meta[key]; exists {
			return
		}
		value, _ := s.Attr("content")
		if value = bounded(value); value != "" {
			meta[key] = value
		}
	})
	first := func(keys ...string) string {
		for _, k := range keys {
			if v := meta[k]; v != "" {
				return v
			}
		}
		return ""
	}
	if res.Title == "" {
		res.Title = first("og:title", "twitter:title", "dc:title")
	}
	res.Description = first("description", "og:description", "twitter:description", "dc:description")

	html := doc.Find("html").First()
	lang, _ := html.Attr("lang")
	if strings.TrimSpace(lang) == "" {
		lang, _ = html.Attr("xml:lang")
	}
	if strings.TrimSpace(lang) == "" {
		lang = first("content-language", "dc:language", "language")
	}
	// Content-Language may list several tags; the first is the primary one.
	lang, _, _ = strings.Cut(lang, ",")
	res.Language = limitUTF8(strings.ToLower(cleanSpace(lang)), languageLimit)
}
