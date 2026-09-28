package crawl

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type robotsServer struct {
	*httptest.Server
	robotsHits atomic.Int32
	mu         sync.Mutex
	status     int
	rules      string
	robotsUA   string
}

func newRobotsServer(t *testing.T, status int, rules string) *robotsServer {
	rs := &robotsServer{status: status, rules: rules}
	rs.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/robots.txt":
			rs.robotsHits.Add(1)
			rs.mu.Lock()
			rs.robotsUA = r.UserAgent()
			status, rules := rs.status, rs.rules
			rs.mu.Unlock()
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(status)
			_, _ = w.Write([]byte(rules))
		case "/redirect-to-private":
			http.Redirect(w, r, "/private/x", http.StatusFound)
		default:
			textHandler("text/html", "<p>page</p>")(w, r)
		}
	}))
	t.Cleanup(rs.Close)
	return rs
}

func TestRobotsRulesAndUserAgentMatching(t *testing.T) {
	// Ported from yoink's TestRobots, with our product token.
	rules := "User-agent: *\nDisallow: /all\n\nUser-agent: grounded\nDisallow: /private\nAllow: /private/public\nDisallow: /*?secret=*\n"
	rs := newRobotsServer(t, 200, rules)
	f := privateFetcher(FetcherConfig{UserAgent: "grounded/1.0 (+https://rag.example.edu/bot)", RespectRobots: true})
	for _, tt := range []struct {
		path string
		want bool
	}{{"/private", false}, {"/private/x", false}, {"/private/public", true}, {"/all", true}, {"/anything?secret=1", false}, {"/okay", true}} {
		_, err := f.Fetch(context.Background(), rs.URL+tt.path)
		if got := !errors.Is(err, ErrRobotsDisallowed); got != tt.want || (tt.want && err != nil) {
			t.Errorf("%s: err=%v want allowed=%v", tt.path, err, tt.want)
		}
		if ok, err := f.Allowed(context.Background(), rs.URL+tt.path); ok != tt.want || err != nil {
			t.Errorf("Allowed(%s)=%v %v", tt.path, ok, err)
		}
	}
	rs.mu.Lock()
	if rs.robotsUA != "grounded/1.0 (+https://rag.example.edu/bot)" {
		t.Errorf("robots UA %q", rs.robotsUA)
	}
	rs.mu.Unlock()
	// Cached: one robots.txt request for all of the above.
	if n := rs.robotsHits.Load(); n != 1 {
		t.Fatalf("robots fetched %d times", n)
	}
	// Other agents fall back to "*".
	g := privateFetcher(FetcherConfig{UserAgent: "otherbot/2", RespectRobots: true})
	if _, err := g.Fetch(context.Background(), rs.URL+"/all"); !errors.Is(err, ErrRobotsDisallowed) {
		t.Errorf("* group not applied: %v", err)
	}
	if _, err := g.Fetch(context.Background(), rs.URL+"/private"); err != nil {
		t.Errorf("grounded group applied to otherbot: %v", err)
	}
	// Redirect into a disallowed path is checked per hop.
	if _, err := f.Fetch(context.Background(), rs.URL+"/redirect-to-private"); !errors.Is(err, ErrRobotsDisallowed) {
		t.Errorf("redirect bypassed robots: %v", err)
	}
	// RespectRobots=false ignores robots entirely.
	h := privateFetcher(FetcherConfig{})
	if _, err := h.Fetch(context.Background(), rs.URL+"/private"); err != nil {
		t.Errorf("robots applied when disabled: %v", err)
	}
}

func TestRobotsStatusHandling(t *testing.T) {
	for _, tt := range []struct {
		status  int
		body    string
		allowed bool
	}{
		{404, "", true}, {410, "", true}, {400, "", true},
		{401, "", false}, {403, "", false}, {429, "", false}, {500, "", false}, {503, "", false},
		{200, "<!doctype html><html><body>Not found</body></html>", true},
		{200, "", true},
		{200, "User-agent: *\nDisallow: /\n" + strings.Repeat("# pad\n", 200000), false}, // > 512 KiB still parsed
	} {
		rs := newRobotsServer(t, tt.status, tt.body)
		f := privateFetcher(FetcherConfig{RespectRobots: true})
		_, err := f.Fetch(context.Background(), rs.URL+"/page")
		if allowed := err == nil; allowed != tt.allowed || (!allowed && !errors.Is(err, ErrRobotsDisallowed)) {
			t.Errorf("status %d body %.20q: err=%v want allowed=%v", tt.status, tt.body, err, tt.allowed)
		}
	}
}

func TestRobotsCacheExpiryAndConcurrency(t *testing.T) {
	rs := newRobotsServer(t, 200, "User-agent: *\nDisallow: /private\n")
	f := privateFetcher(FetcherConfig{RespectRobots: true})
	var nowMu sync.Mutex
	now := time.Now()
	f.now = func() time.Time { nowMu.Lock(); defer nowMu.Unlock(); return now }
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ok, err := f.Allowed(context.Background(), rs.URL+"/private"); ok || err != nil {
				t.Errorf("concurrent: %v %v", ok, err)
			}
		}()
	}
	wg.Wait()
	if n := rs.robotsHits.Load(); n != 1 {
		t.Fatalf("concurrent callers fetched robots %d times", n)
	}
	rs.mu.Lock()
	rs.rules = "User-agent: *\nDisallow:\n"
	rs.mu.Unlock()
	nowMu.Lock()
	now = now.Add(59 * time.Minute)
	nowMu.Unlock()
	if ok, _ := f.Allowed(context.Background(), rs.URL+"/private"); ok || rs.robotsHits.Load() != 1 {
		t.Fatal("cache not used within 1h")
	}
	nowMu.Lock()
	now = now.Add(2 * time.Minute)
	nowMu.Unlock()
	if ok, _ := f.Allowed(context.Background(), rs.URL+"/private"); !ok || rs.robotsHits.Load() != 2 {
		t.Fatalf("cache not refreshed after 1h (hits=%d)", rs.robotsHits.Load())
	}
	// Failures are cached briefly (1 min), not for an hour.
	rs2 := newRobotsServer(t, 503, "")
	if ok, _ := f.Allowed(context.Background(), rs2.URL+"/x"); ok {
		t.Fatal("503 robots allowed")
	}
	rs2.mu.Lock()
	rs2.status = 404
	rs2.mu.Unlock()
	nowMu.Lock()
	now = now.Add(61 * time.Second)
	nowMu.Unlock()
	if ok, _ := f.Allowed(context.Background(), rs2.URL+"/x"); !ok || rs2.robotsHits.Load() != 2 {
		t.Fatal("robots failure cached too long")
	}
}

func TestRobotsCancelledLoaderDoesNotPoisonCache(t *testing.T) {
	rs := newRobotsServer(t, 404, "")
	f := privateFetcher(FetcherConfig{RespectRobots: true})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.Fetch(ctx, rs.URL+"/x"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled: %v", err)
	}
	if _, err := f.Fetch(context.Background(), rs.URL+"/x"); err != nil {
		t.Fatalf("after cancelled loader: %v", err)
	}
}

func TestProductToken(t *testing.T) {
	for ua, want := range map[string]string{"grounded/1.0 (+https://rag.example.edu/bot)": "grounded", "GroundeD": "grounded", "my bot": "my", "": "grounded"} {
		if got := productToken(ua); got != want {
			t.Errorf("productToken(%q)=%q", ua, got)
		}
	}
}
