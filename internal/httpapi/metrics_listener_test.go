package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/testutil"
)

func metricsTestDeps(metricsAddr string) Deps {
	cfg := config.Defaults()
	cfg.MetricsAddr = metricsAddr
	return Deps{Config: cfg, Metrics: observability.NewMetrics(), Health: NewHealth(nil), Log: testutil.Logger(), Auth: &auth.Service{}}
}

func served(routes []route, pattern string) bool {
	for _, r := range routes {
		if r.pattern() == pattern {
			return true
		}
	}
	return false
}

// With METRICS_ADDR set, /metrics is served only on the internal listener:
// the api listener (behind the public ingress) must not expose it.
func TestMetricsMoveToTheirOwnListener(t *testing.T) {
	onMain := apiRoutes(metricsTestDeps(""))
	if !served(onMain, "GET /metrics") {
		t.Fatal("without METRICS_ADDR, /metrics should stay on the api listener")
	}
	d := metricsTestDeps(":9091")
	if served(apiRoutes(d), "GET /metrics") {
		t.Fatal("with METRICS_ADDR set, the api listener still serves /metrics")
	}
	for _, p := range []string{"GET /healthz", "GET /readyz"} {
		if !served(apiRoutes(d), p) {
			t.Fatalf("api listener lost %s", p)
		}
	}
	rec := httptest.NewRecorder()
	NewOpsHandler(d).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("metrics listener: GET /metrics = %d", rec.Code)
	}
}
