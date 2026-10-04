package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/internal/web"
)

// ---- a small website on 127.0.0.1 ------------------------------------------------

type sitePage struct {
	body        []byte
	contentType string
	etag        string
}

// testSite serves pages with ETags (conditional GETs answer 304), a
// robots.txt with a disallow and a sitemap, redirects and 404s.
type testSite struct {
	t   *testing.T
	srv *httptest.Server

	mu        sync.Mutex
	pages     map[string]sitePage
	redirects map[string]string
	hits      map[string]int
	notMod    map[string]int // 304 responses per path
	sitemap   []string
	delay     time.Duration
}

// navHTML is repeated on every page; main-content extraction must drop it.
const navHTML = `<header><nav><ul><li><a href="/">NavLinkAlpha</a></li><li><a href="/about">NavLinkBravo</a></li>
<li><a href="/admissions/">NavLinkCharlie</a></li></ul></nav></header>`

const footerHTML = `<footer><p>FooterBoilerplate copyright statement for the test registrar.</p></footer>`

func htmlPage(title, main string) []byte {
	return []byte(`<!DOCTYPE html><html><head><title>` + title + `</title></head><body>` + navHTML +
		`<main><article>` + main + `</article></main>` + footerHTML + `</body></html>`)
}

func newTestSite(t *testing.T) *testSite {
	s := &testSite{t: t, pages: map[string]sitePage{}, redirects: map[string]string{}, hits: map[string]int{}, notMod: map[string]int{}}
	s.srv = httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.srv.Close)
	port := s.srv.URL[strings.LastIndex(s.srv.URL, ":")+1:]

	s.set("/", htmlPage("Home | Test Registrar", `<h1>Test Registrar</h1>
<p>Welcome to the registrar. We manage enrollment, transcripts and academic records for every student.</p>
<ul>
<li><a href="/about">About the office</a></li>
<li><a href="/admissions/">Admissions</a></li>
<li><a href="/private/secret">Staff only</a></li>
<li><a href="/events/calendar/2026-09-25">Events calendar</a></li>
<li><a href="/old">Old page</a></li>
<li><a href="/missing">Missing page</a></li>
<li><a href="/guide.pdf">Registration guide (PDF)</a></li>
<li><a href="/offsite">Partner site</a></li>
<li><a href="/deep/1">Deep link</a></li>
<li><a href="mailto:registrar@example.edu">Email us</a></li>
</ul>`))
	s.set("/about", htmlPage("About | Test Registrar", `<h1>About the office</h1>
<p>Office hours are Monday through Friday from eight to five. The office is closed on university holidays.
Students can request official transcripts at the front counter or online.</p>`))
	s.set("/admissions/", htmlPage("Admissions | Test Registrar", `<h1>Admissions</h1>
<p>Freshman applications open in August. Transfer students apply through the transfer portal.</p>
<p><a href="/admissions/apply">How to apply</a></p>`))
	s.set("/admissions/apply", htmlPage("Apply | Test Registrar", `<h1>How to apply</h1>
<p>Submit the application form with your high school transcript and a nonrefundable application fee.</p>`))
	s.set("/new", htmlPage("New Page | Test Registrar", `<h1>Relocated content</h1>
<p>This page replaced the old page. Graduation clearance forms are processed within ten business days.</p>`))
	s.set("/sitemap-only", htmlPage("Sitemap Only | Test Registrar", `<h1>Residency reclassification</h1>
<p>Residency reclassification petitions require documentation of twelve months of in-state domicile.</p>`))
	s.set("/private/secret", htmlPage("Secret", `<p>Staff only content that robots.txt disallows.</p>`))
	s.set("/events/calendar/2026-09-25", htmlPage("Calendar", `<p>An endless calendar.</p>`))
	s.set("/deep/1", htmlPage("Deep 1", `<h1>Deep one</h1><p>Level one of the deep chain, about course scheduling.</p><a href="/deep/2">next</a>`))
	s.set("/deep/2", htmlPage("Deep 2", `<h1>Deep two</h1><p>Level two of the deep chain, about course waitlists.</p><a href="/deep/3">next</a>`))
	s.set("/deep/3", htmlPage("Deep 3", `<h1>Deep three</h1><p>Level three of the deep chain, about course overrides.</p>`))
	s.pages["/guide.pdf"] = sitePage{body: simplePDF(t, "Registration Guide", "Register for classes during your assigned registration window."), contentType: "application/pdf", etag: `"pdf1"`}
	s.redirects["/old"] = "/new"
	s.redirects["/offsite"] = "http://localhost:" + port + "/partner"
	s.sitemap = []string{s.url("/"), s.url("/about"), s.url("/sitemap-only")}
	return s
}

func (s *testSite) url(path string) string { return s.srv.URL + path }

func (s *testSite) set(path string, body []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pages[path] = sitePage{body: body, contentType: "text/html; charset=utf-8", etag: fmt.Sprintf(`"%x"`, len(body)*31+len(path))}
}

func (s *testSite) remove(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.pages, path)
}

func (s *testSite) setDelay(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.delay = d
}

func (s *testSite) count(path string) (hits, notModified int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits[path], s.notMod[path]
}

func (s *testSite) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.hits[r.URL.Path]++
	delay := s.delay
	page, ok := s.pages[r.URL.Path]
	target, redirect := s.redirects[r.URL.Path]
	sitemap := append([]string{}, s.sitemap...)
	if ok && page.etag != "" && r.Header.Get("If-None-Match") == page.etag {
		s.notMod[r.URL.Path]++
	}
	s.mu.Unlock()
	if delay > 0 && r.URL.Path != "/robots.txt" && r.URL.Path != "/sitemap.xml" {
		time.Sleep(delay)
	}
	switch {
	case r.URL.Path == "/robots.txt":
		fmt.Fprintf(w, "User-agent: *\nDisallow: /private/\n\nSitemap: %s/sitemap.xml\n", s.srv.URL)
	case r.URL.Path == "/sitemap.xml":
		w.Header().Set("Content-Type", "application/xml")
		var b strings.Builder
		b.WriteString(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`)
		for _, u := range sitemap {
			b.WriteString("<url><loc>" + u + "</loc></url>")
		}
		b.WriteString("</urlset>")
		_, _ = w.Write([]byte(b.String()))
	case redirect:
		http.Redirect(w, r, target, http.StatusMovedPermanently)
	case !ok:
		http.NotFound(w, r)
	default:
		w.Header().Set("ETag", page.etag)
		if r.Header.Get("If-None-Match") == page.etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", page.contentType)
		_, _ = w.Write(page.body)
	}
}

// simplePDF builds a one-page PDF with a title line and a body line.
func simplePDF(t *testing.T, title, body string) []byte {
	t.Helper()
	content := fmt.Sprintf("BT /F1 20 Tf 72 700 Td (%s) Tj ET\nBT /F1 11 Tf 72 670 Td (%s) Tj ET\n", title, body)
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(content), content),
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return b.Bytes()
}

// ---- helpers ---------------------------------------------------------------------

// webTestConfig lets the crawler reach httptest servers and paces lightly.
func webTestConfig(c *config.Config) {
	c.Crawl.AllowPrivateAddressesForTests = true
	c.Crawl.OriginInterval = time.Millisecond
}

type webEnv struct {
	*ragEnv
	site *testSite
	base string // team base path
}

func newWebEnv(t *testing.T, allowLoopback bool) *webEnv { return newWebEnvWith(t, allowLoopback, nil) }

// newWebEnvWith also applies mutate to the configuration.
func newWebEnvWith(t *testing.T, allowLoopback bool, mutate func(*config.Config)) *webEnv {
	env := &webEnv{ragEnv: newRAGEnvWith(t, func(c *config.Config) {
		webTestConfig(c)
		if mutate != nil {
			mutate(c)
		}
	}), site: newTestSite(t)}
	env.base = "/v1/teams/" + env.team
	if allowLoopback {
		code, e := env.admin.call("POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": "127.0.0.1", "note": "httptest"}, nil, nil)
		mustCode(t, "allowlist 127.0.0.1", code, e, 201, "")
	}
	return env
}

// createWeb creates a web source and returns it (with its first crawl).
func (env *webEnv) createWeb(t *testing.T, s *session, path, name string, cfg map[string]any) apitypes.DataSource {
	t.Helper()
	var src apitypes.DataSource
	code, e := s.call("POST", path, map[string]any{"name": name, "type": "web", "classification": "open", "web": cfg}, &src, nil)
	mustCode(t, "create web source "+name, code, e, 201, "")
	if src.ActiveCrawl == nil || src.ActiveCrawl.Trigger != "create" || src.Web == nil {
		t.Fatalf("created source = %+v", src)
	}
	return src
}

// waitCrawl polls a source's crawls until crawlID finishes.
func waitCrawl(t *testing.T, s *session, sourcePath string, crawlID fmt.Stringer) apitypes.Crawl {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for {
		var list []apitypes.Crawl
		if code := s.get(sourcePath+"/crawls?limit=20", &list); code != 200 {
			t.Fatalf("list crawls = %d", code)
		}
		for _, c := range list {
			if c.Id.String() == crawlID.String() && c.Status != "queued" && c.Status != "running" {
				return c
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("crawl %s did not finish: %+v", crawlID, list)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func byURL(docs []apitypes.Document) map[string]apitypes.Document {
	m := map[string]apitypes.Document{}
	for _, d := range docs {
		m[d.Url] = d
	}
	return m
}

func frontier(t *testing.T, app *testApp, crawlID fmt.Stringer) map[string][2]string {
	t.Helper()
	rows, err := app.Pool.Query(context.Background(), `SELECT url, status, reason FROM web_frontier WHERE crawl_id = $1`, crawlID.String())
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string][2]string{}
	for rows.Next() {
		var u, st, reason string
		if err := rows.Scan(&u, &st, &reason); err != nil {
			t.Fatal(err)
		}
		out[u] = [2]string{st, reason}
	}
	return out
}

func auditCount(t *testing.T, app *testApp, action string) int {
	t.Helper()
	var n int
	if err := app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_log WHERE action = $1`, action).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (env *webEnv) retrieve(t *testing.T, s *session, base string, kb fmt.Stringer, q string) []apitypes.RetrieveHit {
	t.Helper()
	var res apitypes.RetrieveResult
	code, e := s.call("POST", base+"/kbs/"+kb.String()+"/retrieve", map[string]any{"query": q}, &res, nil)
	mustCode(t, "retrieve "+q, code, e, 200, "")
	return res.Hits
}

// ---- tests -----------------------------------------------------------------------

func TestWebCrawlSyncAndStalePages(t *testing.T) {
	env := newWebEnv(t, true)
	owner, site := env.owner, env.site
	src := env.createWeb(t, owner, env.base+"/sources", "Registrar site", map[string]any{
		"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 2, "useSitemaps": true,
	})
	srcPath := env.base + "/sources/" + src.Id.String()
	first := waitCrawl(t, owner, srcPath, src.ActiveCrawl.Id)
	if first.Status != "completed" || first.Truncated || first.PagesChanged == 0 || first.PagesSkipped < 2 || first.PagesFailed < 1 {
		t.Fatalf("first crawl = %+v", first)
	}
	docs := byURL(owner.waitForDocuments(t, srcPath+"/documents"))
	for _, p := range []string{"/", "/about", "/admissions/", "/admissions/apply", "/new", "/guide.pdf", "/sitemap-only", "/deep/1", "/deep/2"} {
		d, ok := docs[site.url(p)]
		if !ok || d.Status != "ready" || d.ChunkCount == 0 {
			t.Errorf("%s: %+v (present %v)", p, d, ok)
		}
	}
	for _, p := range []string{"/private/secret", "/events/calendar/2026-09-25", "/old", "/missing", "/offsite", "/deep/3"} {
		if _, ok := docs[site.url(p)]; ok {
			t.Errorf("%s should not be a document", p)
		}
	}
	if d := docs[site.url("/about")]; d.Title != "About | Test Registrar" || d.Kind != "html" {
		t.Errorf("about = %+v", d)
	}
	if d := docs[site.url("/guide.pdf")]; d.Kind != "pdf" || d.Title != "Registration Guide" {
		t.Errorf("pdf = %+v", d)
	}
	// robots.txt, the allowlist (a redirect off it), traps and 404s.
	fr := frontier(t, env.app, first.Id)
	checks := map[string][2]string{
		site.url("/private/secret"): {"skipped", "robots_disallowed"},
		site.url("/offsite"):        {"skipped", "host_not_allowed"},
		site.url("/missing"):        {"failed", "not_found"},
		site.url("/new"):            {"done", ""},
	}
	for u, want := range checks {
		if fr[u] != want {
			t.Errorf("frontier %s = %v, want %v", u, fr[u], want)
		}
	}
	if _, ok := fr[site.url("/events/calendar/2026-09-25")]; ok {
		t.Error("calendar trap entered the frontier")
	}
	if hits, _ := site.count("/events/calendar/2026-09-25"); hits != 0 {
		t.Error("calendar trap was fetched")
	}
	if hits, _ := site.count("/private/secret"); hits != 0 {
		t.Error("robots-disallowed page was fetched")
	}
	if hits, _ := site.count("/partner"); hits != 0 {
		t.Error("off-allowlist redirect target was fetched")
	}

	// Main-content extraction dropped navigation and footers.
	var nav int
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM chunks c JOIN documents d ON d.id = c.document_id
		WHERE d.source_id = $1 AND (c.content LIKE '%NavLink%' OR c.content LIKE '%FooterBoilerplate%')`, src.Id).Scan(&nav)
	if nav != 0 {
		t.Errorf("%d chunks contain navigation or footer text", nav)
	}

	// Searchable in a KB, with citations that link to the pages.
	var kb apitypes.KnowledgeBase
	owner.call("POST", env.base+"/kbs", map[string]any{"name": "Web KB"}, &kb, nil)
	code, e := owner.call("PUT", env.base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, nil, nil)
	mustCode(t, "attach", code, e, 200, "")
	hits := env.retrieve(t, owner, env.base, kb.Id, "office hours Monday Friday")
	if len(hits) == 0 || hits[0].Url != site.url("/about") || !strings.Contains(hits[0].Content, "Office hours") {
		t.Fatalf("hits = %+v", hits)
	}

	// Re-sync: unchanged pages answer 304 to conditional requests.
	var again apitypes.Crawl
	code, e = owner.call("POST", srcPath+"/sync", nil, &again, nil)
	mustCode(t, "sync", code, e, 202, "")
	if again.Trigger != "manual" {
		t.Errorf("trigger = %s", again.Trigger)
	}
	again = waitCrawl(t, owner, srcPath, again.Id)
	if again.Status != "completed" || again.PagesChanged != 0 || again.PagesUnchanged < 8 || again.DocumentsDeleted != 0 {
		t.Fatalf("unchanged re-sync = %+v", again)
	}
	if _, notMod := site.count("/about"); notMod == 0 {
		t.Error("no conditional request for /about")
	}
	var srcNow apitypes.DataSource
	owner.get(srcPath, &srcNow)
	if srcNow.LastSyncAt == nil || srcNow.NextSyncAt != nil || srcNow.ActiveCrawl != nil {
		t.Errorf("after sync: last=%v next=%v active=%v", srcNow.LastSyncAt, srcNow.NextSyncAt, srcNow.ActiveCrawl)
	}

	// A page stored by an older HTML parser is fetched without conditions and
	// stored again, though unchanged (parse.StaleHTML: garbled UTF-8 repair).
	if _, err := env.app.Pool.Exec(context.Background(), `UPDATE documents SET parser = 'builtin:html' WHERE source_id = $1 AND external_id = $2`,
		src.Id, site.url("/about")); err != nil {
		t.Fatal(err)
	}
	var reparse apitypes.Crawl
	code, e = owner.call("POST", srcPath+"/sync", nil, &reparse, nil)
	mustCode(t, "sync", code, e, 202, "")
	if reparse = waitCrawl(t, owner, srcPath, reparse.Id); reparse.Status != "completed" || reparse.PagesChanged != 1 {
		t.Fatalf("re-parse sync = %+v", reparse)
	}
	eventually(t, "the stale page is parsed again", func() bool {
		var parser string
		_ = env.app.Pool.QueryRow(context.Background(), `SELECT parser FROM documents WHERE source_id = $1 AND external_id = $2 AND status = 'ready'`,
			src.Id, site.url("/about")).Scan(&parser)
		return parser == parse.HTMLParser
	})

	// A changed page is re-processed; a removed page is deleted.
	site.set("/about", htmlPage("About | Test Registrar", `<h1>About the office</h1>
<p>The office now opens on Saturday mornings for commencement ticket pickup.</p>`))
	site.remove("/admissions/apply")
	code, e = owner.call("POST", srcPath+"/sync", nil, &again, nil)
	mustCode(t, "sync 3", code, e, 202, "")
	again = waitCrawl(t, owner, srcPath, again.Id)
	if again.PagesChanged != 1 || again.DocumentsDeleted != 1 {
		t.Fatalf("change re-sync = %+v", again)
	}
	var runs int
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT count(DISTINCT crawl_id) FROM web_frontier`).Scan(&runs)
	if runs != 1 {
		t.Errorf("frontiers of %d runs kept, want only the latest", runs)
	}
	var crawled int64
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT coalesce(sum(quantity), 0) FROM usage_events WHERE kind = 'page_crawled' AND source_id = $1`, src.Id).Scan(&crawled)
	if crawled < int64(first.PagesFetched) {
		t.Errorf("page_crawled usage = %d", crawled)
	}
	docs = byURL(owner.waitForDocuments(t, srcPath+"/documents"))
	if d := docs[site.url("/about")]; d.Version != 3 || d.Status != "ready" { // v2 was the re-parse
		t.Errorf("changed page = %+v", d)
	}
	if _, ok := docs[site.url("/admissions/apply")]; ok {
		t.Error("removed page still present")
	}
	if hits := env.retrieve(t, owner, env.base, kb.Id, "Saturday commencement ticket pickup"); len(hits) == 0 || !strings.Contains(hits[0].Content, "Saturday") {
		t.Errorf("new content not found: %+v", hits)
	}

	// One active run per source; cancelling stops it.
	site.setDelay(300 * time.Millisecond)
	code, e = owner.call("POST", srcPath+"/sync", nil, &again, nil)
	mustCode(t, "slow sync", code, e, 202, "")
	code, raw := owner.raw("POST", srcPath+"/sync", nil, nil)
	var conflict struct {
		Error struct {
			Code    string
			Details struct{ Crawl apitypes.Crawl }
		}
	}
	_ = json.Unmarshal(raw, &conflict)
	if code != 409 || conflict.Error.Code != "crawl_in_progress" || conflict.Error.Details.Crawl.Id != again.Id {
		t.Fatalf("second sync = %d %s", code, raw)
	}
	var cancelled apitypes.Crawl
	code, e = owner.call("POST", srcPath+"/crawls/"+again.Id.String()+"/cancel", nil, &cancelled, nil)
	mustCode(t, "cancel", code, e, 200, "")
	if cancelled.Status != "cancelled" || cancelled.Error != "" { // P-07: no "Cancelled" note beside the status
		t.Errorf("cancelled = %+v", cancelled)
	}
	code, e = owner.call("POST", srcPath+"/crawls/"+again.Id.String()+"/cancel", nil, nil, nil)
	mustCode(t, "cancel twice", code, e, 409, "crawl_not_active")
	time.Sleep(700 * time.Millisecond) // the worker notices between pages
	var list []apitypes.Crawl
	owner.get(srcPath+"/crawls", &list)
	if list[0].Id != again.Id || list[0].Status != "cancelled" || list[0].PagesFetched > 3 || list[0].DocumentsDeleted != 0 {
		t.Errorf("cancelled crawl = %+v", list[0])
	}
	// Pausing a web source cancels its active run.
	code, e = owner.call("POST", srcPath+"/sync", nil, &again, nil)
	mustCode(t, "sync before pause", code, e, 202, "")
	owner.get(srcPath, &srcNow)
	code, e = owner.call("PATCH", srcPath, map[string]any{"status": "paused"}, &srcNow, ifMatch(srcNow.Revision))
	mustCode(t, "pause", code, e, 200, "")
	owner.get(srcPath+"/crawls", &list)
	if list[0].Id != again.Id || list[0].Status != "cancelled" || list[0].Error != "The source was paused" || srcNow.ActiveCrawl != nil {
		t.Errorf("crawl after pause = %+v", list[0])
	}
	code, e = owner.call("PATCH", srcPath, map[string]any{"status": "active"}, nil, ifMatch(srcNow.Revision))
	mustCode(t, "resume", code, e, 200, "")
	site.setDelay(0)
	if n := auditCount(t, env.app, "source.sync"); n != 5 {
		t.Errorf("source.sync audits = %d", n)
	}
	if n := auditCount(t, env.app, "source.sync_cancel"); n != 1 {
		t.Errorf("source.sync_cancel audits = %d", n)
	}

	// Web sources take no uploads.
	code, _, e = owner.uploadFiles(srcPath+"/documents", []upload{{"a.md", []byte("# A")}}, "")
	mustCode(t, "upload to web source", code, e, 400, "not_upload_source")
}

func TestWebModesAndLimits(t *testing.T) {
	env := newWebEnv(t, true)
	owner, site := env.owner, env.site
	sources := env.base + "/sources"

	// scrape: one page.
	scrape := env.createWeb(t, owner, sources, "Scrape", map[string]any{"mode": "scrape", "urls": []string{site.url("/about")}})
	c := waitCrawl(t, owner, sources+"/"+scrape.Id.String(), scrape.ActiveCrawl.Id)
	docs := owner.waitForDocuments(t, sources+"/"+scrape.Id.String()+"/documents")
	if c.PagesFetched != 1 || len(docs) != 1 || docs[0].Url != site.url("/about") {
		t.Fatalf("scrape = %+v %+v", c, docs)
	}

	// batch: the listed URLs only (a 404 fails, links are not followed).
	batch := env.createWeb(t, owner, sources, "Batch", map[string]any{"mode": "batch", "urls": []string{site.url("/"), site.url("/new"), site.url("/missing")}})
	c = waitCrawl(t, owner, sources+"/"+batch.Id.String(), batch.ActiveCrawl.Id)
	docs = owner.waitForDocuments(t, sources+"/"+batch.Id.String()+"/documents")
	if c.PagesFetched != 3 || c.PagesFailed != 1 || len(docs) != 2 || c.PagesDiscovered != 3 {
		t.Fatalf("batch = %+v %d docs", c, len(docs))
	}

	// depth 0: seeds only; no sitemaps.
	shallow := env.createWeb(t, owner, sources, "Shallow", map[string]any{"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 0, "useSitemaps": false})
	c = waitCrawl(t, owner, sources+"/"+shallow.Id.String(), shallow.ActiveCrawl.Id)
	if c.PagesFetched != 1 || c.PagesDiscovered != 1 {
		t.Fatalf("depth 0 = %+v", c)
	}

	// Page limit: the run is truncated and stale pages are not removed.
	full := env.createWeb(t, owner, sources, "Full", map[string]any{"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 1, "useSitemaps": false, "exclude": []string{"/deep/**"}})
	fullPath := sources + "/" + full.Id.String()
	c = waitCrawl(t, owner, fullPath, full.ActiveCrawl.Id)
	before := len(owner.waitForDocuments(t, fullPath+"/documents"))
	if c.Truncated || before < 5 {
		t.Fatalf("full crawl = %+v, %d docs", c, before)
	}
	if hits, _ := site.count("/deep/1"); hits != 0 {
		t.Error("excluded path fetched")
	}
	var cur apitypes.DataSource
	owner.get(fullPath, &cur)
	var updated apitypes.DataSource
	code, e := owner.call("PATCH", fullPath, map[string]any{"web": map[string]any{
		"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 1, "useSitemaps": false, "maxPages": 2, "schedule": "weekly",
	}}, &updated, ifMatch(cur.Revision))
	mustCode(t, "update config", code, e, 200, "")
	if updated.Web.MaxPages != 2 || updated.NextSyncAt == nil || updated.NextSyncAt.Before(time.Now().Add(6*24*time.Hour)) {
		t.Fatalf("updated = %+v next=%v", updated.Web, updated.NextSyncAt)
	}
	var run apitypes.Crawl
	owner.call("POST", fullPath+"/sync", nil, &run, nil)
	run = waitCrawl(t, owner, fullPath, run.Id)
	if !run.Truncated || run.PagesFetched != 2 || run.DocumentsDeleted != 0 {
		t.Fatalf("truncated run = %+v", run)
	}
	if after := len(owner.waitForDocuments(t, fullPath+"/documents")); after != before {
		t.Errorf("documents after truncated run = %d, want %d", after, before)
	}

	// Validation.
	for _, tc := range []struct {
		body map[string]any
		code string
	}{
		{map[string]any{"name": "X", "type": "web", "classification": "open"}, "invalid_web_config"},
		{map[string]any{"name": "X", "type": "web", "classification": "open", "web": map[string]any{"mode": "scrape", "urls": []string{"a", "b"}}}, "invalid_web_config"},
		{map[string]any{"name": "X", "type": "web", "classification": "open", "web": map[string]any{"mode": "scrape", "urls": []string{"https://example.org/"}}}, "host_not_allowed"},
		{map[string]any{"name": "X", "type": "upload", "classification": "open", "web": map[string]any{"mode": "scrape", "urls": []string{site.url("/")}}}, "invalid_web_config"},
	} {
		code, e := owner.call("POST", sources, tc.body, nil, nil)
		mustCode(t, fmt.Sprint(tc.body), code, e, 400, tc.code)
	}
	code, e = owner.call("POST", sources, map[string]any{"name": "X", "type": "web", "classification": "open", "web": map[string]any{"mode": "scrape", "urls": []string{site.url("/")}, "bogus": 1}}, nil, nil)
	mustCode(t, "unknown web field", code, e, 400, "invalid_json")
}

func TestWebScheduler(t *testing.T) {
	env := newWebEnv(t, true)
	owner, site := env.owner, env.site
	src := env.createWeb(t, owner, env.base+"/sources", "Daily", map[string]any{"mode": "scrape", "urls": []string{site.url("/about")}, "schedule": "daily"})
	srcPath := env.base + "/sources/" + src.Id.String()
	waitCrawl(t, owner, srcPath, src.ActiveCrawl.Id)
	var cur apitypes.DataSource
	owner.get(srcPath, &cur)
	if cur.NextSyncAt == nil || time.Until(*cur.NextSyncAt) < 23*time.Hour {
		t.Fatalf("next sync = %v", cur.NextSyncAt)
	}
	// A paused source is skipped even when due.
	paused := env.createWeb(t, owner, env.base+"/sources", "Paused", map[string]any{"mode": "scrape", "urls": []string{site.url("/")}, "schedule": "daily"})
	pausedPath := env.base + "/sources/" + paused.Id.String()
	waitCrawl(t, owner, pausedPath, paused.ActiveCrawl.Id)
	owner.get(pausedPath, &cur)
	code, e := owner.call("PATCH", pausedPath, map[string]any{"status": "paused"}, nil, ifMatch(cur.Revision))
	mustCode(t, "pause", code, e, 200, "")
	code, e = owner.call("POST", pausedPath+"/sync", nil, nil, nil)
	mustCode(t, "sync paused", code, e, 409, "source_paused")

	ctx := context.Background()
	if _, err := env.app.Pool.Exec(ctx, `UPDATE data_sources SET next_sync_at = now() - interval '1 minute' WHERE type = 'web'`); err != nil {
		t.Fatal(err)
	}
	inserter, err := jobs.NewInsertOnly(env.app.Pool, testutil.Logger())
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(30 * time.Second)
	var list []apitypes.Crawl
	for {
		// The periodic scheduler job may be mid-run (and collapse this
		// insert into it), so keep asking until a run has seen the change.
		if _, err := inserter.Insert(ctx, web.ScheduleArgs{}, nil); err != nil {
			t.Fatal(err)
		}
		owner.get(srcPath+"/crawls", &list)
		if len(list) == 2 && list[0].Trigger == "schedule" && list[0].Status == "completed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("scheduled crawl did not run: %+v", list)
		}
		time.Sleep(100 * time.Millisecond)
	}
	owner.get(srcPath, &cur)
	if cur.NextSyncAt == nil || time.Until(*cur.NextSyncAt) < 23*time.Hour {
		t.Errorf("next sync after scheduled run = %v", cur.NextSyncAt)
	}
	owner.get(pausedPath+"/crawls", &list)
	if len(list) != 1 {
		t.Errorf("paused source crawled by the scheduler: %+v", list)
	}
}

func TestDomainRequestsAndAllowlist(t *testing.T) {
	env := newWebEnv(t, false) // 127.0.0.1 is not on the platform allowlist
	owner, admin, site := env.owner, env.admin, env.site
	sources := env.base + "/sources"
	cfg := map[string]any{"mode": "scrape", "urls": []string{site.url("/about")}}
	code, e := owner.call("POST", sources, map[string]any{"name": "Blocked", "type": "web", "classification": "open", "web": cfg}, nil, nil)
	mustCode(t, "off-allowlist host", code, e, 400, "host_not_allowed")

	// Members cannot request domains; editors and above can.
	env.app.signIn("alex")
	owner.call("POST", env.base+"/members", map[string]string{"email": "alex@localhost", "role": "member"}, nil, nil)
	member := env.app.signIn("alex")
	req := map[string]any{"pattern": "127.0.0.1", "reason": "Our test site runs on the loopback address."}
	code, e = member.call("POST", env.base+"/domain-requests", req, nil, nil)
	mustCode(t, "member requests", code, e, 403, "forbidden")
	code, e = owner.call("POST", env.base+"/domain-requests", map[string]any{"pattern": "127.0.0.1", "reason": "short"}, nil, nil)
	mustCode(t, "short reason", code, e, 400, "reason_required")
	// A fresh install has an empty allowlist; add a platform pattern first.
	code, e = admin.call("POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": "*.example.edu", "note": "campus sites"}, nil, nil)
	mustCode(t, "allowlist campus", code, e, 201, "")
	code, e = owner.call("POST", env.base+"/domain-requests", map[string]any{"pattern": "www.example.edu", "reason": "We need the main campus site."}, nil, nil)
	mustCode(t, "already allowed", code, e, 409, "already_allowed")
	code, e = owner.call("POST", env.base+"/domain-requests", map[string]any{"pattern": "*", "reason": "We need everything on the web."}, nil, nil)
	mustCode(t, "star", code, e, 400, "invalid_pattern")
	var dr apitypes.DomainRequest
	code, e = owner.call("POST", env.base+"/domain-requests", req, &dr, nil)
	mustCode(t, "request", code, e, 201, "")
	if dr.Status != "pending" || dr.TeamSlug != env.team || dr.Requester == nil || dr.Requester.Email != "user@localhost" ||
		dr.Requester.DisplayName != "Dev User" || dr.Reviewer != nil {
		t.Fatalf("request = %+v", dr)
	}
	code, e = owner.call("POST", env.base+"/domain-requests", req, nil, nil)
	mustCode(t, "duplicate", code, e, 409, "request_exists")

	// P-15: while it is pending, the allowlist error names the request.
	code, raw := owner.raw("POST", sources, map[string]any{"name": "Blocked", "type": "web", "classification": "open", "web": cfg}, nil)
	var blocked struct {
		Error struct {
			Code    string
			Details struct {
				Host           string
				PendingRequest *struct{ Id, Pattern string }
			}
		}
	}
	if json.Unmarshal(raw, &blocked) != nil || code != 400 || blocked.Error.Code != "host_not_allowed" || blocked.Error.Details.Host != "127.0.0.1" ||
		blocked.Error.Details.PendingRequest == nil || blocked.Error.Details.PendingRequest.Id != dr.Id.String() {
		t.Fatalf("pending request in the error = %d %s", code, raw)
	}
	// P-16: platform admins are told, and see a count for the badge.
	var inboxPage apitypes.NotificationPage
	admin.get("/v1/notifications?type=web.domain_request_new", &inboxPage)
	if len(inboxPage.Items) != 1 || inboxPage.Items[0].Link != "/admin/crawl-domains" || !strings.Contains(inboxPage.Items[0].Title, "127.0.0.1") {
		t.Fatalf("admin notification = %+v", inboxPage.Items)
	}
	var attention apitypes.AdminAttention
	if code := admin.get("/v1/admin/attention", &attention); code != 200 || attention.PendingDomainRequests != 1 {
		t.Fatalf("attention = %d %+v", code, attention)
	}
	code, e = owner.call("GET", "/v1/admin/attention", nil, nil, nil)
	mustCode(t, "team owner reads attention", code, e, 403, "forbidden")
	var settings apitypes.NotificationSettings
	owner.get("/v1/me/notification-settings", &settings)
	for _, it := range settings.Items {
		if it.Type == "web.domain_request_new" {
			t.Error("non-admins see the admin-only notification setting")
		}
	}
	var mine []apitypes.DomainRequest
	if code := member.get(env.base+"/domain-requests", &mine); code != 200 || len(mine) != 1 {
		t.Fatalf("team requests = %d %+v", code, mine)
	}

	// Auditors see requests but cannot review them.
	auditor := env.app.signIn("auditor")
	var pending []apitypes.DomainRequest
	if code := auditor.get("/v1/admin/domain-requests?status=pending", &pending); code != 200 || len(pending) != 1 {
		t.Fatalf("pending = %d %+v", code, pending)
	}
	code, e = auditor.call("POST", "/v1/admin/domain-requests/"+dr.Id.String()+"/review", map[string]any{"decision": "approve"}, nil, nil)
	mustCode(t, "auditor reviews", code, e, 403, "forbidden")
	code, e = owner.call("GET", "/v1/admin/domain-requests", nil, nil, nil)
	mustCode(t, "team owner lists admin requests", code, e, 403, "forbidden")

	// Approval unblocks the host for this team.
	code, e = admin.call("POST", "/v1/admin/domain-requests/"+dr.Id.String()+"/review", map[string]any{"decision": "approve", "note": "ok for tests"}, &dr, nil)
	mustCode(t, "approve", code, e, 200, "")
	if dr.Status != "approved" || dr.ReviewNote != "ok for tests" || dr.ReviewedAt == nil ||
		dr.Reviewer == nil || dr.Reviewer.Email != "admin@localhost" || dr.Requester == nil {
		t.Fatalf("approved = %+v", dr)
	}
	// Team members see who asked and who reviewed (names, not only IDs).
	if code := member.get(env.base+"/domain-requests", &mine); code != 200 || mine[0].Reviewer == nil ||
		mine[0].Reviewer.DisplayName != "Dev Platform Admin" || mine[0].Requester.Email != "user@localhost" {
		t.Fatalf("team requests after review = %+v", mine)
	}
	code, e = admin.call("POST", "/v1/admin/domain-requests/"+dr.Id.String()+"/review", map[string]any{"decision": "deny"}, nil, nil)
	mustCode(t, "deny approved", code, e, 409, "invalid_transition")
	src := env.createWeb(t, owner, sources, "Unblocked", map[string]any{"mode": "scrape", "urls": []string{site.url("/about")}})
	srcPath := sources + "/" + src.Id.String()
	c := waitCrawl(t, owner, srcPath, src.ActiveCrawl.Id)
	if c.PagesChanged != 1 {
		t.Fatalf("crawl after approval = %+v", c)
	}
	// Another team is still blocked.
	createTeam(t, admin, "other", "blair@localhost")
	blair := env.app.signIn("blair")
	code, e = blair.call("POST", "/v1/teams/other/sources", map[string]any{"name": "B", "type": "web", "classification": "open", "web": cfg}, nil, nil)
	mustCode(t, "other team", code, e, 400, "host_not_allowed")

	// Revoking takes effect on the next fetch.
	code, e = admin.call("POST", "/v1/admin/domain-requests/"+dr.Id.String()+"/review", map[string]any{"decision": "revoke", "note": "no longer needed"}, nil, nil)
	mustCode(t, "revoke", code, e, 200, "")
	var run apitypes.Crawl
	owner.call("POST", srcPath+"/sync", nil, &run, nil)
	run = waitCrawl(t, owner, srcPath, run.Id)
	if run.PagesSkipped != 1 || run.PagesFetched != 0 || run.DocumentsDeleted != 0 {
		t.Fatalf("crawl after revoke = %+v", run)
	}
	// A run that reached no page deletes nothing.
	if docs := owner.waitForDocuments(t, srcPath+"/documents"); len(docs) != 1 {
		t.Errorf("documents after revoke = %+v", docs)
	}
	if fr := frontier(t, env.app, run.Id); fr[site.url("/about")] != [2]string{"skipped", "host_not_allowed"} {
		t.Errorf("frontier after revoke = %v", fr)
	}
	if n := auditCount(t, env.app, "crawl.domain_request"); n != 1 {
		t.Errorf("crawl.domain_request audits = %d", n)
	}
	if n := auditCount(t, env.app, "crawl.domain_review"); n != 2 {
		t.Errorf("crawl.domain_review audits = %d", n)
	}

	// The platform allowlist: admins add and remove; auditors read.
	var entry apitypes.AllowlistEntry
	code, e = admin.call("POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": "*.Example.ORG", "note": "partner"}, &entry, nil)
	mustCode(t, "allowlist add", code, e, 201, "")
	if entry.Pattern != "*.example.org" {
		t.Errorf("pattern = %q", entry.Pattern)
	}
	code, e = admin.call("POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": "*.example.org"}, nil, nil)
	mustCode(t, "allowlist duplicate", code, e, 409, "pattern_exists")
	code, e = admin.call("POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": "not a host"}, nil, nil)
	mustCode(t, "allowlist invalid", code, e, 400, "invalid_pattern")
	code, e = auditor.call("POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": "example.net"}, nil, nil)
	mustCode(t, "auditor adds", code, e, 403, "forbidden")
	var list []apitypes.AllowlistEntry
	if code := auditor.get("/v1/admin/crawl-allowlist", &list); code != 200 || len(list) != 2 {
		t.Fatalf("allowlist = %d %+v", code, list)
	}
	code, e = admin.call("DELETE", "/v1/admin/crawl-allowlist/"+entry.Id.String(), nil, nil, nil)
	mustCode(t, "allowlist remove", code, e, 200, "")
	if auditCount(t, env.app, "crawl.allowlist_add") != 2 || auditCount(t, env.app, "crawl.allowlist_remove") != 1 {
		t.Error("allowlist changes not audited")
	}
}

func TestSharedSources(t *testing.T) {
	env := newWebEnv(t, true)
	admin, owner, site := env.admin, env.owner, env.site
	auditor := env.app.signIn("auditor")

	// Platform admins manage shared sources; auditors read; teams cannot.
	shared := env.createWeb(t, admin, "/v1/admin/shared-sources", "Registrar (shared)", map[string]any{
		"mode": "crawl", "urls": []string{site.url("/")}, "maxDepth": 1, "useSitemaps": false,
	})
	sharedPath := "/v1/admin/shared-sources/" + shared.Id.String()
	c := waitCrawl(t, admin, sharedPath, shared.ActiveCrawl.Id)
	if c.Status != "completed" || c.PagesChanged < 4 {
		t.Fatalf("shared crawl = %+v", c)
	}
	docs := admin.waitForDocuments(t, sharedPath+"/documents")
	var platformKeys int
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM documents WHERE source_id = $1 AND team_id IS NULL AND blob_key LIKE 'platform/sources/%'`, shared.Id).Scan(&platformKeys)
	if platformKeys != len(docs) || platformKeys == 0 {
		t.Errorf("platform blob keys = %d of %d", platformKeys, len(docs))
	}
	if code := auditor.get(sharedPath, nil); code != 200 {
		t.Errorf("auditor reads shared source = %d", code)
	}
	code, e := auditor.call("POST", "/v1/admin/shared-sources", map[string]any{"name": "A", "classification": "open"}, nil, nil)
	mustCode(t, "auditor creates", code, e, 403, "forbidden")
	code, e = auditor.call("POST", sharedPath+"/sync", nil, nil, nil)
	mustCode(t, "auditor syncs", code, e, 403, "forbidden")
	code, e = owner.call("GET", "/v1/admin/shared-sources", nil, nil, nil)
	mustCode(t, "team owner lists admin shared sources", code, e, 403, "forbidden")

	// A shared upload source stores under platform/.
	var up apitypes.DataSource
	code, e = admin.call("POST", "/v1/admin/shared-sources", map[string]any{"name": "Shared uploads", "classification": "open"}, &up, nil)
	mustCode(t, "shared upload source", code, e, 201, "")
	code, results, _ := admin.uploadFiles("/v1/admin/shared-sources/"+up.Id.String()+"/documents", []upload{{"handbook.md", []byte("# Handbook\n\nThe student handbook covers academic integrity.")}}, "")
	if code != 200 || results[0].Status != "created" {
		t.Fatalf("shared upload = %d %+v", code, results)
	}
	var key string
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT blob_key FROM documents WHERE id = $1`, results[0].Document.Id).Scan(&key)
	if !strings.HasPrefix(key, "platform/sources/"+up.Id.String()+"/docs/") {
		t.Errorf("blob key = %q", key)
	}
	code, e = admin.call("POST", "/v1/admin/shared-sources", map[string]any{"name": "shared uploads", "classification": "open"}, nil, nil)
	mustCode(t, "shared name taken", code, e, 409, "name_taken")

	// Teams see the catalog (metadata and counts), not the documents.
	var catalog []apitypes.SharedSource
	if code := owner.get("/v1/shared-sources", &catalog); code != 200 || len(catalog) != 2 {
		t.Fatalf("catalog = %d %+v", code, catalog)
	}
	for _, s := range catalog {
		if s.Id == shared.Id && (s.Documents.Ready == 0 || s.Type != "web") {
			t.Errorf("catalog entry = %+v", s)
		}
	}
	code, e = owner.call("GET", env.base+"/sources/"+shared.Id.String()+"/documents", nil, nil, nil)
	mustCode(t, "team lists shared documents", code, e, 404, "source_not_found")

	// Two teams attach the shared source; both retrieve its chunks with URLs.
	createTeam(t, admin, "housing", "blair@localhost")
	blair := env.app.signIn("blair")
	type teamKB struct {
		s    *session
		base string
		kb   apitypes.KnowledgeBase
	}
	var kbs []teamKB
	for _, tm := range []struct {
		s    *session
		base string
	}{{owner, env.base}, {blair, "/v1/teams/housing"}} {
		var kb apitypes.KnowledgeBase
		tm.s.call("POST", tm.base+"/kbs", map[string]any{"name": "With shared"}, &kb, nil)
		code, e := tm.s.call("PUT", tm.base+"/kbs/"+kb.Id.String()+"/sources/"+shared.Id.String(), nil, &kb, nil)
		mustCode(t, "attach shared", code, e, 200, "")
		if len(kb.Sources) != 1 || !kb.Sources[0].Shared {
			t.Fatalf("kb sources = %+v", kb.Sources)
		}
		hits := env.retrieve(t, tm.s, tm.base, kb.Id, "office hours Monday Friday")
		if len(hits) == 0 || hits[0].SourceId != shared.Id || hits[0].Url != site.url("/about") {
			t.Fatalf("%s hits = %+v", tm.base, hits)
		}
		kbs = append(kbs, teamKB{tm.s, tm.base, kb})
	}
	// The admin's Used by lists both teams' knowledge bases.
	var attached []apitypes.SharedSourceAttachment
	if code := env.app.signIn("auditor").get("/v1/admin/shared-source-usage", &attached); code != 200 || len(attached) != 2 ||
		attached[0].SourceId != shared.Id || attached[0].KbName != "With shared" || attached[1].TeamSlug == attached[0].TeamSlug {
		t.Fatalf("shared source usage = %d %+v", code, attached)
	}

	// Raising the classification: preview lists the teams approved below it,
	// and the change is refused until their KBs detach.
	code, e = admin.call("POST", "/v1/admin/teams", map[string]any{"slug": "openteam", "name": "Open team", "maxClassification": "open", "ownerEmail": "casey@localhost"}, nil, nil)
	mustCode(t, "open team", code, e, 201, "")
	casey := env.app.signIn("casey")
	var openKB apitypes.KnowledgeBase
	casey.call("POST", "/v1/teams/openteam/kbs", map[string]any{"name": "Open KB"}, &openKB, nil)
	code, e = casey.call("PUT", "/v1/teams/openteam/kbs/"+openKB.Id.String()+"/sources/"+shared.Id.String(), nil, nil, nil)
	mustCode(t, "open team attaches", code, e, 200, "")

	var cur apitypes.DataSource
	admin.get(sharedPath, &cur)
	var impact apitypes.ClassificationImpact
	code, e = admin.call("PATCH", sharedPath+"?preview=true", map[string]any{"classification": "sensitive"}, &impact, ifMatch(cur.Revision))
	mustCode(t, "preview", code, e, 200, "")
	if impact.Classification != "sensitive" || len(impact.Affected) != 1 || impact.Affected[0].TeamSlug != "openteam" || impact.Affected[0].KnowledgeBaseId != openKB.Id {
		t.Fatalf("impact = %+v", impact)
	}
	admin.get(sharedPath, &cur)
	if cur.Classification != "open" {
		t.Fatal("preview changed the source")
	}
	code, raw := admin.raw("PATCH", sharedPath, map[string]any{"classification": "sensitive"}, ifMatch(cur.Revision))
	var conflict struct {
		Error struct {
			Code    string
			Details apitypes.ClassificationImpact
		}
	}
	_ = json.Unmarshal(raw, &conflict)
	if code != 409 || conflict.Error.Code != "classification_impact" || len(conflict.Error.Details.Affected) != 1 {
		t.Fatalf("raise = %d %s", code, raw)
	}
	code, e = casey.call("DELETE", "/v1/teams/openteam/kbs/"+openKB.Id.String()+"/sources/"+shared.Id.String(), nil, nil, nil)
	mustCode(t, "detach", code, e, 200, "")
	code, e = admin.call("PATCH", sharedPath, map[string]any{"classification": "sensitive"}, &cur, ifMatch(cur.Revision))
	mustCode(t, "raise after detach", code, e, 200, "")
	code, e = casey.call("PUT", "/v1/teams/openteam/kbs/"+openKB.Id.String()+"/sources/"+shared.Id.String(), nil, nil, nil)
	mustCode(t, "attach above team approval", code, e, 400, "classification_not_approved")
	// A team cannot be approved below a shared source its KBs use.
	var team apitypes.TeamSummary
	admin.get("/v1/admin/teams/housing", &team)
	code, e = admin.call("PATCH", "/v1/admin/teams/housing", map[string]any{"maxClassification": "open"}, nil, ifMatch(team.Team.Revision))
	mustCode(t, "lower team below shared source", code, e, 409, "classification_in_use")
	// Lowering needs a reason and is audited.
	code, e = admin.call("PATCH", sharedPath, map[string]any{"classification": "open"}, nil, ifMatch(cur.Revision))
	mustCode(t, "lower without reason", code, e, 400, "reason_required")
	code, e = admin.call("PATCH", sharedPath, map[string]any{"classification": "open", "reason": "Public pages only, reviewed"}, &cur, ifMatch(cur.Revision))
	mustCode(t, "lower with reason", code, e, 200, "")
	var lowered int
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_log WHERE action = 'source.classification_change' AND target_id = $1 AND team_id IS NULL AND metadata->>'lowered' = 'true'`, shared.Id.String()).Scan(&lowered)
	if lowered != 1 {
		t.Errorf("lowering audits = %d", lowered)
	}

	// Shared sources in use cannot be deleted; admins see the shared crawls.
	code, e = admin.call("DELETE", sharedPath, nil, nil, nil)
	mustCode(t, "delete shared in use", code, e, 409, "source_in_use")
	var run apitypes.Crawl
	code, e = admin.call("POST", sharedPath+"/sync", nil, &run, nil)
	mustCode(t, "shared sync", code, e, 202, "")
	if run = waitCrawl(t, admin, sharedPath, run.Id); run.PagesChanged != 0 || run.PagesUnchanged < 4 {
		t.Errorf("shared re-sync = %+v", run)
	}
	for _, k := range kbs {
		k.s.call("DELETE", k.base+"/kbs/"+k.kb.Id.String()+"/sources/"+shared.Id.String(), nil, nil, nil)
	}
	code, e = admin.call("DELETE", sharedPath, nil, nil, nil)
	mustCode(t, "delete shared", code, e, 200, "")
}

func TestWebMapAndPermissions(t *testing.T) {
	env := newWebEnv(t, true)
	owner, site := env.owner, env.site

	var res apitypes.MapResult
	code, e := owner.call("POST", env.base+"/web/map", map[string]any{"url": site.url("/"), "useSitemaps": true, "exclude": []string{"/admissions/**"}}, &res, nil)
	mustCode(t, "map", code, e, 200, "")
	got := map[string]bool{}
	for _, u := range res.Urls {
		got[u] = true
	}
	for _, p := range []string{"/", "/about", "/deep/1", "/sitemap-only", "/guide.pdf"} {
		if !got[site.url(p)] {
			t.Errorf("map missing %s: %v", p, res.Urls)
		}
	}
	for _, p := range []string{"/admissions/", "/events/calendar/2026-09-25"} {
		if got[site.url(p)] {
			t.Errorf("map included %s", p)
		}
	}
	if res.SitemapUrls != 1 || res.Truncated {
		t.Errorf("map = %+v", res)
	}
	code, e = owner.call("POST", env.base+"/web/map", map[string]any{"url": site.url("/"), "limit": 2}, &res, nil)
	mustCode(t, "map limited", code, e, 200, "")
	if len(res.Urls) != 2 || !res.Truncated {
		t.Errorf("limited map = %+v", res)
	}
	code, e = owner.call("POST", env.base+"/web/map", map[string]any{"url": "https://example.org/"}, nil, nil)
	mustCode(t, "map off allowlist", code, e, 400, "host_not_allowed")
	// A remote 404 is the address's problem, said plainly, not a 502 from Grounded (BU-08).
	code, e = owner.call("POST", env.base+"/web/map", map[string]any{"url": site.url("/missing-page")}, nil, nil)
	mustCode(t, "map of a missing page", code, e, 422, "fetch_failed")
	var n int
	_ = env.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM web_frontier`).Scan(&n)
	if n != 0 {
		t.Error("map stored frontier rows")
	}

	// Members read crawls but cannot sync or map; ingest keys can sync.
	src := env.createWeb(t, owner, env.base+"/sources", "Perms", map[string]any{"mode": "scrape", "urls": []string{site.url("/about")}})
	srcPath := env.base + "/sources/" + src.Id.String()
	waitCrawl(t, owner, srcPath, src.ActiveCrawl.Id)
	env.app.signIn("alex")
	owner.call("POST", env.base+"/members", map[string]string{"email": "alex@localhost", "role": "member"}, nil, nil)
	member := env.app.signIn("alex")
	code, e = member.call("POST", srcPath+"/sync", nil, nil, nil)
	mustCode(t, "member syncs", code, e, 403, "forbidden")
	code, e = member.call("POST", env.base+"/web/map", map[string]any{"url": site.url("/")}, nil, nil)
	mustCode(t, "member maps", code, e, 403, "forbidden")
	if code := member.get(srcPath+"/crawls", nil); code != 200 {
		t.Errorf("member lists crawls = %d", code)
	}
	var ingestKey, queryKey apitypes.APIKeyCreated
	owner.call("POST", env.base+"/api-keys", map[string]any{"name": "loader", "kind": "service", "scopes": []string{"ingest"}}, &ingestKey, nil)
	owner.call("POST", env.base+"/api-keys", map[string]any{"name": "reader", "scopes": []string{"query"}}, &queryKey, nil)
	code, e = keyCall(t, env.app.URL, "POST", srcPath+"/sync", queryKey.Secret, nil, nil)
	mustCode(t, "query key syncs", code, e, 403, "forbidden")
	var run apitypes.Crawl
	code, e = keyCall(t, env.app.URL, "POST", srcPath+"/sync", ingestKey.Secret, nil, &run)
	mustCode(t, "ingest key syncs", code, e, 202, "")
	waitCrawl(t, owner, srcPath, run.Id)
	code, e = keyCall(t, env.app.URL, "GET", srcPath+"/crawls", queryKey.Secret, nil, nil)
	mustCode(t, "query key lists crawls", code, e, 200, "")
	// Keys never reach shared-source administration.
	code, e = keyCall(t, env.app.URL, "GET", "/v1/admin/shared-sources", ingestKey.Secret, nil, nil)
	mustCode(t, "key on admin route", code, e, 401, "unauthorized")
}
