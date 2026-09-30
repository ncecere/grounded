package observability_test

import (
	"io"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/observability"
)

func TestRouteGroup(t *testing.T) {
	cases := map[string]string{
		"":                                      observability.GroupUnmatched,
		"GET /healthz":                          observability.GroupOps,
		"GET /metrics":                          observability.GroupOps,
		"POST /v1/agents/{team}/{agent}/chat":   observability.GroupChat,
		"POST /v1/public/agents/{agentId}/chat": observability.GroupChat,
		"POST /v1/chat/completions":             observability.GroupChat,
		"POST /v1/teams/{team}/agents/{agentId}/test": observability.GroupChat,
		"GET /v1/public/agents/{agentRef}":            observability.GroupPublic,
		"GET /widget.js":                              observability.GroupPublic,
		"GET /embed/{agentId}":                        observability.GroupPublic,
		"GET /v1/models":                              observability.GroupOpenAI,
		"POST /mcp":                                   observability.GroupMCP,
		"GET /mcp":                                    observability.GroupMCP,
		"GET /v1/admin/users":                         observability.GroupAdmin,
		"GET /auth/callback":                          observability.GroupAuth,
		"GET /v1/me":                                  observability.GroupAuth,
		"GET /v1/me/break-glass":                      observability.GroupAuth,
		"GET /v1/teams/{team}/agents":                 observability.GroupAPI,
		"GET /v1/conversations/{conversationId}":      observability.GroupAPI,
		"/":                                           observability.GroupUI,
	}
	for pattern, want := range cases {
		if got := observability.RouteGroup(pattern); got != want {
			t.Errorf("RouteGroup(%q) = %q, want %q", pattern, got, want)
		}
	}
}

func TestHTTPMetricsCarryTheRouteGroup(t *testing.T) {
	m := observability.NewMetrics()
	m.ObserveHTTP("POST", "POST /v1/agents/{team}/{agent}/chat", 200, 3*time.Second)
	m.ObserveHTTP("GET", "", 404, time.Millisecond)
	body := scrape(t, m)
	for _, want := range []string{
		`grounded_http_requests_total{group="chat",method="POST",route="POST /v1/agents/{team}/{agent}/chat",status="200"} 1`,
		`grounded_http_requests_total{group="unmatched",method="GET",route="unmatched",status="404"} 1`,
		`grounded_http_request_duration_seconds_count{group="chat",method="POST",route="POST /v1/agents/{team}/{agent}/chat"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics lack %s", want)
		}
	}
}

func TestNamesListsEveryApplicationMetric(t *testing.T) {
	m := observability.NewMetrics()
	m.Register(observability.NewPoolCollector(nil), observability.NewStateCollector(nil, nil))
	names := m.Names()
	for _, want := range []string{
		"grounded_http_requests_total", "grounded_build_info", "grounded_chat_first_token_seconds",
		"grounded_model_requests_total", "grounded_jobs_worked_total", "grounded_db_pool_acquired_connections",
		"grounded_jobs_oldest_available_age_seconds", "grounded_maintenance_mode", "grounded_valkey_errors_total",
	} {
		if !slices.Contains(names, want) {
			t.Errorf("Names() lacks %s", want)
		}
	}
	for _, n := range names {
		if !strings.HasPrefix(n, "grounded_") {
			t.Errorf("metric %s is not prefixed grounded_", n)
		}
	}
}

func TestSetBuildInfoKeepsOneSeries(t *testing.T) {
	observability.SetBuildInfo("api")
	observability.SetBuildInfo("worker")
	body := collectText(t, observability.BuildInfo)
	if n := strings.Count(body, "grounded_build_info{"); n != 1 || !strings.Contains(body, `mode="worker"`) {
		t.Fatalf("build info:\n%s", body)
	}
}

func TestModelObserver(t *testing.T) {
	obs := observability.ModelObserver("test-conn-observer", "chat")
	obs("ok", 2*time.Second)
	obs("rate_limited", 100*time.Millisecond)
	obs("throttled", 0) // never sent: no latency
	body := scrape(t, observability.NewMetrics())
	for _, outcome := range []string{"ok", "rate_limited", "throttled"} {
		series := `grounded_model_requests_total{connection="test-conn-observer",kind="chat",outcome="` + outcome + `"}`
		if got := gaugeValue(t, body, series); got != 1 {
			t.Errorf("%s = %v, want 1", outcome, got)
		}
	}
	if got := gaugeValue(t, body, `grounded_model_request_duration_seconds_count{connection="test-conn-observer",kind="chat"}`); got != 2 {
		t.Errorf("timed requests = %v: throttled requests must not be timed", got)
	}
}

func TestObserveChat(t *testing.T) {
	observability.ObserveChat("test-channel", "ok", 3*time.Second, 500*time.Millisecond)
	observability.ObserveChat("test-channel", "error", time.Second, 0) // nothing streamed
	body := scrape(t, observability.NewMetrics())
	for _, want := range []string{
		`grounded_chat_answers_total{channel="test-channel",outcome="ok"} 1`,
		`grounded_chat_duration_seconds_count{channel="test-channel"} 2`,
		`grounded_chat_first_token_seconds_count{channel="test-channel"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics lack %s", want)
		}
	}
}

func TestObserveRetrievalAndSystemOne(t *testing.T) {
	observability.ObserveRetrieval(10*time.Millisecond, nil)
	observability.ObserveRetrieval(10*time.Millisecond, io.EOF)
	body := collectText(t, observability.RetrievalDuration)
	for _, outcome := range []string{"ok", "error"} {
		if !strings.Contains(body, `grounded_retrieval_duration_seconds_count{outcome="`+outcome+`"}`) {
			t.Errorf("retrieval lacks outcome %s", outcome)
		}
	}
	observability.ObserveSystemOne("test-feature", "timeout", time.Second)
	body = collectText(t, observability.SystemOneRequests)
	if got := gaugeValue(t, body, `grounded_systemone_requests_total{feature="test-feature",outcome="timeout"}`); got != 1 {
		t.Errorf("systemone timeouts = %v", got)
	}
}

func scrape(t *testing.T, m *observability.Metrics) string {
	t.Helper()
	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	return rec.Body.String()
}
