package httpapi_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/ncecere/grounded/internal/healthcheck"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

// healthRunner is the health job's run over the test app.
func healthRunner(app *testApp) *healthcheck.Runner {
	return &healthcheck.Runner{
		Store: app.Svc.HealthChecks, Log: testutil.Logger(),
		Checkers: []healthcheck.Checker{&healthcheck.ConnectionChecker{Queries: dbgen.New(app.Pool), Probe: app.Svc.Catalog.ProbeConnectionFree}},
	}
}

// latestHealth reads GET /v1/admin/health-checks by subject.
func latestHealth(t *testing.T, s *session, query string) map[uuid.UUID]apitypes.HealthCheck {
	t.Helper()
	var list []apitypes.HealthCheck
	code, e := s.call("GET", "/v1/admin/health-checks"+query, nil, &list, nil)
	mustCode(t, "health checks", code, e, 200, "")
	out := map[uuid.UUID]apitypes.HealthCheck{}
	for _, c := range list {
		out[c.SubjectId] = c
	}
	return out
}

func TestHealthChecksStoredByTestsAndJob(t *testing.T) {
	app := newTestApp(t, nil)
	admin, auditor, user := app.signIn("admin"), app.signIn("auditor"), app.signIn("user")
	ctx := context.Background()
	proxy := testutil.NewFakeProxy(t)

	var conn apitypes.Connection
	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Health proxy", "baseUrl": proxy.BaseURL(), "apiKey": proxy.APIKey}, &conn, nil)
	mustCode(t, "create connection", code, e, 201, "")
	newModel := func(key, upstream string, enabled bool) apitypes.Model {
		var m apitypes.Model
		code, e := admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": conn.Id, "key": key, "upstreamModel": upstream,
			"displayName": strings.ToUpper(key), "kind": "chat", "maxClassification": "open", "enabled": enabled}, &m, nil)
		mustCode(t, "create model "+key, code, e, 201, "")
		return m
	}
	chat, missing, off := newModel("chat", "test-chat", true), newModel("missing", "not-served", true), newModel("off", "retired-chat", false)

	if got := latestHealth(t, admin, ""); len(got) != 0 {
		t.Fatalf("health before any test = %+v", got)
	}
	// Only platform admins and auditors read it; only admins test.
	code, e = user.call("GET", "/v1/admin/health-checks", nil, nil, nil)
	mustCode(t, "user reads health", code, e, 403, "forbidden")
	code, e = auditor.call("POST", "/v1/admin/connections/"+conn.Id.String()+"/test", nil, nil, nil)
	mustCode(t, "auditor tests", code, e, 403, "forbidden")
	code, e = admin.call("GET", "/v1/admin/health-checks?kind=server", nil, nil, nil)
	mustCode(t, "unknown kind", code, e, 400, "")
	if got := latestHealth(t, auditor, ""); len(got) != 0 {
		t.Fatalf("a refused test was stored: %+v", got)
	}

	// Test connection stores the connection and its enabled models: a model
	// the proxy doesn't list is failing; the disabled one isn't touched.
	var res apitypes.ConnectionTestResult
	code, e = admin.call("POST", "/v1/admin/connections/"+conn.Id.String()+"/test", nil, &res, nil)
	mustCode(t, "test connection", code, e, 200, "")
	got := latestHealth(t, auditor, "")
	c := got[conn.Id]
	if len(got) != 3 || c.Status != "healthy" || c.Trigger != "manual" || c.TriggeredBy == nil || *c.TriggeredBy != admin.me.User.Id ||
		c.TriggeredByName == nil || c.SubjectName != "Health proxy" || !c.SubjectEnabled || c.ErrorClass != nil {
		t.Fatalf("after Test connection = %+v", got)
	}
	if m := got[missing.Id]; m.Status != "failing" || m.ErrorClass == nil || *m.ErrorClass != "not_found" || !strings.Contains(m.Message, "not-served") {
		t.Errorf("unlisted model = %+v", m)
	}
	if _, ok := got[off.Id]; ok || got[chat.Id].Status != "healthy" {
		t.Errorf("models = %+v", got)
	}
	// Test model stores the model's own (real) test.
	var mt apitypes.ModelTestResult
	code, e = admin.call("POST", "/v1/admin/models/"+missing.Id.String()+"/test", nil, &mt, nil)
	mustCode(t, "test model", code, e, 200, "")
	if m := latestHealth(t, admin, "?kind=model")[missing.Id]; mt.Ok || m.Status != "failing" || m.Trigger != "manual" || m.SubjectKind != "model" {
		t.Errorf("model test %+v stored as %+v", mt, m)
	}

	// The job: the proxy fails, so the connection and its enabled models fail.
	proxy.FailWith(503)
	runner := healthRunner(app)
	sum, err := runner.Run(ctx)
	if err != nil || sum.Targets != 1 || sum.Failing != 3 {
		t.Fatalf("failing run = %+v %v", sum, err)
	}
	first := latestHealth(t, admin, "?kind=connection")
	c = first[conn.Id]
	if len(first) != 1 || c.Status != "failing" || c.Trigger != "scheduled" || c.TriggeredBy != nil || *c.ErrorClass != "unavailable" ||
		c.HttpStatus == nil || *c.HttpStatus != 503 || !c.StatusSince.Equal(c.CheckedAt) {
		t.Fatalf("failing connection = %+v", c)
	}
	if m := latestHealth(t, admin, "?kind=model")[chat.Id]; m.Status != "failing" || !strings.HasPrefix(m.Message, "Its connection failed its test") {
		t.Errorf("model on a failing connection = %+v", m)
	}
	// Failing again keeps "failing since".
	if err := (&healthcheck.Worker{Runner: runner}).Work(ctx, nil); err != nil {
		t.Fatal(err)
	}
	again := latestHealth(t, admin, "?kind=connection")[conn.Id]
	if !again.StatusSince.Equal(c.StatusSince) || !again.CheckedAt.After(c.CheckedAt) {
		t.Errorf("second failure: since %s checked %s, first since %s", again.StatusSince, again.CheckedAt, c.StatusSince)
	}
	assertHealthMetrics(t, app, 1, `connection/Health proxy`)

	// A key the current ENCRYPTION_KEY can't decrypt is a config failure.
	if _, err := app.Pool.Exec(ctx, "UPDATE model_connections SET api_key_ciphertext = '\\x00010203'::bytea WHERE id = $1", conn.Id); err != nil {
		t.Fatal(err)
	}
	if _, err := runner.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if c := latestHealth(t, admin, "")[conn.Id]; c.ErrorClass == nil || *c.ErrorClass != "config" || !strings.Contains(c.Message, "ENCRYPTION_KEY") {
		t.Errorf("undecryptable key = %+v", c)
	}

	// Recovered: healthy again, from now.
	proxy.FailWith(0)
	code, e = admin.call("PATCH", "/v1/admin/connections/"+conn.Id.String(), map[string]any{"apiKey": proxy.APIKey}, nil, ifMatch(connRevision(t, admin, conn.Id)))
	mustCode(t, "re-enter the key", code, e, 200, "")
	if _, err := runner.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if c := latestHealth(t, admin, "")[conn.Id]; c.Status != "healthy" || !c.StatusSince.Equal(c.CheckedAt) {
		t.Errorf("recovered = %+v", c)
	}
	assertHealthMetrics(t, app, 0, "model/MISSING")

	// Disabled: nothing is probed, and the last result stays (not enabled).
	code, e = admin.call("PATCH", "/v1/admin/connections/"+conn.Id.String(), map[string]any{"enabled": false}, nil, ifMatch(connRevision(t, admin, conn.Id)))
	mustCode(t, "disable", code, e, 200, "")
	before := len(proxy.Requests)
	if sum, err := runner.Run(ctx); err != nil || sum.Targets != 0 || len(proxy.Requests) != before {
		t.Errorf("run with nothing enabled = %+v %v, %d requests", sum, err, len(proxy.Requests)-before)
	}
	if c := latestHealth(t, admin, "")[conn.Id]; c.SubjectEnabled || c.Status != "healthy" {
		t.Errorf("disabled connection = %+v", c)
	}

	// Pruning keeps each subject's latest check, and drops deleted subjects'.
	var rows int
	count := func() int {
		t.Helper()
		if err := app.Pool.QueryRow(ctx, "SELECT count(*) FROM health_checks").Scan(&rows); err != nil {
			t.Fatal(err)
		}
		return rows
	}
	if _, err := app.Pool.Exec(ctx, "UPDATE health_checks SET checked_at = checked_at - interval '8 days'"); err != nil {
		t.Fatal(err)
	}
	total := count()
	if n, err := app.Svc.HealthChecks.Prune(ctx, healthcheck.Keep); err != nil || count() != 3 || int(n) != total-3 {
		t.Fatalf("pruned %d of %d, %d left: %v", n, total, rows, err)
	}
	code, e = admin.call("DELETE", "/v1/admin/models/"+missing.Id.String(), nil, nil, nil)
	mustCode(t, "delete model", code, e, 200, "")
	if _, err := app.Svc.HealthChecks.Prune(ctx, healthcheck.Keep); err != nil || count() != 2 {
		t.Fatalf("after deleting a model %d checks are left: %v", rows, err)
	}
	if c := latestHealth(t, admin, "")[conn.Id]; c.Status != "healthy" {
		t.Errorf("pruning lost the latest check: %+v", c)
	}
}

func connRevision(t *testing.T, s *session, id uuid.UUID) int64 {
	t.Helper()
	var c apitypes.Connection
	if code := s.get("/v1/admin/connections/"+id.String(), &c); code != 200 {
		t.Fatalf("get connection = %d", code)
	}
	return c.Revision
}

// assertHealthMetrics checks grounded_health_failing{kind="connection"} and
// that grounded_health_failing_seconds names the subjects ("kind/name"),
// and no connection when none is failing.
func assertHealthMetrics(t *testing.T, app *testApp, failing float64, subjects ...string) {
	t.Helper()
	reg := prometheus.NewRegistry()
	reg.MustRegister(observability.NewStateCollector(app.Pool, testutil.Logger()))
	families, err := reg.Gather()
	if err != nil {
		t.Fatal(err)
	}
	var named []string
	var count float64 = -1
	for _, f := range families {
		for _, m := range f.GetMetric() {
			labels := map[string]string{}
			for _, l := range m.GetLabel() {
				labels[l.GetName()] = l.GetValue()
			}
			switch f.GetName() {
			case "grounded_health_failing":
				if labels["kind"] == "connection" {
					count = m.GetGauge().GetValue()
				}
			case "grounded_health_failing_seconds":
				named = append(named, labels["kind"]+"/"+labels["name"])
			}
		}
	}
	joined := strings.Join(named, ",")
	ok := count == failing && (failing > 0 || !strings.Contains(joined, "connection/"))
	for _, want := range subjects {
		ok = ok && slices.Contains(named, want)
	}
	if !ok {
		t.Errorf("grounded_health_failing = %v, failing subjects %v; want %v and %v", count, named, failing, subjects)
	}
}

// The health job never asks a SystemOne service a question (it may bill per
// request): it only checks that the SystemOne endpoint answers.
func TestHealthJobSystemOneServiceAsksNothing(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	ctx := context.Background()
	svc := testutil.NewFakeSystemOneService(t)
	var conn apitypes.Connection
	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Judge service", "baseUrl": svc.BaseURL(), "apiKey": svc.APIKey}, &conn, nil)
	mustCode(t, "create connection", code, e, 201, "")
	var judge apitypes.Model
	code, e = admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": conn.Id, "key": "judge", "upstreamModel": "judge-latest",
		"displayName": "Judge", "kind": "systemone", "maxClassification": "open"}, &judge, nil)
	mustCode(t, "SystemOne model", code, e, 201, "")

	runner := healthRunner(app)
	if sum, err := runner.Run(ctx); err != nil || sum.Healthy != 2 {
		t.Fatalf("run = %+v %v", sum, err)
	}
	if len(svc.Requests) != 0 {
		t.Errorf("the health job asked the SystemOne service %v", svc.Requests)
	}
	got := latestHealth(t, admin, "")
	if got[conn.Id].Status != "healthy" || got[judge.Id].Status != "healthy" || got[conn.Id].Trigger != "scheduled" {
		t.Fatalf("health = %+v", got)
	}

	// The service is gone: the connection and its model fail.
	svc.Close()
	if sum, err := runner.Run(ctx); err != nil || sum.Failing != 2 {
		t.Fatalf("run against a closed service = %+v %v", sum, err)
	}
	if c := latestHealth(t, admin, "")[conn.Id]; c.Status != "failing" || c.ErrorClass == nil || *c.ErrorClass != "unavailable" || c.Message == "" {
		t.Errorf("unreachable service = %+v", c)
	}
}
