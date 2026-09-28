package demo_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/app"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/demo"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/teams"
	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/internal/web"
)

// docSite stands in for go.dev: a /doc/ section with links, a page outside
// it that the crawl must not reach, and a robots.txt allowing everything.
type docSite struct {
	*httptest.Server
	mu   sync.Mutex
	hits map[string]int
}

var docPages = map[string]string{
	"/doc/": `<h1>Documentation</h1><p>The Go programming language is an open source project.</p>
<ul><li><a href="/doc/install">Download and install</a></li><li><a href="/doc/tutorial/getting-started">Tutorial</a></li>
<li><a href="/blog/news">Blog</a></li></ul>`,
	"/doc/install": `<h1>Download and install</h1><p>Download and install Go quickly with the steps described here.
Open the package file you downloaded and follow the prompts to install the Go toolchain.</p>`,
	"/doc/tutorial/getting-started": `<h1>Tutorial: Get started with Go</h1><p>In this tutorial you get a brief introduction
to Go programming: install Go, write some simple Hello, world code and use the go command to run it.</p>`,
	"/blog/news": `<h1>News</h1><p>Outside the documentation.</p>`,
}

func newDocSite(t *testing.T) *docSite {
	s := &docSite{hits: map[string]int{}}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.hits[r.URL.Path]++
		s.mu.Unlock()
		if r.URL.Path == "/robots.txt" {
			fmt.Fprint(w, "User-agent: *\nAllow: /\n")
			return
		}
		body, ok := docPages[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, "<!DOCTYPE html><html><head><title>%s</title></head><body><main>%s</main></body></html>",
			strings.TrimPrefix(r.URL.Path, "/"), body)
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *docSite) hit(path string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits[path]
}

type env struct {
	t    *testing.T
	pool *pgxpool.Pool
	svc  *app.Services
	cfg  config.Config
	site *docSite
	fake *httptest.Server
}

func newEnv(t *testing.T) *env {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	kvs := testutil.NewKV(t)
	cfg := config.Defaults()
	cfg.AppURL, cfg.DevAuth = "http://localhost:8080", true
	cfg.EncryptionKey = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="
	cfg.APIKeyPepper = "cGVwcGVycGVwcGVycGVwcGVycGVwcGVycGVwcGVyISE="
	cfg.BlobDir = t.TempDir()
	cfg.Crawl.AllowPrivateAddressesForTests = true
	cfg.Crawl.OriginInterval = 100 * time.Millisecond
	inserter, err := jobs.NewInsertOnly(pool, testutil.Logger())
	if err != nil {
		t.Fatal(err)
	}
	svc, err := app.NewServices(context.Background(), cfg, pool, inserter, kvs, testutil.Logger())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.Close)
	fake := httptest.NewServer(demo.NewFakeModels(demo.FakeAPIKey))
	t.Cleanup(fake.Close)
	return &env{t: t, pool: pool, svc: svc, cfg: cfg, site: newDocSite(t), fake: fake}
}

func (e *env) options() demo.Options {
	return demo.Options{
		Owner:   demo.Owner{DevAuth: true},
		SiteURL: e.site.URL + "/doc/",
		Models:  demo.Models{Mode: demo.ModelsFake, FakeURL: e.fake.URL + "/v1"},
		AppURL:  e.cfg.AppURL,
	}
}

func (e *env) seed(o demo.Options) (demo.Result, error) {
	e.t.Helper()
	return demo.Seed(context.Background(), e.pool, e.svc, o)
}

// counts is the number of rows in the tables the demo writes to.
func (e *env) counts() map[string]int {
	e.t.Helper()
	out := map[string]int{}
	for _, table := range []string{"users", "teams", "team_members", "crawl_allowlist", "model_connections", "models",
		"embedding_profiles", "data_sources", "knowledge_bases", "agents", "agent_versions"} {
		var n int
		if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil {
			e.t.Fatal(err)
		}
		out[table] = n
	}
	return out
}

func (e *env) startWorker() {
	e.t.Helper()
	reg, err := app.IngestRegistration(e.cfg, e.pool, e.svc, testutil.Logger())
	if err != nil {
		e.t.Fatal(err)
	}
	w, err := jobs.NewWorker(e.pool, testutil.Logger(), 4, reg)
	if err != nil {
		e.t.Fatal(err)
	}
	if err := w.Start(context.Background()); err != nil {
		e.t.Fatal(err)
	}
	e.t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = w.StopAndCancel(ctx)
	})
}

// waitIndexed waits until the crawl finished and n documents are ready.
func (e *env) waitIndexed(n int) {
	e.t.Helper()
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		var ready, crawling int
		err := e.pool.QueryRow(context.Background(), `SELECT
			(SELECT count(*) FROM documents WHERE status = 'ready'),
			(SELECT count(*) FROM web_crawls WHERE status IN ('queued', 'running'))`).Scan(&ready, &crawling)
		if err != nil {
			e.t.Fatal(err)
		}
		if ready >= n && crawling == 0 {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	e.t.Fatalf("documents not indexed in time")
}

func TestSeedEmptyInstallEndToEnd(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	res, err := e.seed(e.options())
	if err != nil {
		t.Fatal(err)
	}
	created := strings.Join(res.Created, "\n")
	for _, want := range []string{"account admin@localhost", "crawl allowlist entry 127.0.0.1", `model connection "Demo models (fake)"`,
		`chat model "Demo model (canned answers)"`, `embedding model`, `embedding profile`, "team Demo (owner admin@localhost)",
		`web source "Go documentation"`, `knowledge base "Go documentation"`, `published agent "Go docs assistant" (members of the Demo team)`,
		`published agent "Go docs (signed-in)" (everyone who signs in)`} {
		if !strings.Contains(created, want) {
			t.Errorf("created lacks %q:\n%s", want, created)
		}
	}
	if res.OwnerEmail != "admin@localhost" || !res.FakeModels || len(res.Agents) != 2 ||
		res.Agents[0].URL != "http://localhost:8080/a/demo/go-docs" || res.Agents[1].URL != "http://localhost:8080/a/demo/go-docs-signed-in" {
		t.Fatalf("result = %+v", res)
	}
	checkSeeded(t, e)

	// A second run adds nothing.
	before := e.counts()
	again, err := e.seed(e.options())
	if err != nil || len(again.Created) != 0 || len(again.Agents) != 2 {
		t.Fatalf("second run = %+v, %v", again, err)
	}
	if after := e.counts(); fmt.Sprint(after) != fmt.Sprint(before) {
		t.Fatalf("second run changed counts:\n%v\n%v", before, after)
	}

	// The worker crawls the site (only /doc/) and the agent answers with
	// the fake model, citing the indexed pages.
	e.startWorker()
	e.waitIndexed(3)
	if e.site.hit("/blog/news") != 0 {
		t.Error("the crawl left /doc/")
	}
	var owner uuid.UUID
	if err := e.pool.QueryRow(ctx, "SELECT id FROM users WHERE email = 'admin@localhost'").Scan(&owner); err != nil {
		t.Fatal(err)
	}
	ans, err := e.svc.Agents.Chat(ctx, authz.Actor{UserID: owner}, agents.ChatRequest{
		TeamRef: demo.TeamSlug, AgentRef: "go-docs", Message: "How do I download and install Go?", Channel: "ui",
	}, func(agents.Event) {})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ans.Text, demo.FakeLabel) || !strings.Contains(ans.Text, "Download and install") || len(ans.Citations) == 0 {
		t.Fatalf("answer = %q (citations %d)", ans.Text, len(ans.Citations))
	}
}

// checkSeeded checks the objects a first run leaves.
func checkSeeded(t *testing.T, e *env) {
	t.Helper()
	ctx := context.Background()
	var issuer, role, memberRole string
	if err := e.pool.QueryRow(ctx, `SELECT u.oidc_issuer, u.platform_role, m.role FROM users u
		JOIN team_members m ON m.user_id = u.id JOIN teams t ON t.id = m.team_id
		WHERE u.email = 'admin@localhost' AND t.slug = 'demo'`).Scan(&issuer, &role, &memberRole); err != nil {
		t.Fatal(err)
	}
	// The persona gets its platform role at its first sign-in, as usual.
	if issuer != "grounded:development" || role != "none" || memberRole != "owner" {
		t.Errorf("owner = %s %s %s", issuer, role, memberRole)
	}
	rows, err := e.pool.Query(ctx, `SELECT a.slug, g.principal_type, a.published_version_id IS NOT NULL, a.welcome_message <> '',
		cardinality(a.starter_questions) FROM agents a JOIN agent_audience_grants g ON g.agent_id = a.id ORDER BY a.slug`)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var slug, aud string
		var published, welcome bool
		var starters int
		if err := rows.Scan(&slug, &aud, &published, &welcome, &starters); err != nil {
			t.Fatal(err)
		}
		got = append(got, fmt.Sprintf("%s:%s:%v:%v:%v", slug, aud, published, welcome, starters > 0))
	}
	if strings.Join(got, " ") != "go-docs:team:true:true:true go-docs-signed-in:all_authenticated:true:true:true" {
		t.Errorf("agents = %v", got)
	}
	// The least sensitive level allowing signed-in audiences: open.
	var raw []byte
	var sourceLevel, teamLevel, modelLevel string
	if err := e.pool.QueryRow(ctx, `SELECT s.config, s.classification, t.max_classification,
		(SELECT max_classification FROM models WHERE key = 'demo-fake-chat')
		FROM data_sources s JOIN teams t ON t.id = s.team_id WHERE s.name = 'Go documentation'`).Scan(&raw, &sourceLevel, &teamLevel, &modelLevel); err != nil {
		t.Fatal(err)
	}
	if sourceLevel != "open" || teamLevel != "open" || modelLevel != "open" {
		t.Errorf("classification: source %s, team %s, model %s; want open", sourceLevel, teamLevel, modelLevel)
	}
	cfg, err := web.Stored(raw)
	if err != nil || cfg.Mode != web.ModeCrawl || cfg.MaxDepth != 2 || cfg.MaxPages != 100 || cfg.Schedule != web.ScheduleWeekly ||
		fmt.Sprint(cfg.IncludePrefixes) != "[/doc/]" || fmt.Sprint(cfg.URLs) != "["+e.site.URL+"/doc/]" {
		t.Errorf("source config = %+v, %v", cfg, err)
	}
	var audits int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM audit_log WHERE action IN ('demo.seed', 'demo.owner_provision')").Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 2 {
		t.Errorf("demo audit entries = %d, want 2", audits)
	}
}

// adminUser creates a signed-in platform admin (as an OIDC sign-in would).
func adminUser(t *testing.T, e *env, email string) authz.Actor {
	t.Helper()
	var id uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO users (oidc_issuer, oidc_subject, email, display_name, platform_role)
		VALUES ('https://idp.example.edu', $1, $2, 'Admin', 'platform_admin') RETURNING id`, "sub-"+email, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return authz.Actor{UserID: id, PlatformRole: authz.PlatformAdmin}
}

func TestSeedRefusesNonEmptyInstallAndForce(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	admin := adminUser(t, e, "admin@example.edu")
	// An install in use: a team, and a default embedding profile.
	if _, _, err := e.svc.Teams.Create(ctx, admin, teams.CreateInput{Slug: "registrar", Name: "Registrar", MaxClassification: "open", OwnerEmail: "admin@example.edu"}); err != nil {
		t.Fatal(err)
	}
	conn, err := e.svc.Catalog.CreateConnection(ctx, admin, catalog.ConnectionInput{Name: "Gateway", BaseURL: e.fake.URL + "/v1", APIKey: demo.FakeAPIKey, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	dims := int32(demo.FakeEmbedDims)
	m, err := e.svc.Catalog.CreateModel(ctx, admin, catalog.ModelInput{ConnectionID: conn.ID, Key: "embed", Kind: catalog.KindEmbedding,
		ModelSpec: catalog.ModelSpec{UpstreamModel: demo.FakeEmbedModel, DisplayName: "Embed", MaxClassification: "open", Enabled: true, Dimensions: &dims}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Catalog.CreateProfile(ctx, admin, catalog.ProfileInput{Key: "default", Name: "Default", ModelID: m.ID}); err != nil {
		t.Fatal(err)
	}
	before := e.counts()
	o := e.options()
	o.Owner = demo.Owner{Email: "admin@example.edu"}
	if _, err := e.seed(o); !errors.Is(err, demo.ErrNotEmpty) {
		t.Fatalf("seed on a non-empty install = %v, want ErrNotEmpty", err)
	}
	if after := e.counts(); fmt.Sprint(after) != fmt.Sprint(before) {
		t.Fatalf("a refused run changed the install:\n%v\n%v", before, after)
	}

	// --force adds the Demo team (and its own profile, not the default).
	o.Force = true
	res, err := e.seed(o)
	if err != nil || len(res.Created) == 0 || res.OwnerEmail != "admin@example.edu" {
		t.Fatalf("forced seed = %+v, %v", res, err)
	}
	var defaults []string
	rows, _ := e.pool.Query(ctx, "SELECT key FROM embedding_profiles WHERE is_default")
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		defaults = append(defaults, k)
	}
	if strings.Join(defaults, ",") != "default" {
		t.Errorf("default profiles = %v, want the existing one", defaults)
	}
	var registrarRevision int64
	if err := e.pool.QueryRow(ctx, "SELECT revision FROM teams WHERE slug = 'registrar'").Scan(&registrarRevision); err != nil || registrarRevision != 1 {
		t.Errorf("existing team revision = %d, %v", registrarRevision, err)
	}
	// Running again (with or without --force) adds nothing.
	for _, force := range []bool{true, false} {
		o.Force = force
		if again, err := e.seed(o); err != nil || len(again.Created) != 0 {
			t.Fatalf("force=%v rerun = %+v, %v", force, again, err)
		}
	}
}

func TestSeedForceLeavesAnotherDemoTeamAlone(t *testing.T) {
	e := newEnv(t)
	admin := adminUser(t, e, "admin@example.edu")
	if _, _, err := e.svc.Teams.Create(context.Background(), admin, teams.CreateInput{Slug: "demo", Name: "Our demo", MaxClassification: "open", OwnerEmail: "admin@example.edu"}); err != nil {
		t.Fatal(err)
	}
	before := e.counts()
	o := e.options()
	o.Force = true
	res, err := e.seed(o)
	if err != nil || !res.Skipped || len(res.Created) != 0 {
		t.Fatalf("seed = %+v, %v", res, err)
	}
	if after := e.counts(); fmt.Sprint(after) != fmt.Sprint(before) {
		t.Fatalf("counts changed:\n%v\n%v", before, after)
	}
}

func TestSeedOwnerAndModelChecks(t *testing.T) {
	e := newEnv(t)
	o := e.options()
	for _, c := range []struct {
		name  string
		owner demo.Owner
		want  string
	}{
		{"no default owner", demo.Owner{}, "can't tell who should own"},
		{"owner never signed in", demo.Owner{Email: "someone@example.edu"}, "has not signed in"},
		{"persona without DEV_AUTH", demo.Owner{Email: "admin@localhost"}, "has not signed in"},
		{"invalid email", demo.Owner{Email: "not-an-email"}, "not valid"},
	} {
		o.Owner = c.owner
		if _, err := e.seed(o); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want %q", c.name, err, c.want)
		}
	}
	// Without --models, the install's models are used: there are none.
	o = e.options()
	o.Models = demo.Models{}
	if _, err := e.seed(o); err == nil || !strings.Contains(err.Error(), "--models=fake") {
		t.Errorf("no models: err = %v", err)
	}
	if o.Models = (demo.Models{Mode: demo.ModelsOpenAI, ChatURL: "https://gateway.example.edu/v1"}); o.Models.Validate() == nil {
		t.Error("openai-compatible without models accepted")
	}
	if _, err := demo.Seed(context.Background(), e.pool, e.svc, demo.Options{SiteURL: "ftp://example.edu/"}); err == nil {
		t.Error("non-http site accepted")
	}
}
