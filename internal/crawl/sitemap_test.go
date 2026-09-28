package crawl

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func gz(t *testing.T, s string) []byte {
	t.Helper()
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	if _, err := w.Write([]byte(s)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

type sitemapSite struct {
	*httptest.Server
	mu    sync.Mutex
	hits  []string
	files map[string]func(base string) (ct, enc string, body []byte, status int)
}

func newSitemapSite(t *testing.T) *sitemapSite {
	s := &sitemapSite{files: map[string]func(string) (string, string, []byte, int){}}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.hits = append(s.hits, r.URL.Path)
		h := s.files[r.URL.Path]
		s.mu.Unlock()
		if h == nil {
			http.NotFound(w, r)
			return
		}
		ct, enc, body, status := h(s.URL)
		w.Header().Set("Content-Type", ct)
		if enc != "" {
			w.Header().Set("Content-Encoding", enc)
		}
		w.WriteHeader(status)
		_, _ = w.Write(body)
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *sitemapSite) set(path string, h func(base string) (string, string, []byte, int)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.files[path] = h
}

func xmlDoc(tmpl string) func(string) (string, string, []byte, int) {
	return func(base string) (string, string, []byte, int) {
		return "application/xml", "", []byte(strings.ReplaceAll(tmpl, "BASE", base)), 200
	}
}

func TestSitemapsRobotsIndexGzip(t *testing.T) {
	site := newSitemapSite(t)
	site.set("/robots.txt", func(base string) (string, string, []byte, int) {
		return "text/plain", "", []byte("User-agent: *\nDisallow: /blocked\nSitemap: " + base + "/index.xml\n"), 200
	})
	site.set("/index.xml", xmlDoc(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>BASE/pages.xml.gz</loc></sitemap>
<sitemap><loc>BASE/encoded.xml</loc></sitemap>
<sitemap><loc>BASE/blocked/map.xml</loc></sitemap>
<sitemap><loc>BASE/index.xml</loc></sitemap>
</sitemapindex>`))
	site.set("/pages.xml.gz", func(base string) (string, string, []byte, int) {
		return "application/x-gzip", "", gz(t, strings.ReplaceAll(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>BASE/A?b=2&amp;a=1&amp;utm_source=x</loc></url><url><loc> BASE/B#frag </loc></url><url><loc>BASE/A?a=1&amp;b=2</loc></url>
<url><loc>not a url</loc></url></urlset>`, "BASE", base)), 200
	})
	site.set("/encoded.xml", func(base string) (string, string, []byte, int) {
		return "text/xml", "gzip", gz(t, "<urlset><url><loc>"+base+"/C</loc></url></urlset>"), 200
	})
	site.set("/blocked/map.xml", xmlDoc(`<urlset><url><loc>BASE/secret</loc></url></urlset>`))
	site.set("/sitemap.xml", xmlDoc(`<urlset><url><loc>BASE/D</loc></url><url><loc>https://elsewhere.example/E</loc></url></urlset>`))

	f := privateFetcher(FetcherConfig{RespectRobots: true})
	urls, err := f.Sitemaps(context.Background(), site.URL+"/some/page", 0)
	if err != nil {
		t.Fatal(err)
	}
	b := site.URL
	// Breadth-first: robots-listed index, /sitemap.xml, then the index children.
	want := []string{b + "/D", "https://elsewhere.example/E", b + "/A?a=1&b=2", b + "/B", b + "/C"}
	if !reflect.DeepEqual(urls, want) {
		t.Fatalf("urls:\n got %q\nwant %q", urls, want)
	}
	site.mu.Lock()
	hits := append([]string(nil), site.hits...)
	site.mu.Unlock()
	for _, h := range hits {
		if h == "/blocked/map.xml" {
			t.Fatal("robots-disallowed sitemap fetched")
		}
	}
	if strings.Count(strings.Join(hits, ","), "/robots.txt") != 1 || strings.Count(strings.Join(hits, ","), "/index.xml") != 1 {
		t.Fatalf("robots/index fetched more than once: %v", hits)
	}

	// maxURLs bounds output and stops fetching further documents.
	g := privateFetcher(FetcherConfig{RespectRobots: true})
	urls, err = g.Sitemaps(context.Background(), site.URL, 2)
	if err != nil || !reflect.DeepEqual(urls, want[:2]) {
		t.Fatalf("maxURLs: %q %v", urls, err)
	}
}

func TestSitemapsDepthCycleAndMissing(t *testing.T) {
	site := newSitemapSite(t)
	// /sitemap.xml -> map1 -> map2 -> map3 -> map4 (depth 4, not fetched).
	site.set("/sitemap.xml", xmlDoc(`<sitemapindex><sitemap><loc>BASE/map1.xml</loc></sitemap><sitemap><loc>BASE/sitemap.xml</loc></sitemap></sitemapindex>`))
	for i := 1; i <= 4; i++ {
		site.set(fmt.Sprintf("/map%d.xml", i), xmlDoc(fmt.Sprintf(`<sitemapindex><sitemap><loc>BASE/map%d.xml</loc></sitemap></sitemapindex>`, i+1)))
	}
	f := privateFetcher(FetcherConfig{})
	urls, err := f.Sitemaps(context.Background(), site.URL, 100)
	if err != nil || len(urls) != 0 {
		t.Fatalf("%q %v", urls, err)
	}
	site.mu.Lock()
	got := strings.Join(site.hits, ",")
	site.mu.Unlock()
	if got != "/robots.txt,/sitemap.xml,/map1.xml,/map2.xml,/map3.xml" {
		t.Fatalf("fetch order %s", got)
	}
	// Nothing at all: no error, no URLs.
	empty := newSitemapSite(t)
	if urls, err := privateFetcher(FetcherConfig{}).Sitemaps(context.Background(), empty.URL, 10); err != nil || len(urls) != 0 {
		t.Fatalf("missing: %q %v", urls, err)
	}
}

func TestSitemapsErrors(t *testing.T) {
	site := newSitemapSite(t)
	site.set("/sitemap.xml", func(string) (string, string, []byte, int) { return "text/plain", "", nil, 500 })
	if _, err := privateFetcher(FetcherConfig{}).Sitemaps(context.Background(), site.URL, 10); err == nil {
		t.Fatal("all-failed discovery returned no error")
	}
	// One broken document among good ones is tolerated.
	site.set("/robots.txt", func(base string) (string, string, []byte, int) {
		return "text/plain", "", []byte("Sitemap: " + base + "/good.xml\n"), 200
	})
	site.set("/good.xml", xmlDoc(`<urlset><url><loc>BASE/ok</loc></url></urlset>`))
	urls, err := privateFetcher(FetcherConfig{}).Sitemaps(context.Background(), site.URL, 10)
	if err != nil || len(urls) != 1 {
		t.Fatalf("partial: %q %v", urls, err)
	}
	// SSRF and host policy apply to sitemap fetching.
	if _, err := NewFetcher(FetcherConfig{}).Sitemaps(context.Background(), "http://127.0.0.1/", 10); !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("ssrf: %v", err)
	}
	deny := hostPolicyFunc(func(string) bool { return false })
	if _, err := privateFetcher(FetcherConfig{HostPolicy: deny}).Sitemaps(context.Background(), site.URL, 10); !errors.Is(err, ErrHostNotAllowed) {
		t.Fatalf("policy: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := privateFetcher(FetcherConfig{}).Sitemaps(ctx, site.URL, 10); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
}

func TestParseSitemap(t *testing.T) {
	index, locs, err := parseSitemap([]byte("\xef\xbb\xbfhttps://a.example/1\n\n# c\nhttps://a.example/2\r\n"), 10)
	if err != nil || index || !reflect.DeepEqual(locs, []string{"https://a.example/1", "https://a.example/2"}) {
		t.Fatalf("text sitemap: %v %q %v", index, locs, err)
	}
	_, locs, err = parseSitemap([]byte(`<urlset><url><loc>https://a/1</loc></url><url><loc>https://a/2</loc></url><url><loc>https://a/3</loc></url></urlset>`), 2)
	if err != nil || len(locs) != 2 {
		t.Fatalf("entry cap: %q %v", locs, err)
	}
	// Ported from yoink: invalid or hostile documents are rejected.
	for _, body := range []string{
		`<!DOCTYPE urlset [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset><url><loc>&x;</loc></url></urlset>`,
		`<html/>`, `<urlset>`, `<urlset/><urlset/>`,
		`<urlset><url><loc>https://example.com/` + strings.Repeat("x", 8192) + `</loc></url></urlset>`,
	} {
		if _, _, err := parseSitemap([]byte(body), 100); err == nil {
			t.Errorf("accepted invalid sitemap %.40q", body)
		}
	}
}
