package httpapi_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/config"
)

// #132, "a crawl that looks hung": a go.dev crawl sat at "Running" while "skipped" climbed by about one a second. go.dev/dl
// links to some 2,500 downloads (.tar.gz, .zip, .msi, .pkg), and each was fetched, spaced by CRAWL_ORIGIN_INTERVAL (1 s
// per site), only to learn from the answer (an octet-stream body or a redirect off the allowlist) that it would be skipped.
// A link to a file no page can be made of is now skipped without a request.
func TestCrawlSkipsDownloadLinksWithoutFetchingThem(t *testing.T) {
	const interval = 250 * time.Millisecond
	env := newWebEnvWith(t, true, func(c *config.Config) { c.Crawl.OriginInterval = interval })
	owner, site := env.owner, env.site
	port := site.srv.URL[strings.LastIndex(site.srv.URL, ":")+1:]

	var links, downloads []string
	for i := range 12 {
		for _, name := range []string{
			fmt.Sprintf("go1.%d.linux-amd64.tar.gz", i), fmt.Sprintf("go1.%d.windows-amd64.zip", i), fmt.Sprintf("go1.%d.darwin-arm64.pkg", i),
		} {
			p := "/dl/" + name
			downloads = append(downloads, p)
			links = append(links, fmt.Sprintf(`<li><a href="%s">%s</a></li>`, p, name))
			if strings.HasSuffix(name, ".pkg") { // like go.dev: a redirect to a host the crawl may not use
				site.redirects[p] = "http://localhost:" + port + "/partner"
			} else {
				site.pages[p] = sitePage{body: append([]byte("PK\x03\x04"), make([]byte, 64<<10)...), contentType: "application/octet-stream", etag: `"dl"`}
			}
		}
	}
	site.set("/downloads", htmlPage("Downloads | Test Registrar", `<h1>Downloads</h1><p>The registrar's offline forms, as downloads and as pages.</p><ul>`+strings.Join(links, "")+
		`<li><a href="/about">About the office</a></li></ul>`))

	src := env.createWeb(t, owner, env.base+"/sources", "Downloads", map[string]any{
		"mode": "crawl", "urls": []string{site.url("/downloads")}, "maxDepth": 1, "useSitemaps": false,
	})
	start := time.Now()
	run := waitCrawl(t, owner, env.base+"/sources/"+src.Id.String(), src.ActiveCrawl.Id)
	elapsed := time.Since(start)
	t.Logf("crawl took %v; %d pages fetched, %d skipped", elapsed, run.PagesFetched, run.PagesSkipped)

	if run.Status != "completed" || run.PagesSkipped != int32(len(downloads)) {
		t.Fatalf("crawl = %+v, want completed with %d skipped", run, len(downloads))
	}
	fr := frontier(t, env.app, run.Id)
	for _, p := range downloads {
		if hits, _ := site.count(p); hits != 0 {
			t.Errorf("%s was requested %d times; a download link is skipped without a request", p, hits)
		}
		if got := fr[site.url(p)]; got != [2]string{"skipped", "unsupported_content"} {
			t.Errorf("frontier %s = %v, want skipped unsupported_content", p, got)
		}
	}
	// What can be read is still read, and the skipped links did not hold the crawl up at one request per interval.
	if got := fr[site.url("/about")]; got != [2]string{"done", ""} {
		t.Errorf("frontier /about = %v", got)
	}
	if limit := time.Duration(len(downloads)) * interval / 2; elapsed > limit {
		t.Errorf("the crawl took %v for %d skipped links, more than %v: they are still waiting for the pacer", elapsed, len(downloads), limit)
	}
}
