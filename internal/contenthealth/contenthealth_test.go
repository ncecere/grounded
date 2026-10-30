package contenthealth

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// The age of a document, and the one second either side of the threshold.
func TestStaleThresholdBoundary(t *testing.T) {
	asOf := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	for _, days := range []int{MinStaleDays, 365, MaxStaleDays} {
		cutoff := StaleCutoff(asOf, days)
		if want := asOf.Add(-time.Duration(days) * 24 * time.Hour); !cutoff.Equal(want) {
			t.Errorf("cutoff for %d days = %v, want %v", days, cutoff, want)
		}
		// The query keeps a document processed at or before the cutoff: exactly `days` old is stale, a second newer is not.
		if got := ageDays(asOf, cutoff); got != int64(days) {
			t.Errorf("a document processed exactly %d days ago is %d days old", days, got)
		}
		if got := ageDays(asOf, cutoff.Add(time.Second)); got != int64(days)-1 {
			t.Errorf("a document a second newer than %d days is %d days old, want %d", days, got, days-1)
		}
	}
}

func TestCreateInputBounds(t *testing.T) {
	ok := func(in CreateInput) bool { _, err := in.validate(); return err == nil }
	cases := []struct {
		name string
		in   CreateInput
		ok   bool
	}{
		{"defaults", CreateInput{}, true},
		{"stale min", CreateInput{StaleDays: MinStaleDays}, true}, {"below stale min", CreateInput{StaleDays: MinStaleDays - 1}, false},
		{"stale max", CreateInput{StaleDays: MaxStaleDays}, true}, {"above stale max", CreateInput{StaleDays: MaxStaleDays + 1}, false},
		{"window min", CreateInput{CitationWindowDays: MinCitationWindowDays}, true}, {"below window min", CreateInput{CitationWindowDays: MinCitationWindowDays - 1}, false},
		{"window max", CreateInput{CitationWindowDays: MaxCitationWindowDays}, true}, {"above window max", CreateInput{CitationWindowDays: MaxCitationWindowDays + 1}, false},
		{"negative", CreateInput{StaleDays: -1}, false},
	}
	for _, c := range cases {
		if got := ok(c.in); got != c.ok {
			t.Errorf("%s: accepted = %v, want %v", c.name, got, c.ok)
		}
	}
	in, _ := CreateInput{}.validate()
	if in.StaleDays != DefaultStaleDays || in.CitationWindowDays != DefaultCitationWindowDays {
		t.Errorf("defaults = %d and %d days", in.StaleDays, in.CitationWindowDays)
	}
}

// A failed link is a kind, never the error's own text.
func TestLinkCode(t *testing.T) {
	for reason, want := range map[string]string{
		"not_found": LinkNotFound, "http_error": LinkHTTPError,
		`Get "https://example.edu/": dial tcp: lookup example.edu: no such host`: LinkNetworkError, "": LinkNetworkError,
	} {
		if got := linkCode(reason); got != want {
			t.Errorf("linkCode(%q) = %q, want %q", reason, got, want)
		}
	}
}

// The registry is the five signals of the design. No PII signal exists until its own decision (#37): the hook is the Signal
// interface and the free signal name in findings, not a detector.
func TestRegistryIsTheFiveSignals(t *testing.T) {
	var names []string
	for _, s := range Registry() {
		names = append(names, s.Name())
		if len(s.Name()) == 0 || len(s.Name()) > 32 || strings.Contains(strings.ToLower(s.Name()), "pii") {
			t.Errorf("unexpected signal name %q", s.Name())
		}
	}
	want := []string{SignalStale, SignalBrokenLink, SignalDuplicate, SignalNeverCited, SignalIngestionFailure}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Errorf("registry = %v, want %v", names, want)
	}
}

func imports(t *testing.T, path string) []string {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, im := range f.Imports {
		out = append(out, strings.Trim(im.Path.Value, `"`))
	}
	return out
}

// The package's own files import no network client, crawler, model, retrieval or answering package. This is about what the
// package imports directly: other packages it uses (teams, through webhooks, reaches net/http) are not checked here, and the
// absence of calls is shown by TestReportMakesNoHTTPRequestsAndCallsNoModel, not by this test.
func TestPackageMakesNoNetworkCallsAndImportsNoQueryPath(t *testing.T) {
	// net/url only parses an address (sanitizeURL); it dials nothing. net and net/http are what would.
	forbidden := []string{"net/http", "net", "/internal/crawl", "/internal/web", "/internal/gateway", "/internal/llm",
		"/internal/catalog", "/internal/agents", "/internal/agentloop", "/internal/kbs", "/internal/search", "/internal/vectorstore", "/internal/rerank",
		"/internal/systemone", "/internal/httpx", "/internal/mcpclient", "/internal/ocr", "/internal/parse", "/internal/ingest", "/internal/answercache",
		"/internal/webhooks", "/internal/notify"}
	files, _ := filepath.Glob("*.go")
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		for _, imp := range imports(t, file) {
			for _, bad := range forbidden {
				if imp == bad || (strings.HasPrefix(bad, "/") && strings.HasSuffix(imp, bad)) {
					t.Errorf("%s imports %s: a report makes no network call and stays off the query path", file, imp)
				}
			}
		}
	}
}

// Nothing on the question path (retrieval, answering, ingestion, crawling) imports the report: it is wired in only by the
// application and the HTTP layer.
func TestNothingOnTheQueryPathImportsTheReport(t *testing.T) {
	allowed := map[string]bool{"contenthealth": true, "app": true, "httpapi": true}
	root := filepath.Join("..", "..", "internal")
	cmds := filepath.Join("..", "..", "cmd")
	for _, dir := range []string{root, cmds} {
		err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return err
			}
			for _, imp := range imports(t, path) {
				if strings.HasSuffix(imp, "/internal/contenthealth") {
					pkg := filepath.Base(filepath.Dir(path))
					if !allowed[pkg] {
						t.Errorf("%s imports contenthealth: the query path must not depend on it", path)
					}
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

// Expand only (ADR-0013): the migration creates tables and indexes and seeds its own switch row; it alters, updates, deletes
// from and drops nothing that already exists, so the previous release runs on the new schema and the new on the old.
func TestMigrationOnlyCreates(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "migrations", "00058_content_health.sql"))
	if err != nil {
		t.Fatal(err)
	}
	up := string(raw)
	up = up[strings.Index(up, "-- +goose Up"):strings.Index(up, "-- +goose Down")]
	var sql []string
	for _, line := range strings.Split(up, "\n") {
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		sql = append(sql, line)
	}
	stmt := regexp.MustCompile(`(?im)^\s*(ALTER|UPDATE|DELETE|DROP|TRUNCATE|INSERT|CREATE)\s+(\w+)(\s+\w+)?(\s+\w+)?`)
	for _, m := range stmt.FindAllStringSubmatch(strings.Join(sql, "\n"), -1) {
		switch verb := strings.ToUpper(m[1]); verb {
		case "CREATE":
			if kind := strings.ToUpper(m[2]); kind != "TABLE" && kind != "INDEX" && !(kind == "UNIQUE" && strings.EqualFold(strings.TrimSpace(m[3]), "INDEX")) {
				t.Errorf("the migration creates a %s", m[0])
			}
		case "INSERT":
			if !strings.Contains(strings.ToLower(m[0]), "content_health_settings") {
				t.Errorf("the migration inserts into something other than its own switch: %s", m[0])
			}
		default:
			t.Errorf("the migration contains %s: it must only create", m[0])
		}
	}
	if strings.Contains(strings.ToLower(strings.Join(sql, "\n")), "alter table") {
		t.Error("the migration alters a table")
	}
	if !strings.Contains(strings.ToLower(up), "enabled    boolean     not null default false") {
		t.Error("the switch is not off by default")
	}
}
