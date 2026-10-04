package crawl

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestPublicIP(t *testing.T) {
	// Ported from yoink, plus CGNAT/ULA/mapped cases.
	for _, s := range []string{"0.0.0.0", "10.1.2.3", "100.64.0.1", "100.100.100.200", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.0.0.8", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.250", "255.255.255.255", "::", "::1", "::127.0.0.1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001::1", "2001:db8::1", "3fff::1", "168.63.129.16"} {
		if publicIP(netip.MustParseAddr(s)) {
			t.Errorf("allowed %s", s)
		}
	}
	for _, s := range []string{"8.8.8.8", "93.184.216.34", "128.227.9.48", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"} {
		if !publicIP(netip.MustParseAddr(s)) {
			t.Errorf("denied public %s", s)
		}
	}
}

// noDial fails the test if the fetcher ever opens a connection.
func noDial(t *testing.T, f *Fetcher) {
	f.dial = func(_ context.Context, _, addr string) (net.Conn, error) {
		t.Errorf("unexpected dial to %s", addr)
		return nil, errors.New("no dial")
	}
}

func TestSSRFLiteralAddresses(t *testing.T) {
	dns := staticDNS(nil)
	f := NewFetcher(FetcherConfig{RespectRobots: true, Resolver: dns.resolver()})
	noDial(t, f)
	for _, raw := range []string{
		"http://127.0.0.1/", "http://10.0.0.1/", "http://172.16.5.4/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/",
		"http://100.64.0.1/", "http://0.0.0.0/", "http://224.0.0.1/", "http://255.255.255.255/",
		"http://[::1]/", "http://[::]/", "http://[fd00::1]/", "http://[fc00::5]/", "http://[fe80::1]/", "http://[ff02::1]/",
		"http://[::ffff:127.0.0.1]/", "http://[::ffff:a9fe:a9fe]/", "http://[64:ff9b::a00:1]/",
		"http://2130706433/", "http://0177.0.0.1/", "http://0x7f.0.0.1/", "http://0x7f000001/", "http://127.1/", "http://017700000001/",
		"https://8.8.8.8:8443/", "http://8.8.8.8:22/",
	} {
		_, err := f.Fetch(context.Background(), raw)
		if !errors.Is(err, ErrBlockedAddress) {
			t.Errorf("%s: err=%v, want ErrBlockedAddress", raw, err)
		}
	}
}

func TestSSRFResolvedAddresses(t *testing.T) {
	dns := staticDNS(map[string][]string{
		"internal.test": {"10.1.2.3"},
		"loop.test":     {"127.0.0.1"},
		"meta.test":     {"169.254.169.254"},
		"cgnat.test":    {"100.64.1.1"},
		"ula.test":      {"fd00::1"},
		"mapped.test":   {"::ffff:192.168.0.1"},
		"mixed.test":    {"8.8.8.8", "10.0.0.1"},
		"mixed6.test":   {"8.8.8.8", "::1"},
	})
	f := NewFetcher(FetcherConfig{Resolver: dns.resolver()})
	noDial(t, f)
	for _, host := range []string{"internal.test", "loop.test", "meta.test", "cgnat.test", "ula.test", "mapped.test", "mixed.test", "mixed6.test"} {
		_, err := f.Fetch(context.Background(), "http://"+host+"/")
		if !errors.Is(err, ErrBlockedAddress) {
			t.Errorf("%s: err=%v, want ErrBlockedAddress", host, err)
		}
		if dns.count(host) == 0 {
			t.Errorf("%s: injected resolver not used", host)
		}
	}
	if _, err := f.Fetch(context.Background(), "http://nxdomain.test/"); err == nil || errors.Is(err, ErrBlockedAddress) {
		t.Errorf("nxdomain: %v", err)
	}
}

func TestSSRFDNSRebindingDialsApprovedIP(t *testing.T) {
	srv := httptest.NewServer(textHandler("text/html", "<p>ok</p>"))
	defer srv.Close()
	dns := newFakeDNS(func(_ string, n int) []netip.Addr {
		if n == 1 {
			return []netip.Addr{netip.MustParseAddr("8.8.8.8")}
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}
	})
	f := NewFetcher(FetcherConfig{Resolver: dns.resolver()})
	dials := routeDials(f, srv)
	p, err := f.Fetch(context.Background(), "http://rebind.test/")
	if err != nil || p.Status != 200 || string(p.Body) != "<p>ok</p>" {
		t.Fatalf("fetch: %+v %v", p, err)
	}
	if got := dials.list(); len(got) != 1 || got[0] != "8.8.8.8:80" {
		t.Fatalf("dialed %v, want only the approved 8.8.8.8:80", got)
	}
	if n := dns.count("rebind.test"); n != 1 {
		t.Fatalf("%d lookups; the dial must not resolve again", n)
	}
	// The next request re-resolves, sees the rebound private answer, and stops.
	f.transport.CloseIdleConnections()
	if _, err := f.Fetch(context.Background(), "http://rebind.test/again"); !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("rebound answer: %v", err)
	}
	if got := dials.list(); len(got) != 1 {
		t.Fatalf("dialed after rebind: %v", got)
	}
	// Direct safeDial without approval also pins (defence in depth).
	dns2 := newFakeDNS(func(_ string, n int) []netip.Addr {
		if n == 1 {
			return []netip.Addr{netip.MustParseAddr("8.8.4.4")}
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}
	})
	f2 := NewFetcher(FetcherConfig{Resolver: dns2.resolver()})
	d2 := routeDials(f2, srv)
	conn, err := f2.safeDial(context.Background(), "tcp", "rebind2.test:443")
	if err != nil {
		t.Fatal(err)
	}
	conn.Close()
	if got := d2.list(); len(got) != 1 || got[0] != "8.8.4.4:443" || dns2.count("rebind2.test") != 1 {
		t.Fatalf("safeDial: dials=%v lookups=%d", got, dns2.count("rebind2.test"))
	}
}

func TestSSRFRedirectToPrivate(t *testing.T) {
	var target atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/robots.txt":
			http.NotFound(w, r)
		default:
			http.Redirect(w, r, target.Load().(string), http.StatusFound)
		}
	}))
	defer srv.Close()
	dns := staticDNS(map[string][]string{"public.test": {"8.8.8.8"}, "internal.test": {"10.0.0.7"}})
	for _, loc := range []string{
		"http://127.0.0.1/secret", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/", "http://2130706433/",
		"http://internal.test/admin", "http://public.test:8080/", "http://" + srv.Listener.Addr().String() + "/",
	} {
		t.Run(loc, func(t *testing.T) {
			target.Store(loc)
			f := NewFetcher(FetcherConfig{Resolver: dns.resolver(), RespectRobots: true})
			dials := routeDials(f, srv)
			_, err := f.Fetch(context.Background(), "http://public.test/start")
			if !errors.Is(err, ErrBlockedAddress) {
				t.Fatalf("err=%v, want ErrBlockedAddress", err)
			}
			for _, d := range dials.list() {
				if d != "8.8.8.8:80" {
					t.Fatalf("dialed unapproved %s", d)
				}
			}
		})
	}
	// Non-http redirect schemes and credentials are refused too.
	for _, loc := range []string{"file:///etc/passwd", "gopher://public.test/", "http://user:pass@public.test/"} {
		target.Store(loc)
		f := NewFetcher(FetcherConfig{Resolver: dns.resolver()})
		routeDials(f, srv)
		if _, err := f.Fetch(context.Background(), "http://public.test/start"); err == nil {
			t.Errorf("%s: redirect accepted", loc)
		}
	}
}

func TestHostPolicyOnEveryHop(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		switch r.URL.Path {
		case "/robots.txt":
			http.NotFound(w, r)
		case "/out":
			http.Redirect(w, r, "http://blocked.test/", http.StatusMovedPermanently)
		case "/in":
			http.Redirect(w, r, "/final", http.StatusFound)
		default:
			textHandler("text/plain", "fine")(w, r)
		}
	}))
	defer srv.Close()
	var asked []string
	policy := hostPolicyFunc(func(h string) bool { asked = append(asked, h); return h == "127.0.0.1" })
	f := privateFetcher(FetcherConfig{HostPolicy: policy, RespectRobots: true})
	if _, err := f.Fetch(context.Background(), srv.URL+"/out"); !errors.Is(err, ErrHostNotAllowed) {
		t.Fatalf("redirect off-policy: %v", err)
	}
	p, err := f.Fetch(context.Background(), srv.URL+"/in")
	if err != nil || p.FinalURL != srv.URL+"/final" || string(p.Body) != "fine" {
		t.Fatalf("on-policy redirect: %+v %v", p, err)
	}
	if _, err := f.Fetch(context.Background(), "http://blocked.test/"); !errors.Is(err, ErrHostNotAllowed) {
		t.Fatalf("direct: %v", err)
	}
	for _, h := range asked {
		if h != "127.0.0.1" && h != "blocked.test" {
			t.Fatalf("policy saw %q", h)
		}
	}
	// A HostPolicy refusal is decided before any resolution or connection.
	dns := staticDNS(nil)
	f = NewFetcher(FetcherConfig{HostPolicy: hostPolicyFunc(func(string) bool { return false }), Resolver: dns.resolver(), RespectRobots: true})
	noDial(t, f)
	if _, err := f.Fetch(context.Background(), "https://www.example.edu/"); !errors.Is(err, ErrHostNotAllowed) || dns.count("www.example.edu") != 0 {
		t.Fatalf("policy: %v lookups=%d", err, dns.count("www.example.edu"))
	}
}

// WithHostPolicy adds a per-request policy on top of the configured one,
// including redirect hops.
func TestContextHostPolicy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/robots.txt":
			http.NotFound(w, r)
		case "/out":
			http.Redirect(w, r, "http://localhost:"+r.Host[strings.LastIndex(r.Host, ":")+1:]+"/", http.StatusFound)
		default:
			textHandler("text/plain", "fine")(w, r)
		}
	}))
	defer srv.Close()
	f := privateFetcher(FetcherConfig{RespectRobots: true})
	onlyLoopbackIP := WithHostPolicy(context.Background(), hostPolicyFunc(func(h string) bool { return h == "127.0.0.1" }))
	if _, err := f.Fetch(onlyLoopbackIP, srv.URL+"/page"); err != nil {
		t.Fatalf("allowed host: %v", err)
	}
	if _, err := f.Fetch(onlyLoopbackIP, srv.URL+"/out"); !errors.Is(err, ErrHostNotAllowed) {
		t.Fatalf("redirect to a host outside the context policy: %v", err)
	}
	denyAll := WithHostPolicy(context.Background(), hostPolicyFunc(func(string) bool { return false }))
	if _, err := f.Fetch(denyAll, srv.URL+"/page"); !errors.Is(err, ErrHostNotAllowed) {
		t.Fatalf("context policy ignored: %v", err)
	}
	if _, err := f.Fetch(context.Background(), srv.URL+"/out"); err != nil {
		t.Fatalf("no context policy: %v", err)
	}
}

func TestTooManyRedirects(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := hits.Add(1)
		http.Redirect(w, r, fmt.Sprintf("/hop%d", n), http.StatusFound)
	}))
	defer srv.Close()
	f := privateFetcher(FetcherConfig{MaxRedirects: 3})
	if _, err := f.Fetch(context.Background(), srv.URL+"/"); !errors.Is(err, ErrTooManyRedirects) || hits.Load() != 4 {
		t.Fatalf("err=%v hits=%d", err, hits.Load())
	}
	hits.Store(0)
	f = privateFetcher(FetcherConfig{})
	if _, err := f.Fetch(context.Background(), srv.URL+"/"); !errors.Is(err, ErrTooManyRedirects) || hits.Load() != 6 {
		t.Fatalf("default: err=%v hits=%d", err, hits.Load())
	}
}

func TestFetchPageFields(t *testing.T) {
	var mu sync.Mutex
	var ua, accept string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/start":
			http.Redirect(w, r, "/Final/./page?b=2&utm_source=x&a=1#frag", http.StatusMovedPermanently)
		case "/Final/page":
			mu.Lock()
			ua, accept = r.UserAgent(), r.Header.Get("Accept")
			mu.Unlock()
			if r.URL.RawQuery != "a=1&b=2" {
				t.Errorf("wire query %q", r.URL.RawQuery)
			}
			w.Header().Set("Content-Type", "Text/HTML; charset=UTF-8")
			w.Header().Set("ETag", `"v1"`)
			w.Header().Set("Last-Modified", "Wed, 21 Oct 2025 07:28:00 GMT")
			_, _ = w.Write([]byte("<h1>hi</h1>"))
		case "/missing":
			http.Error(w, strings.Repeat("x", 10000), http.StatusNotFound)
		case "/boom":
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer srv.Close()
	f := privateFetcher(FetcherConfig{UserAgent: "grounded/1.0 (+https://rag.example.edu/bot)"})
	before := time.Now().Add(-time.Second)
	p, err := f.Fetch(context.Background(), srv.URL+"/start?utm_medium=y")
	if err != nil {
		t.Fatal(err)
	}
	if p.RequestedURL != srv.URL+"/start" || p.FinalURL != srv.URL+"/Final/page?a=1&b=2" || p.Status != 200 || p.ContentType != "text/html" ||
		string(p.Body) != "<h1>hi</h1>" || p.Truncated || p.ETag != `"v1"` || p.LastModified != "Wed, 21 Oct 2025 07:28:00 GMT" || p.FetchedAt.Before(before) {
		t.Fatalf("page: %+v", p)
	}
	mu.Lock()
	defer mu.Unlock()
	if ua != "grounded/1.0 (+https://rag.example.edu/bot)" || !strings.Contains(accept, "text/html") {
		t.Fatalf("headers ua=%q accept=%q", ua, accept)
	}
	for path, status := range map[string]int{"/missing": 404, "/boom": 503} {
		p, err := f.Fetch(context.Background(), srv.URL+path)
		if err != nil || p.Status != status || len(p.Body) != 0 {
			t.Fatalf("%s: %+v %v", path, p, err)
		}
	}
	if _, err := f.Fetch(context.Background(), "ftp://example.com/"); err == nil {
		t.Fatal("ftp accepted")
	}
}

func TestConditionalFetch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"abc"`)
		w.Header().Set("Last-Modified", "Mon, 01 Sep 2025 00:00:00 GMT")
		if r.Header.Get("If-None-Match") == `"abc"` || r.Header.Get("If-Modified-Since") == "Mon, 01 Sep 2025 00:00:00 GMT" {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		textHandler("text/plain", "body")(w, r)
	}))
	defer srv.Close()
	f := privateFetcher(FetcherConfig{})
	p, err := f.FetchIf(context.Background(), srv.URL+"/", "", "")
	if err != nil || p.Status != 200 || string(p.Body) != "body" || p.ETag != `"abc"` {
		t.Fatalf("unconditional: %+v %v", p, err)
	}
	for _, c := range [][2]string{{`"abc"`, ""}, {"", p.LastModified}} {
		p, err := f.FetchIf(context.Background(), srv.URL+"/", c[0], c[1])
		if err != nil || p.Status != http.StatusNotModified || len(p.Body) != 0 {
			t.Fatalf("conditional %v: %+v %v", c, p, err)
		}
	}
	if p, err := f.FetchIf(context.Background(), srv.URL+"/", `"stale"`, ""); err != nil || p.Status != 200 {
		t.Fatalf("stale etag: %+v %v", p, err)
	}
}

func TestContentTypes(t *testing.T) {
	pdf := "%PDF-1.7\n..."
	zip := "PK\x03\x04rest-of-zip"
	cases := map[string]struct {
		ct, body string
		want     string
		ok       bool
	}{
		"/html":     {"text/html; charset=utf-8", "<p>x</p>", TypeHTML, true},
		"/xhtml":    {"application/xhtml+xml", "<p/>", TypeXHTML, true},
		"/pdf":      {"application/pdf", pdf, TypePDF, true},
		"/docx":     {TypeDOCX, zip, TypeDOCX, true},
		"/pptx":     {TypePPTX, zip, TypePPTX, true},
		"/txt":      {"text/plain; charset=utf-8", "hi", TypePlain, true},
		"/md":       {"text/markdown", "# hi", TypeMarkdown, true},
		"/xmd":      {"text/x-markdown", "# hi", TypeMarkdown, true},
		"/png":      {"image/png", "\x89PNG", "image/png", false},
		"/json":     {"application/json", "{}", "application/json", false},
		"/x.pdf":    {"application/octet-stream", pdf, TypePDF, true},
		"/f.docx":   {"application/octet-stream", zip, TypeDOCX, true},
		"/f.zip":    {"application/octet-stream", zip, "application/zip", false},
		"/sniffed":  {"", "<!DOCTYPE html><html><body>x</body></html>", TypeHTML, true},
		"/notes.md": {"", "# heading\n", TypeMarkdown, true},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := cases[r.URL.Path]
		w.Header()["Content-Type"] = []string{c.ct}
		if c.ct == "" {
			w.Header()["Content-Type"] = nil
		}
		_, _ = w.Write([]byte(c.body))
	}))
	defer srv.Close()
	f := privateFetcher(FetcherConfig{})
	for path, c := range cases {
		p, err := f.Fetch(context.Background(), srv.URL+path)
		if c.ok {
			if err != nil || p.ContentType != c.want || string(p.Body) != c.body {
				t.Errorf("%s: %q %v", path, p.ContentType, err)
			}
			continue
		}
		if !errors.Is(err, ErrUnsupportedContent) || p.Status != 200 || p.ContentType != c.want || p.Body != nil {
			t.Errorf("%s: page=%+v err=%v", path, p, err)
		}
	}
}

func TestBodyTruncation(t *testing.T) {
	big := strings.Repeat("x", 1000)
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	_, _ = zw.Write([]byte(strings.Repeat("y", 1<<20)))
	_ = zw.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		switch r.URL.Path {
		case "/big":
			_, _ = w.Write([]byte(big))
		case "/exact":
			_, _ = w.Write([]byte(big[:100]))
		case "/gzip":
			if r.Header.Get("Accept-Encoding") != "gzip" {
				t.Errorf("accept-encoding %q", r.Header.Get("Accept-Encoding"))
			}
			w.Header().Set("Content-Encoding", "gzip")
			_, _ = w.Write(gz.Bytes())
		case "/smallgzip":
			w.Header().Set("Content-Encoding", "gzip")
			var b bytes.Buffer
			zw := gzip.NewWriter(&b)
			_, _ = zw.Write([]byte("tiny"))
			_ = zw.Close()
			_, _ = w.Write(b.Bytes())
		case "/br":
			w.Header().Set("Content-Encoding", "br")
			_, _ = w.Write([]byte("zz"))
		}
	}))
	defer srv.Close()
	f := privateFetcher(FetcherConfig{MaxBodyBytes: 100})
	for path, want := range map[string]struct {
		n         int
		truncated bool
	}{"/big": {100, true}, "/exact": {100, false}, "/gzip": {100, true}, "/smallgzip": {4, false}} {
		p, err := f.Fetch(context.Background(), srv.URL+path)
		if err != nil || len(p.Body) != want.n || p.Truncated != want.truncated {
			t.Errorf("%s: len=%d truncated=%v err=%v", path, len(p.Body), p.Truncated, err)
		}
	}
	if _, err := f.Fetch(context.Background(), srv.URL+"/br"); err == nil {
		t.Error("unsupported encoding accepted")
	}
	// Default cap is 20 MiB.
	if NewFetcher(FetcherConfig{}).cfg.MaxBodyBytes != 20<<20 {
		t.Error("default MaxBodyBytes")
	}
}

func TestTimeoutAndCancellation(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()
	defer close(release)
	f := privateFetcher(FetcherConfig{Timeout: 100 * time.Millisecond})
	start := time.Now()
	if _, err := f.Fetch(context.Background(), srv.URL+"/"); err == nil || time.Since(start) > 5*time.Second {
		t.Fatalf("timeout: %v after %v", err, time.Since(start))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.Fetch(ctx, srv.URL+"/"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
}

func TestFetcherPacesEveryRequest(t *testing.T) {
	var mu sync.Mutex
	var times []time.Time
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		times = append(times, time.Now())
		mu.Unlock()
		if r.URL.Path == "/r" {
			http.Redirect(w, r, "/ok", http.StatusFound)
			return
		}
		if r.URL.Path == "/robots.txt" {
			http.NotFound(w, r)
			return
		}
		textHandler("text/plain", "ok")(w, r)
	}))
	defer srv.Close()
	const interval = 60 * time.Millisecond
	rec := &recordingPacer{Pacer: NewLocalPacer(interval)}
	f := privateFetcher(FetcherConfig{Pacer: rec, RespectRobots: true})
	for i := 0; i < 2; i++ {
		if _, err := f.Fetch(context.Background(), srv.URL+"/r"); err != nil {
			t.Fatal(err)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	// robots once (cached) + 2 x (redirect + target).
	if len(times) != 5 || int(rec.n.Load()) != 5 {
		t.Fatalf("requests=%d pacer calls=%d", len(times), rec.n.Load())
	}
	for i := 1; i < len(times); i++ {
		if gap := times[i].Sub(times[i-1]); gap < interval/2 { // scheduler slack on loaded -race runs; unpaced gaps are near 0
			t.Fatalf("gap %d = %v < %v", i, gap, interval)
		}
	}
	wantOrigin := "http://" + srv.Listener.Addr().String()
	if rec.last.Load().(string) != wantOrigin {
		t.Fatalf("origin %q want %q", rec.last.Load(), wantOrigin)
	}
	// Pacer errors stop the request.
	f = privateFetcher(FetcherConfig{Pacer: failingPacer{}})
	if _, err := f.Fetch(context.Background(), srv.URL+"/ok"); !errors.Is(err, errPacer) {
		t.Fatalf("pacer error: %v", err)
	}
}

type recordingPacer struct {
	Pacer
	n    atomic.Int32
	last atomic.Value
}

func (p *recordingPacer) Wait(ctx context.Context, origin string) error {
	p.n.Add(1)
	p.last.Store(origin)
	return p.Pacer.Wait(ctx, origin)
}

var errPacer = errors.New("pacer down")

type failingPacer struct{}

func (failingPacer) Wait(context.Context, string) error { return errPacer }

func TestProxyEnvironmentIgnored(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	f := NewFetcher(FetcherConfig{})
	if f.transport.Proxy != nil || f.transport.TLSClientConfig.InsecureSkipVerify || f.transport.TLSClientConfig.MinVersion < 0x0303 {
		t.Fatal("unsafe proxy or TLS configuration")
	}
	srv := httptest.NewServer(textHandler("text/plain", "direct"))
	defer srv.Close()
	p, err := privateFetcher(FetcherConfig{}).Fetch(context.Background(), srv.URL)
	if err != nil || string(p.Body) != "direct" {
		t.Fatalf("proxy used? %+v %v", p, err)
	}
}

// BlocksPattern (AD-08): allowlist entries the guard would never fetch.
func TestBlocksPattern(t *testing.T) {
	f := NewFetcher(FetcherConfig{})
	for _, p := range []string{"10.0.0.1", "169.254.169.254", "127.0.0.1", "192.168.1.1", "100.64.0.1", "0177.0.0.1", "0x7f.0.0.1", "127.1"} {
		if !f.BlocksPattern(p) {
			t.Errorf("%s not blocked", p)
		}
	}
	for _, p := range []string{"8.8.8.8", "example.edu", "*.example.edu", "*", "1.example.edu"} {
		if f.BlocksPattern(p) {
			t.Errorf("%s blocked", p)
		}
	}
	if NewFetcher(FetcherConfig{AllowPrivateForTests: true}).BlocksPattern("127.0.0.1") {
		t.Error("blocked with AllowPrivateForTests")
	}
}
