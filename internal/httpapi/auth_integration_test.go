package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/app"
	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/moderation"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/testutil"
)

type testApp struct {
	t    *testing.T
	URL  string
	Pool *pgxpool.Pool
	// Moderation is the app's moderation service (tests adjust its timeout).
	Moderation *moderation.Service
	// Svc are the app's services (tests reach the public guard and jobs).
	Svc    *app.Services
	Client *http.Client
}

// testWeb stands in for the built UI: index.html and widget.js.
var testWeb = fstest.MapFS{
	"index.html": {Data: []byte("<!doctype html><html><head><title>x</title></head><body><div id=root></div></body></html>")},
	"widget.js":  {Data: []byte("(()=>{/* widget */})();")},
}

func newTestApp(t *testing.T, mutate func(*config.Config)) *testApp {
	return newTestAppWith(t, mutate, false)
}

// newTestAppWith optionally runs an ingestion worker (River) so uploads are
// processed end to end.
func newTestAppWith(t *testing.T, mutate func(*config.Config), worker bool) *testApp {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	return newTestAppOn(t, pool, mutate, worker)
}

// newTestAppOn serves an app over an existing database (for example a
// second app with other keys, as after a key rotation).
func newTestAppOn(t *testing.T, pool *pgxpool.Pool, mutate func(*config.Config), worker bool) *testApp {
	t.Helper()
	kvs := testutil.NewKV(t)
	var handler http.Handler
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handler.ServeHTTP(w, r) }))
	t.Cleanup(srv.Close)

	cfg := config.Defaults()
	cfg.AppURL, cfg.DevAuth = srv.URL, true
	cfg.DatabaseURL, cfg.ValkeyURL = "unused", "unused"
	cfg.EncryptionKey = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="
	cfg.APIKeyPepper = "cGVwcGVycGVwcGVycGVwcGVycGVwcGVycGVwcGVyISE="
	cfg.BlobDir = t.TempDir()
	cfg.MaxUploadBytes = 1 << 20
	// No scheduled health checks: they would probe fake proxies mid-test
	// (health_checks_integration_test.go runs the job itself).
	cfg.HealthCheckInterval = 0
	if mutate != nil {
		mutate(&cfg)
	}
	if err := cfg.Validate("api"); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	log, metrics := testutil.Logger(), observability.NewMetrics()
	inserter, err := jobs.NewInsertOnly(pool, log)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := app.NewServices(ctx, cfg, pool, inserter, kvs, log)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.Close)
	deps := httpapi.Deps{
		Config: cfg, Pool: pool, KV: kvs, Metrics: metrics, Log: log, Health: httpapi.NewHealth(nil),
		Teams: svc.Teams, Platform: svc.Platform, Catalog: svc.Catalog, Sources: svc.Sources, KBs: svc.KBs, APIKeys: svc.APIKeys,
		WebSources: svc.Web, Limits: svc.Limits, Costs: svc.Costs, Agents: svc.Agents, Notify: svc.Notify, Moderation: svc.Moderation, SystemOne: svc.SystemOne,
		OCR:    svc.OCR,
		Public: svc.Public, Retention: svc.Retention, BreakGlass: svc.BreakGlass, Web: testWeb, WebBuilt: true,
	}
	deps.ProfileMigrations, deps.Evaluations, deps.MCP, deps.OAuth = svc.ProfileMigrations, svc.Evaluations, svc.MCP, svc.OAuth
	deps.Gaps = svc.Gaps
	svc.Limits.OnBackendError = metrics.RateLimitErrors.Inc
	svc.Public.Guard.OnBackendError = metrics.RateLimitErrors.Inc
	deps.Auth = auth.NewService(cfg, pool, kvs, metrics, log)
	handler = httpapi.NewAPIHandler(deps)

	if worker {
		reg, err := app.IngestRegistration(cfg, pool, svc, log)
		if err != nil {
			t.Fatal(err)
		}
		w, err := jobs.NewWorker(pool, log, 4, reg)
		if err != nil {
			t.Fatal(err)
		}
		if err := w.Start(ctx); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			stopCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_ = w.StopAndCancel(stopCtx)
		})
	}

	jar, _ := cookiejar.New(nil)
	return &testApp{t: t, URL: srv.URL, Pool: pool, Client: &http.Client{Jar: jar}, Moderation: svc.Moderation, Svc: svc}
}

func (a *testApp) do(method, path string, body any, headers map[string]string) (int, []byte) {
	a.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, a.URL+path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet {
		req.Header.Set("Origin", a.URL)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := a.Client.Do(req)
	if err != nil {
		a.t.Fatal(err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res.StatusCode, out
}

func (a *testApp) devLogin(account string) {
	a.t.Helper()
	if code, body := a.do("POST", "/auth/dev", map[string]string{"account": account}, nil); code != 200 {
		a.t.Fatalf("dev login %s: %d %s", account, code, body)
	}
}

func (a *testApp) me() (int, apitypes.Me) {
	a.t.Helper()
	code, body := a.do("GET", "/v1/me", nil, nil)
	var env struct{ Data apitypes.Me }
	if code == 200 {
		if err := json.Unmarshal(body, &env); err != nil {
			a.t.Fatal(err)
		}
	}
	return code, env.Data
}

func errorCode(body []byte) string {
	var env struct{ Error struct{ Code string } }
	_ = json.Unmarshal(body, &env)
	return env.Error.Code
}

func TestDevLoginSessionAndCSRF(t *testing.T) {
	app := newTestApp(t, nil)
	if code, _ := app.me(); code != 401 {
		t.Fatalf("anonymous /v1/me = %d, want 401", code)
	}
	// optional=true: signed out is data null, not a 401 (the app's public pages).
	if code, body := app.do("GET", "/v1/me?optional=true", nil, nil); code != 200 || strings.TrimSpace(string(body)) != `{"data":null}` {
		t.Fatalf("anonymous optional /v1/me = %d %s", code, body)
	}
	app.devLogin("admin")
	if code, body := app.do("GET", "/v1/me?optional=true", nil, nil); code != 200 || !strings.Contains(string(body), "admin@localhost") {
		t.Fatalf("signed-in optional /v1/me = %d %s", code, body)
	}
	code, me := app.me()
	if code != 200 || !me.Capabilities.PlatformAdmin || me.User.Email != "admin@localhost" || me.CsrfToken == "" {
		t.Fatalf("me = %d %+v", code, me)
	}

	if code, body := app.do("POST", "/auth/logout", nil, nil); code != 403 || errorCode(body) != "csrf_failed" {
		t.Fatalf("logout without CSRF = %d %s", code, body)
	}
	if code, _ := app.do("POST", "/auth/logout", nil, map[string]string{"X-CSRF-Token": me.CsrfToken, "Origin": "https://evil.example"}); code != 403 {
		t.Fatalf("cross-origin logout = %d, want 403", code)
	}
	if code, body := app.do("POST", "/auth/logout", nil, map[string]string{"X-CSRF-Token": me.CsrfToken}); code != 200 {
		t.Fatalf("logout = %d %s", code, body)
	}
	if code, _ := app.me(); code != 401 {
		t.Fatalf("after logout /v1/me = %d, want 401", code)
	}

	var actions []string
	rows, err := app.Pool.Query(context.Background(), "SELECT action FROM audit_log ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var a string
		_ = rows.Scan(&a)
		actions = append(actions, a)
	}
	if got := strings.Join(actions, ","); got != "platform.bootstrap_role,auth.login,auth.logout" {
		t.Fatalf("audit actions = %s", got)
	}
}

func TestDevPersonaRoles(t *testing.T) {
	app := newTestApp(t, nil)
	for account, want := range map[string]apitypes.PlatformRole{"auditor": "platform_auditor", "user": "none"} {
		app.devLogin(account)
		if _, me := app.me(); me.User.PlatformRole != want {
			t.Errorf("%s role = %s, want %s", account, me.User.PlatformRole, want)
		}
	}
	if code, body := app.do("POST", "/auth/dev", map[string]string{"account": "root"}, nil); code != 400 {
		t.Errorf("unknown persona = %d %s", code, body)
	}
}

func TestDevLoginDisabledOutsideDevAuth(t *testing.T) {
	p := testutil.NewOIDCProvider(t)
	app := newTestApp(t, func(c *config.Config) {
		c.DevAuth = false
		c.OIDC.Issuer, c.OIDC.ClientID, c.OIDC.ClientSecret = p.URL, p.ClientID, p.ClientSecret
	})
	if code, _ := app.do("POST", "/auth/dev", map[string]string{"account": "admin"}, nil); code != 404 {
		t.Fatalf("dev login without DEV_AUTH = %d, want 404", code)
	}
}

func TestBootstrapRoleIsGrantedOnlyOnce(t *testing.T) {
	app := newTestApp(t, nil)
	app.devLogin("admin")
	if _, err := app.Pool.Exec(context.Background(), "UPDATE users SET platform_role = 'none' WHERE email = 'admin@localhost'"); err != nil {
		t.Fatal(err)
	}
	app.devLogin("admin")
	if _, me := app.me(); me.Capabilities.PlatformAdmin {
		t.Fatal("signing in again re-granted a deliberately removed admin role")
	}
}

func TestSuspendedUserIsBlocked(t *testing.T) {
	app := newTestApp(t, nil)
	app.devLogin("user")
	if _, err := app.Pool.Exec(context.Background(), "UPDATE users SET status = 'suspended' WHERE email = 'user@localhost'"); err != nil {
		t.Fatal(err)
	}
	if code, body := app.do("GET", "/v1/me", nil, nil); code != 403 || errorCode(body) != "user_suspended" {
		t.Fatalf("existing session of suspended user = %d %s", code, body)
	}
	if code, body := app.do("POST", "/auth/dev", map[string]string{"account": "user"}, nil); code != 403 || errorCode(body) != "user_suspended" {
		t.Fatalf("suspended sign-in = %d %s", code, body)
	}
}

func oidcApp(t *testing.T, mutate func(*config.Config)) (*testApp, *testutil.OIDCProvider) {
	p := testutil.NewOIDCProvider(t)
	app := newTestApp(t, func(c *config.Config) {
		c.DevAuth = false
		c.OIDC.Issuer, c.OIDC.ClientID, c.OIDC.ClientSecret = p.URL, p.ClientID, p.ClientSecret
		if mutate != nil {
			mutate(c)
		}
	})
	return app, p
}

func TestOIDCLoginFlow(t *testing.T) {
	app, p := oidcApp(t, func(c *config.Config) {
		c.OIDC.BootstrapAdminSubject = "boss-sub"
		c.OIDC.AllowedEmailDomains = []string{"example.edu"}
	})
	p.SetClaims(map[string]any{
		"sub": "boss-sub", "email": "Boss@EXAMPLE.edu", "email_verified": true,
		"given_name": "Robin", "family_name": "Morgan", "eduPersonAffiliation": []string{"staff"},
	})
	res, err := app.Client.Get(app.URL + "/auth/login?next=/admin/teams")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.Request.URL.Path != "/admin/teams" {
		t.Fatalf("post-login redirect landed on %s", res.Request.URL)
	}
	code, me := app.me()
	if code != 200 || me.User.Email != "boss@example.edu" || me.User.DisplayName != "Robin Morgan" || !me.Capabilities.PlatformAdmin {
		t.Fatalf("me = %d %+v", code, me)
	}
	var affiliation string
	err = app.Pool.QueryRow(context.Background(),
		"SELECT claims->'eduPersonAffiliation'->>0 FROM users WHERE email = 'boss@example.edu'").Scan(&affiliation)
	if err != nil || affiliation != "staff" {
		t.Fatalf("claims not stored: %q %v", affiliation, err)
	}
}

func TestOIDCOpenRedirectBlocked(t *testing.T) {
	app, p := oidcApp(t, nil)
	p.SetClaims(map[string]any{"sub": "u1", "email": "u1@example.edu", "email_verified": true})
	res, err := app.Client.Get(app.URL + "/auth/login?next=//evil.example/steal")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.Request.URL.Host != strings.TrimPrefix(app.URL, "http://") || res.Request.URL.Path != "/" {
		t.Fatalf("redirected to %s", res.Request.URL)
	}
}

func TestOIDCRejections(t *testing.T) {
	cases := []struct {
		name     string
		claims   map[string]any
		wantCode string
	}{
		{"unverified email", map[string]any{"sub": "a", "email": "a@example.edu", "email_verified": false}, "email_required"},
		{"missing email", map[string]any{"sub": "b"}, "email_required"},
		{"domain not allowed", map[string]any{"sub": "c", "email": "c@gmail.com", "email_verified": "true"}, "domain_denied"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, p := oidcApp(t, func(c *config.Config) { c.OIDC.AllowedEmailDomains = []string{"example.edu"} })
			p.SetClaims(tc.claims)
			res, err := app.Client.Get(app.URL + "/auth/login")
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if res.StatusCode != 403 || errorCode(body) != tc.wantCode {
				t.Fatalf("got %d %s, want 403 %s", res.StatusCode, body, tc.wantCode)
			}
			if code, _ := app.me(); code != 401 {
				t.Fatalf("a session was created despite rejection")
			}
		})
	}
}

func TestOIDCCallbackRequiresMatchingState(t *testing.T) {
	app, _ := oidcApp(t, nil)
	code, body := app.do("GET", "/auth/callback?code=x&state="+strings.Repeat("a", 43), nil, nil)
	if code != 400 || errorCode(body) != "invalid_state" {
		t.Fatalf("forged callback = %d %s", code, body)
	}
}

func TestAuditLogIsAppendOnly(t *testing.T) {
	app := newTestApp(t, nil)
	app.devLogin("user")
	ctx := context.Background()
	if _, err := app.Pool.Exec(ctx, "UPDATE audit_log SET action = 'x'"); err == nil {
		t.Fatal("audit_log UPDATE succeeded")
	}
	if _, err := app.Pool.Exec(ctx, "DELETE FROM audit_log"); err == nil {
		t.Fatal("audit_log DELETE succeeded without purge flag")
	}
	tx, err := app.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	// ragd.audit_purge is the setting the audit_log trigger checks (applied
	// migration 00001, named before the rename to Grounded).
	if _, err := tx.Exec(ctx, "SELECT set_config('ragd.audit_purge', 'on', true)"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM audit_log"); err != nil {
		t.Fatalf("retention purge rejected: %v", err)
	}
}

// The public auth config carries the instance identity for the SPA.
func TestAuthConfigInstance(t *testing.T) {
	get := func(app *testApp) apitypes.AuthConfig {
		t.Helper()
		app.Client.Jar = nil // anonymous
		code, body := app.do("GET", "/v1/auth/config", nil, nil)
		var env struct{ Data apitypes.AuthConfig }
		if code != 200 || json.Unmarshal(body, &env) != nil {
			t.Fatalf("auth config = %d %s", code, body)
		}
		return env.Data
	}
	d := get(newTestApp(t, nil)).Instance
	if d.Name != "Grounded" || d.OrgName != "" || d.Theme != apitypes.Neutral || d.LogoUrl != nil || d.SupportUrl != nil {
		t.Errorf("default instance = %+v", d)
	}
	c := get(newTestApp(t, func(c *config.Config) {
		c.Instance = config.Instance{Name: "Campus AI", OrgName: "Example University", Theme: "neutral",
			LogoURL: "/brand/logo.svg", SupportURL: "mailto:ai-help@example.edu"}
		c.TeamRequestURL = "https://help.example.edu/new-team"
	}))
	in := c.Instance
	if in.Name != "Campus AI" || in.OrgName != "Example University" || in.Theme != apitypes.Neutral ||
		in.LogoUrl == nil || *in.LogoUrl != "/brand/logo.svg" || in.SupportUrl == nil || *in.SupportUrl != "mailto:ai-help@example.edu" {
		t.Errorf("instance = %+v", in)
	}
	if c.TeamRequestUrl == nil || *c.TeamRequestUrl != "https://help.example.edu/new-team" || !c.DevAuthEnabled {
		t.Errorf("config = %+v", c)
	}
}
