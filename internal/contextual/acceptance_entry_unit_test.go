package contextual

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/ncecere/grounded/internal/gateway"
)

func acceptanceTestGrant(t *testing.T) acceptanceGrant {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	return acceptanceGrant{ID: uuid.NewString(), Purpose: acceptancePurpose, DevelopmentOnly: true,
		SourceSHA: strings.Repeat("a", 40), CorpusSHA256: acceptanceCorpusSHA256(), Expires: time.Now().Add(time.Hour),
		KeyFile: filepath.Join(dir, "key"), ReportFile: filepath.Join(dir, "report"),
		Config: acceptanceConfig{Endpoint: "https://gateway.example.edu/v1", Currency: "USD", Dimensions: 8, ContextWindow: 32000, Seconds: 120, Limits: fakeAcceptanceLimits()}}
}

func acceptanceTestSource(context.Context) (string, error) { return strings.Repeat("a", 40), nil }

func TestAcceptanceGrantValidation(t *testing.T) {
	changes := map[string]func(*acceptanceGrant){
		"expired":     func(g *acceptanceGrant) { g.Expires = time.Now().Add(-time.Second) },
		"source":      func(g *acceptanceGrant) { g.SourceSHA = strings.Repeat("b", 40) },
		"corpus":      func(g *acceptanceGrant) { g.CorpusSHA256 = "bad" },
		"purpose":     func(g *acceptanceGrant) { g.Purpose = "other" },
		"development": func(g *acceptanceGrant) { g.DevelopmentOnly = false },
		"http":        func(g *acceptanceGrant) { g.Config.Endpoint = "http://example.edu" },
		"userinfo":    func(g *acceptanceGrant) { g.Config.Endpoint = "https://key@example.edu" },
		"query":       func(g *acceptanceGrant) { g.Config.Endpoint += "?secret=x" },
		"currency":    func(g *acceptanceGrant) { g.Config.Currency = "EUR" },
		"exponent":    func(g *acceptanceGrant) { g.Config.Limits.Amount = "1e0" },
		"huge":        func(g *acceptanceGrant) { g.Config.Limits.InputPrice = strings.Repeat("9", 100) },
		"cap":         func(g *acceptanceGrant) { g.Config.Limits.Amount = "5" },
		"traversal":   func(g *acceptanceGrant) { g.ReportFile += "/../escape" },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			g := acceptanceTestGrant(t)
			change(&g)
			if validateAcceptanceGrant(t.Context(), g, acceptanceTestSource, time.Now(), false) == nil {
				t.Fatal("invalid grant accepted")
			}
		})
	}
	g := acceptanceTestGrant(t)
	if err := validateAcceptanceGrant(t.Context(), g, acceptanceTestSource, time.Now(), false); err != nil {
		t.Fatal(err)
	}
}

func TestAcceptancePrivateFiles(t *testing.T) {
	g := acceptanceTestGrant(t)
	if err := acceptanceWritePrivate(g.KeyFile, []byte("canary")); err != nil {
		t.Fatal(err)
	}
	if acceptanceWritePrivate(g.KeyFile, []byte("overwrite")) == nil {
		t.Fatal("overwrite")
	}
	if err := os.Symlink(g.KeyFile, g.ReportFile); err != nil {
		t.Fatal(err)
	}
	if _, err := acceptanceReadPrivate(g.ReportFile, 100); err == nil {
		t.Fatal("symlink")
	}
	if err := os.Chmod(g.KeyFile, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := acceptanceReadPrivate(g.KeyFile, 100); err == nil {
		t.Fatal("public key")
	}
	if _, err := loadAcceptanceGrant("/missing"); err == nil {
		t.Fatal("missing")
	}
}

func TestAcceptanceStrictGrantJSON(t *testing.T) {
	for _, data := range []string{`{"ID":"a","ID":"b"}`, `{"unknown":1}`, `{} {}`, strings.Repeat(" ", 16385)} {
		g := acceptanceTestGrant(t)
		if err := acceptanceWritePrivate(g.KeyFile, []byte(data)); err != nil {
			t.Fatal(err)
		}
		if _, err := loadAcceptanceGrant(g.KeyFile); err == nil {
			t.Fatal("invalid JSON accepted")
		}
	}
}

func TestAcceptanceLedgerSingleUseAndAggregate(t *testing.T) {
	root := filepath.Join(t.TempDir(), "state")
	g := acceptanceTestGrant(t)
	g.Config.Limits.Amount = "2"
	if err := claimAcceptance(root, g); err != nil {
		t.Fatal(err)
	}
	if claimAcceptance(root, g) == nil {
		t.Fatal("copied/reused grant accepted")
	}
	g.ID = uuid.NewString()
	if err := claimAcceptance(root, g); err != nil {
		t.Fatal(err)
	}
	g.ID = uuid.NewString()
	g.Config.Limits.Amount = "1"
	if claimAcceptance(root, g) == nil {
		t.Fatal("aggregate reached five")
	}
}

func TestAcceptanceConcurrentClaim(t *testing.T) {
	root := filepath.Join(t.TempDir(), "state")
	g := acceptanceTestGrant(t)
	var successes atomic.Int32
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			if claimAcceptance(root, g) == nil {
				successes.Add(1)
			}
		})
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatalf("claims=%d", successes.Load())
	}
}

func TestAcceptanceEntryFakeReports(t *testing.T) {
	if os.Getenv("GROUNDED_TEST_DATABASE_URL") == "" {
		t.Skip("fake entry integration requires disposable PG")
	}
	for _, failure := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "remote429"}[failure], func(t *testing.T) {
			proxy, config := fakeAcceptanceConfig(t)
			proxy.SetContextReply(func(string) string { return "Synthetic prefix " + proxy.APIKey })
			if failure {
				proxy.FailContextWith(429)
			}
			g := acceptanceTestGrant(t)
			g.Config = config
			if err := acceptanceWritePrivate(g.KeyFile, []byte(proxy.APIKey)); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(filepath.Dir(g.KeyFile), "grant.json")
			data, _ := json.Marshal(g)
			if err := acceptanceWritePrivate(path, data); err != nil {
				t.Fatal(err)
			}
			deps := acceptanceEntryDeps{root: filepath.Join(t.TempDir(), "state"), source: acceptanceTestSource, testLoopback: true}
			err := executeAcceptanceEntry(t, path, deps)
			if (err != nil) != failure {
				t.Fatalf("entry result=%v", err)
			}
			raw, err := acceptanceReadPrivate(g.ReportFile, 1<<20)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), proxy.APIKey) || strings.Contains(string(raw), g.KeyFile) {
				t.Fatal("private data leaked")
			}
			var report acceptancePrivateReport
			if json.Unmarshal(raw, &report) != nil || report.Report.Mode != "fake" || report.OuterCleanup != "pending_outer_receipt" {
				t.Fatal("report")
			}
			if failure && (report.Report.UnknownContextCalls != 1 || report.FailureCode != "harness_failed") {
				t.Fatal("lost uncertain attempt")
			}
			if executeAcceptanceEntry(t, path, deps) == nil {
				t.Fatal("duplicate count accepted")
			}
		})
	}
}

func TestAcceptanceDispatchChecks(t *testing.T) {
	proxy, config := fakeAcceptanceConfig(t)
	run, err := newAcceptanceRun(t, config, proxy.APIKey, "fake")
	if err != nil {
		t.Fatal(err)
	}
	run.guard.check = func() error { return context.Canceled }
	if _, err = run.execute(t.Context()); err == nil {
		t.Fatal("dispatch check ignored")
	}
	if len(proxy.ContextCalls()) != 0 {
		t.Fatal("dispatch check reached HTTP")
	}
}

func TestAcceptanceEntryRefusesBeforeHTTP(t *testing.T) {
	for _, kind := range []string{"expiry", "source", "dirty", "corpus", "model", "endpoint", "bounds", "key", "permissions", "symlink", "unsupported"} {
		t.Run(kind, func(t *testing.T) {
			proxy, config := fakeAcceptanceConfig(t)
			g := acceptanceTestGrant(t)
			g.Config = config
			source := acceptanceTestSource
			switch kind {
			case "expiry":
				g.Expires = time.Now().Add(-time.Minute)
			case "source":
				g.SourceSHA = strings.Repeat("b", 40)
			case "dirty":
				source = func(context.Context) (string, error) { return "", context.Canceled }
			case "corpus":
				g.CorpusSHA256 = "wrong"
			case "model":
				g.Config.Limits.ContextModel = ""
			case "endpoint":
				g.Config.Endpoint = "http://other.example.edu"
			case "bounds":
				g.Config.Limits.Requests = 1
			}
			if kind != "key" {
				if err := acceptanceWritePrivate(g.KeyFile, []byte(proxy.APIKey)); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "permissions" {
				if err := os.Chmod(g.KeyFile, 0644); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "symlink" {
				original := g.KeyFile
				g.KeyFile += "-link"
				if err := os.Symlink(original, g.KeyFile); err != nil {
					t.Fatal(err)
				}
			}
			path := filepath.Join(filepath.Dir(g.ReportFile), "grant")
			data, _ := json.Marshal(g)
			if kind == "unsupported" {
				data = append(data[:len(data)-1], []byte(`,"Mode":"alternate"}`)...)
			}
			if err := acceptanceWritePrivate(path, data); err != nil {
				t.Fatal(err)
			}
			if executeAcceptanceEntry(t, path, acceptanceEntryDeps{root: filepath.Join(t.TempDir(), "state"), source: source, testLoopback: true}) == nil {
				t.Fatal("invalid authority accepted")
			}
			if len(proxy.ContextCalls()) != 0 || proxy.EmbedRequestsFor(config.Limits.EmbeddingModel) != 0 {
				t.Fatal("invalid authority reached HTTP")
			}
		})
	}
}

func TestAcceptanceDispatchExpirySourceCancellation(t *testing.T) {
	for _, kind := range []string{"expiry", "source", "cancellation"} {
		t.Run(kind, func(t *testing.T) {
			g := acceptanceTestGrant(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			now := time.Now()
			if kind == "expiry" {
				now = g.Expires
			}
			if kind == "source" {
				g.SourceSHA = strings.Repeat("b", 40)
			}
			if kind == "cancellation" {
				cancel()
			}
			if acceptanceDispatchCheck(ctx, g, acceptanceTestSource, now) == nil {
				t.Fatal("dispatch accepted")
			}
		})
	}
}

func TestAcceptanceNoCredentialRedirect(t *testing.T) {
	var received atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { received.Add(1) }))
	defer destination.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	config := acceptanceConfig{Endpoint: server.URL, Seconds: 10, Limits: fakeAcceptanceLimits()}
	guard, err := newAcceptanceTransport(config.Endpoint, config.Limits, counter(t))
	if err != nil {
		t.Fatal(err)
	}
	client := acceptanceClient(config, "secret-canary", guard)
	defer client.HTTP.CloseIdleConnections()
	_, err = client.Embed(t.Context(), gateway.EmbedRequest{Model: config.Limits.EmbeddingModel, Input: []string{"synthetic"}})
	if err == nil || received.Load() != 0 {
		t.Fatal("credential-bearing redirect followed")
	}
}

func TestAcceptanceActualCleanSourceCheck(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	for _, args := range [][]string{{"init", "-q"}, {"-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.edu", "commit", "--allow-empty", "-qm", "synthetic"}} {
		if err := exec.Command("git", args...).Run(); err != nil {
			t.Fatal(err)
		}
	}
	sha, err := acceptanceSource(t.Context())
	if err != nil || !acceptanceSHA.MatchString(sha) {
		t.Fatal("clean source refused")
	}
	if err := os.WriteFile(filepath.Join(dir, "dirty"), []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := acceptanceSource(t.Context()); err == nil {
		t.Fatal("dirty source accepted")
	}
}
