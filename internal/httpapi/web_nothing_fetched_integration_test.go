package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/config"
)

// A crawl that fetched nothing says why (QA pass v0.6.0, #114): it used to finish "completed" with one page skipped and no reason, and a site whose
// robots.txt could not be reached at all was reported as one whose robots.txt forbids crawling.
func TestCrawlThatFetchedNothingSaysWhy(t *testing.T) {
	env := newWebEnv(t, true)
	owner := env.owner

	run := func(name string, h http.HandlerFunc) (note, reason string, fetched, skipped int32) {
		t.Helper()
		srv := httptest.NewServer(h)
		t.Cleanup(srv.Close)
		src := env.createWeb(t, owner, env.base+"/sources", name, map[string]any{"mode": "scrape", "urls": []string{srv.URL + "/"}})
		c := waitCrawl(t, owner, env.base+"/sources/"+src.Id.String(), src.ActiveCrawl.Id)
		if c.Status != "completed" {
			t.Fatalf("%s: crawl = %+v", name, c)
		}
		for _, row := range frontier(t, env.app, c.Id) {
			reason = row[1]
		}
		return c.Error, reason, c.PagesFetched, c.PagesSkipped
	}
	page := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write(htmlPage("Hello", `<p>Hello there, this page is fine.</p>`))
	}

	// robots.txt forbids everything.
	note, reason, fetched, skipped := run("robots says no", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/robots.txt" {
			_, _ = w.Write([]byte("User-agent: *\nDisallow: /\n"))
			return
		}
		page(w, r)
	})
	if fetched != 0 || skipped != 1 || reason != "robots_disallowed" {
		t.Fatalf("robots: fetched %d skipped %d reason %q", fetched, skipped, reason)
	}
	if !strings.Contains(note, "Nothing was fetched") || !strings.Contains(note, "robots.txt doesn't allow") {
		t.Errorf("a site that forbids crawling: note %q", note)
	}

	// robots.txt cannot be reached: the connection drops. That is not the site saying no.
	note, reason, fetched, _ = run("robots unreachable", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/robots.txt" {
			panic(http.ErrAbortHandler) // closes the connection without an answer
		}
		page(w, r)
	})
	if fetched != 0 || reason != "robots_unreachable" {
		t.Fatalf("unreachable robots: fetched %d reason %q, want robots_unreachable", fetched, reason)
	}
	if !strings.Contains(note, "Nothing was fetched") || !strings.Contains(note, "couldn't be reached") || strings.Contains(note, "doesn't allow") {
		t.Errorf("a site whose robots.txt cannot be reached: note %q", note)
	}

	// Control: a crawl that fetched a page and skipped another (nothing failed) has no note: skipping some pages is not a problem.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/robots.txt":
			_, _ = w.Write([]byte("User-agent: *\nDisallow: /private/\n"))
		case "/":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(`<html><head><title>Home</title></head><body><main><h1>Home</h1><p>Welcome to the home page of this small site.</p><a href="/private/x">staff</a></main></body></html>`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	some := env.createWeb(t, owner, env.base+"/sources", "some skipped", map[string]any{"mode": "crawl", "urls": []string{srv.URL + "/"}, "maxDepth": 1, "useSitemaps": false})
	sc := waitCrawl(t, owner, env.base+"/sources/"+some.Id.String(), some.ActiveCrawl.Id)
	if sc.PagesFetched != 1 || sc.PagesSkipped != 1 || sc.PagesFailed != 0 || sc.Error != "" {
		t.Errorf("a crawl that fetched one page and skipped one: fetched %d skipped %d failed %d note %q, want 1, 1, 0 and no note", sc.PagesFetched, sc.PagesSkipped, sc.PagesFailed, sc.Error)
	}

	// Control: a crawl that fetched pages has no note, whatever it skipped.
	site := env.site
	src := env.createWeb(t, owner, env.base+"/sources", "Registrar site", map[string]any{"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 1})
	c := waitCrawl(t, owner, env.base+"/sources/"+src.Id.String(), src.ActiveCrawl.Id)
	if c.PagesFetched == 0 || c.PagesSkipped == 0 || c.Error != "" {
		t.Errorf("a crawl that fetched pages: fetched %d skipped %d note %q, want pages fetched, some skipped and no note", c.PagesFetched, c.PagesSkipped, c.Error)
	}
}

// An address the crawler never fetches is refused as that, not as a host to ask an admin for: a domain request for 127.0.0.1 can never be
// approved (QA pass v0.6.0, #114). An ordinary host that is simply not on the allowlist still gets the invitation.
func TestSourceAtAnAddressTheCrawlerNeverFetchesIsRefusedAsThat(t *testing.T) {
	env := newWebEnvWith(t, false, func(c *config.Config) { c.Crawl.AllowPrivateAddressesForTests = false })
	create := func(url string) (int, string, string) {
		var out struct {
			Error struct{ Code, Message string }
		}
		raw, _ := json.Marshal(map[string]any{"name": "s", "type": "web", "classification": "open", "web": map[string]any{"mode": "scrape", "urls": []string{url}}})
		code, body := env.owner.raw("POST", env.base+"/sources", json.RawMessage(raw), nil)
		_ = json.Unmarshal(body, &out)
		return code, out.Error.Code, out.Error.Message
	}
	for _, url := range []string{"http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/latest/", "http://[::1]/", "http://0x7f.0.0.1/"} {
		code, errCode, msg := create(url)
		if code != 400 || errCode != "blocked_address" {
			t.Errorf("%s: %d %s (%s), want 400 blocked_address", url, code, errCode, msg)
		}
		if strings.Contains(msg, "request it") || strings.Contains(msg, "Domain requests") {
			t.Errorf("%s: the message invites a request that cannot succeed: %q", url, msg)
		}
	}
	code, errCode, msg := create("http://www.example.org/")
	if code != 400 || errCode != "host_not_allowed" || !strings.Contains(msg, "Domain requests") {
		t.Errorf("an ordinary host that is not on the allowlist: %d %s %q, want 400 host_not_allowed inviting a request", code, errCode, msg)
	}
}
