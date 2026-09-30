package doctor_test

import (
	"bytes"
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/app"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/doctor"
	"github.com/ncecere/grounded/internal/testutil"
)

const testKey = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="

func find(t *testing.T, rep doctor.Report, group, name string) doctor.Check {
	t.Helper()
	for _, c := range rep.Checks {
		if c.Group == group && c.Name == name {
			return c
		}
	}
	t.Fatalf("no check %s %s in %+v", group, name, rep.Checks)
	return doctor.Check{}
}

// A healthy install: every dependency answers, the model connection and
// the OIDC issuer are traced, and only the expected warnings show.
func TestDoctorHealthyInstall(t *testing.T) {
	pool, dbURL := testutil.NewDB(t)
	testutil.NewKV(t) // skips without GROUNDED_TEST_VALKEY_URL
	proxy := testutil.NewFakeProxy(t)
	idp := testutil.NewOIDCProvider(t)
	ctx := context.Background()

	cfg := config.Defaults()
	cfg.AppURL, cfg.DatabaseURL, cfg.ValkeyURL = "https://grounded.example.edu", dbURL, os.Getenv("GROUNDED_TEST_VALKEY_URL")
	cfg.EncryptionKey, cfg.APIKeyPepper, cfg.BlobDir = testKey, testKey, t.TempDir()
	cfg.OIDC.Issuer, cfg.OIDC.ClientID, cfg.OIDC.ClientSecret = idp.URL, idp.ClientID, idp.ClientSecret

	box, err := app.NewSecretBox(cfg)
	if err != nil {
		t.Fatal(err)
	}
	admin := uuid.New()
	if _, err := pool.Exec(ctx, "INSERT INTO users (id, oidc_issuer, oidc_subject, email, platform_role) VALUES ($1, 'test', 'admin', 'admin@example.edu', 'platform_admin')", admin); err != nil {
		t.Fatal(err)
	}
	actor := authz.Actor{UserID: admin, PlatformRole: authz.PlatformAdmin}
	cat := catalog.NewService(pool, box)
	judge := testutil.NewFakeSystemOneService(t) // no GET /models
	for _, in := range []catalog.ConnectionInput{
		{Name: "Gateway", BaseURL: proxy.BaseURL(), APIKey: proxy.APIKey, TimeoutSeconds: 5, Enabled: true},
		{Name: "Old gateway", BaseURL: "https://old.example.edu/v1", TimeoutSeconds: 5, Enabled: false},
		{Name: "Judge service", BaseURL: judge.BaseURL(), APIKey: judge.APIKey, TimeoutSeconds: 5, Enabled: true},
	} {
		conn, err := cat.CreateConnection(ctx, actor, in)
		if err != nil {
			t.Fatal(err)
		}
		if in.Name == "Judge service" {
			_, err = cat.CreateModel(ctx, actor, catalog.ModelInput{ConnectionID: conn.ID, Key: "judge", Kind: catalog.KindSystemOne,
				ModelSpec: catalog.ModelSpec{UpstreamModel: "judge-latest", DisplayName: "Judge", MaxClassification: "sensitive", Enabled: true}})
			if err != nil {
				t.Fatal(err)
			}
		}
	}

	rep := doctor.Run(ctx, cfg, doctor.Options{Mode: "api", Timeout: 5 * time.Second, Probes: []string{proxy.BaseURL() + "/models"}})
	if !rep.OK {
		var buf bytes.Buffer
		_ = rep.WriteText(&buf)
		t.Fatalf("report not OK:\n%s", buf.String())
	}
	for _, want := range []struct{ group, name string }{
		{"safety", "production"}, {"configuration", "api"}, {"postgres", "connect"}, {"postgres", "pgvector"},
		{"postgres", "migrations"}, {"valkey", "PING"}, {"storage", "probe object"}, {"oidc", "discovery"}, {"oidc", "JWKS"},
	} {
		if c := find(t, rep, want.group, want.name); c.Status != doctor.OK {
			t.Errorf("%s %s = %+v", want.group, want.name, c)
		}
	}
	gw := find(t, rep, "models", "Gateway")
	if gw.Status != doctor.OK || gw.Timings == nil || gw.Timings.Reused || gw.Timings.ConnectMs <= 0 || !strings.Contains(gw.Detail, "model(s)") {
		t.Errorf("model connection = %+v %+v", gw, gw.Timings)
	}
	// A SystemOne service is asked a SystemOne question, not GET /models.
	if c := find(t, rep, "models", "Judge service"); c.Status != doctor.OK || !strings.Contains(c.Detail, "SystemOne (judge-latest) answered") {
		t.Errorf("SystemOne connection = %+v", c)
	}
	if c := find(t, rep, "models", "Old gateway"); c.Status != doctor.Skip {
		t.Errorf("disabled connection = %+v", c)
	}
	if c := find(t, rep, "probe", proxy.BaseURL()+"/models"); c.Status != doctor.OK || c.Detail != "HTTP 401" {
		t.Errorf("probe = %+v", c) // no key: the server answered, so it is reachable
	}
	// A new database has an empty allowlist; OIDC has no domain restriction.
	for _, code := range []string{"crawl_allowlist_empty", "smtp_not_configured", "oidc_no_domain_restriction"} {
		if c := find(t, rep, "warnings", code); c.Fix == "" {
			t.Errorf("warning %s = %+v", code, c)
		}
	}
	if c := find(t, rep, "warnings", "oidc_no_domain_restriction"); c.Status != doctor.Info {
		t.Errorf("oidc warning = %+v", c)
	}

	var text, js bytes.Buffer
	if err := rep.WriteText(&text); err != nil {
		t.Fatal(err)
	}
	if err := rep.WriteJSON(&js); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text.String(), "✓ models Gateway") || !strings.Contains(text.String(), "first byte ") || !strings.Contains(text.String(), "all checks passed") {
		t.Errorf("text report:\n%s", text.String())
	}
	if !strings.Contains(js.String(), `"firstByteMs"`) || !strings.Contains(js.String(), `"ok": true`) {
		t.Errorf("json report:\n%s", js.String())
	}
}

// Safety violations and unreachable dependencies fail the report, each
// with its own line.
func TestDoctorFailures(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closed := l.Addr().String()
	l.Close()

	cfg := config.Defaults()
	cfg.AppURL, cfg.DevAuth = "http://grounded.example.edu", true
	cfg.DatabaseURL = "postgres://grounded@" + closed + "/grounded?sslmode=disable&connect_timeout=2"
	cfg.ValkeyURL = "redis://" + closed + "/0"
	cfg.EncryptionKey, cfg.APIKeyPepper = "dhi4PJ88URUmYkB0gc7BGWkWI2KrYJBM5bdj7IfEfTo=", testKey
	cfg.BlobDir = t.TempDir()
	cfg.OIDC.Issuer = "http://" + closed

	rep := doctor.Run(context.Background(), cfg, doctor.Options{Timeout: 3 * time.Second})
	if rep.OK {
		t.Fatal("report OK")
	}
	var safety []string
	for _, c := range rep.Checks {
		if c.Group == "safety" && c.Status == doctor.Fail {
			safety = append(safety, c.Detail)
		}
	}
	joined := strings.Join(safety, "\n")
	for _, want := range []string{"ENCRYPTION_KEY is the public example value", "DEV_AUTH", "APP_URL must use https"} {
		if !strings.Contains(joined, want) {
			t.Errorf("safety lacks %q:\n%s", want, joined)
		}
	}
	for _, g := range []string{"postgres", "valkey"} {
		if c := find(t, rep, g, map[string]string{"postgres": "connect", "valkey": "PING"}[g]); c.Status != doctor.Fail {
			t.Errorf("%s = %+v", g, c)
		}
	}
	if c := find(t, rep, "oidc", "discovery"); c.Status != doctor.Fail || !strings.Contains(c.Detail, "connection refused") {
		t.Errorf("oidc = %+v", c)
	}
	if c := find(t, rep, "models", "connections"); c.Status != doctor.Skip {
		t.Errorf("models without postgres = %+v", c)
	}
	if c := find(t, rep, "storage", "probe object"); c.Status != doctor.OK {
		t.Errorf("fs storage = %+v", c)
	}

	bad := doctor.ConfigLoadFailed("worker", errors.Join(errors.New("SESSION_TTL: too short"), errors.New("DEV_AUTH: not a boolean")))
	if bad.OK || len(bad.Checks) != 2 || bad.Mode != "worker" {
		t.Errorf("load failure report = %+v", bad)
	}
}
