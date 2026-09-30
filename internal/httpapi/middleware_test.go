package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpx"
)

// A request its client cancelled is counted as 499, not as a 5xx, so page
// reloads don't show up as server errors in the metrics or the error SLO.
func TestChainRecordsClientCancellationAs499(t *testing.T) {
	d := metricsTestDeps("")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/notifications", func(w http.ResponseWriter, r *http.Request) {
		httpx.Error(w, http.StatusInternalServerError, "internal", "failed") // e.g. a query that saw the cancel
	})
	h := chain(mux, d)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/v1/notifications", nil).WithContext(ctx))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/v1/notifications", nil))

	rec := httptest.NewRecorder()
	d.Metrics.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body := rec.Body.String()
	if !strings.Contains(body, `route="GET /v1/notifications",status="499"} 1`) {
		t.Fatalf("the cancelled request isn't counted as 499:\n%s", grepLines(body, "grounded_http_requests_total"))
	}
	if !strings.Contains(body, `route="GET /v1/notifications",status="500"} 1`) {
		t.Fatalf("the real failure isn't counted as 500:\n%s", grepLines(body, "grounded_http_requests_total"))
	}
}

func grepLines(s, sub string) string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if strings.Contains(l, sub) {
			out = append(out, l)
		}
	}
	return strings.Join(out, "\n")
}
